"""
LAMS 会議室参加者管理
Redisを使用したリアルタイム状態管理
"""

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Literal

import redis.asyncio as redis

from app.config import settings


@dataclass
class ParticipantPreference:
    """
    参加者の個人設定
    - audio_mode: 原声(original) または 翻訳(translated)
    - subtitle_enabled: 字幕表示の有無
    - target_language: 翻訳先言語（audio_mode=translatedの場合に使用）
    ※ デフォルトは原声モード（翻訳なし）
    """

    user_id: str
    display_name: str
    native_language: str
    audio_mode: Literal["original", "translated"] = "original"
    subtitle_enabled: bool = True
    target_language: str = ""  # 空の場合はnative_languageを使用
    joined_at: str = ""

    def __post_init__(self) -> None:
        if not self.joined_at:
            self.joined_at = datetime.now(timezone.utc).isoformat()
        if not self.target_language:
            self.target_language = self.native_language


class RoomManager:
    """
    会議室状態管理クラス
    Redis を使用してリアルタイムで参加者状態を管理
    """

    def __init__(self) -> None:
        self._redis: redis.Redis | None = None

    async def get_redis(self) -> redis.Redis:
        """Redis接続取得（遅延初期化）"""
        if self._redis is None:
            self._redis = redis.from_url(settings.redis_url, decode_responses=True)
        return self._redis

    async def create_room_state(self, room_id: str) -> None:
        """会議室状態を初期化"""
        r = await self.get_redis()
        await r.hset(
            f"room:{room_id}",
            mapping={
                "room_id": room_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "active_speaker": "",
            },
        )
        await r.expire(f"room:{room_id}", 86400)  # 24時間で期限切れ

    async def add_participant(
        self,
        room_id: str,
        user_id: str,
        display_name: str,
        native_language: str,
        audio_mode: str = "original",
        subtitle_enabled: bool = True,
    ) -> ParticipantPreference:
        """参加者を追加"""
        r = await self.get_redis()
        participant = ParticipantPreference(
            user_id=user_id,
            display_name=display_name,
            native_language=native_language,
            audio_mode=audio_mode,  # type: ignore
            subtitle_enabled=subtitle_enabled,
        )
        await r.hset(
            f"room:{room_id}:participants", user_id, json.dumps(asdict(participant))
        )
        await r.expire(f"room:{room_id}:participants", 86400)
        return participant

    async def remove_participant(self, room_id: str, user_id: str) -> None:
        """参加者を削除"""
        r = await self.get_redis()
        await r.hdel(f"room:{room_id}:participants", user_id)
        # 参加者がいなくなったら部屋状態も削除
        if await r.hlen(f"room:{room_id}:participants") == 0:
            await r.delete(f"room:{room_id}", f"room:{room_id}:participants")

    async def get_participants(self, room_id: str) -> dict[str, ParticipantPreference]:
        """全参加者を取得"""
        r = await self.get_redis()
        data = await r.hgetall(f"room:{room_id}:participants")
        return {k: ParticipantPreference(**json.loads(v)) for k, v in data.items()}

    async def get_participant(
        self, room_id: str, user_id: str
    ) -> ParticipantPreference | None:
        """特定の参加者を取得"""
        r = await self.get_redis()
        data = await r.hget(f"room:{room_id}:participants", user_id)
        if data:
            return ParticipantPreference(**json.loads(data))
        return None

    async def update_preference(
        self,
        room_id: str,
        user_id: str,
        audio_mode: str | None = None,
        subtitle_enabled: bool | None = None,
        target_language: str | None = None,
    ) -> ParticipantPreference | None:
        """参加者の設定を更新"""
        participant = await self.get_participant(room_id, user_id)
        if not participant:
            return None

        if audio_mode is not None:
            participant.audio_mode = audio_mode  # type: ignore
        if subtitle_enabled is not None:
            participant.subtitle_enabled = subtitle_enabled
        if target_language is not None:
            participant.target_language = target_language

        r = await self.get_redis()
        await r.hset(
            f"room:{room_id}:participants", user_id, json.dumps(asdict(participant))
        )
        return participant

    async def set_active_speaker(self, room_id: str, user_id: str | None) -> None:
        """アクティブスピーカーを設定"""
        r = await self.get_redis()
        await r.hset(f"room:{room_id}", "active_speaker", user_id or "")


# シングルトンインスタンス
room_manager = RoomManager()
