"""
LAMS WebSocketハンドラー
会議室のリアルタイム通信を管理

設計方針:
- ユーザーが audio_mode を選択（original/translated）
- 字幕は audio_mode に一致する内容のみ表示
- デフォルトは原声モード（翻訳なし）
"""

import asyncio
import contextlib
import json
import logging
from dataclasses import asdict

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.ai_pipeline.pipeline import ai_pipeline
from app.auth.jwt_handler import decode_token
from app.db.database import async_session
from app.db.models import Room, User
from app.rooms.manager import room_manager

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    """
    WebSocket接続管理クラス
    各会議室の接続を管理
    """

    def __init__(self) -> None:
        # room_id -> user_id -> WebSocket
        self.rooms: dict[str, dict[str, WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, room_id: str, user_id: str, ws: WebSocket) -> None:
        """接続を追加"""
        await ws.accept()
        async with self._lock:
            if room_id not in self.rooms:
                self.rooms[room_id] = {}
            self.rooms[room_id][user_id] = ws

    async def disconnect(self, room_id: str, user_id: str) -> None:
        """接続を削除"""
        async with self._lock:
            if room_id in self.rooms:
                self.rooms[room_id].pop(user_id, None)
                if not self.rooms[room_id]:
                    del self.rooms[room_id]

    async def broadcast_json(
        self, room_id: str, message: dict, exclude_user: str | None = None
    ) -> None:
        """全員にJSONメッセージを送信"""
        if room_id not in self.rooms:
            return
        for user_id, ws in list(self.rooms[room_id].items()):
            if user_id != exclude_user:
                with contextlib.suppress(Exception):
                    await ws.send_json(message)

    async def send_to_user(self, room_id: str, user_id: str, message: dict) -> None:
        """特定ユーザーにJSONを送信"""
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            with contextlib.suppress(Exception):
                await self.rooms[room_id][user_id].send_json(message)

    async def send_bytes_to_user(self, room_id: str, user_id: str, data: bytes) -> None:
        """特定ユーザーにバイナリを送信"""
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            with contextlib.suppress(Exception):
                await self.rooms[room_id][user_id].send_bytes(data)


# 接続マネージャーインスタンス
conn_mgr = ConnectionManager()


@router.websocket("/room/{room_id}")
async def websocket_room(
    ws: WebSocket,
    room_id: str,
    token: str = Query(...),
) -> None:
    """
    会議室WebSocketエンドポイント

    メッセージタイプ:
    - preference_change: 設定変更（audio_mode, subtitle_enabled, target_language）
    - speaking_start: 発言開始
    - speaking_end: 発言終了
    - bytes: 音声データ
    """
    # トークン検証
    token_data = decode_token(token)
    if not token_data:
        await ws.close(code=4001, reason="無効なトークン")
        return

    user_id = token_data.user_id

    # 会議室とユーザーの存在確認
    async with async_session() as db:
        room_result = await db.execute(select(Room).where(Room.id == room_id))
        room = room_result.scalar_one_or_none()
        if not room or not room.is_active:
            await ws.close(code=4004, reason="会議室が見つかりません")
            return

        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            await ws.close(code=4001, reason="ユーザーが見つかりません")
            return

    # 接続確立（conn_mgr.connect内でws.accept()を呼び出す）
    logger.info(f"[WS DEBUG] Connecting user {user_id} to room {room_id}")
    await conn_mgr.connect(room_id, user_id, ws)
    logger.info(f"[WS DEBUG] Connected, adding participant...")

    # 参加者として追加（デフォルト: 原声モード）
    participant = await room_manager.add_participant(
        room_id=room_id,
        user_id=user_id,
        display_name=user.display_name,
        native_language=user.native_language,
        audio_mode=room.default_audio_mode,  # 会議室のデフォルト
        subtitle_enabled=True,
    )

    logger.info(f"[WS DEBUG] Participant added: {participant}")

    # 入室を他の参加者に通知
    await conn_mgr.broadcast_json(
        room_id,
        {
            "type": "user_joined",
            "user_id": user_id,
            "display_name": user.display_name,
            "native_language": user.native_language,
        },
        exclude_user=user_id,
    )
    logger.info(f"[WS DEBUG] Broadcasted user_joined")

    # 現在の部屋状態を送信
    participants = await room_manager.get_participants(room_id)
    logger.info(f"[WS DEBUG] Got participants: {len(participants)}")
    await ws.send_json(
        {
            "type": "room_state",
            "room_id": room_id,
            "room_name": room.name,
            "policy": {
                "allowed_languages": room.allowed_languages,
                "default_audio_mode": room.default_audio_mode,
                "allow_mode_switch": room.allow_mode_switch,
            },
            "participants": [
                {
                    "user_id": p.user_id,
                    "display_name": p.display_name,
                    "native_language": p.native_language,
                    "audio_mode": p.audio_mode,
                }
                for p in participants.values()
            ],
            "your_preference": asdict(participant),
        }
    )
    logger.info(f"[WS DEBUG] Sent room_state, entering message loop...")

    try:
        while True:
            data = await ws.receive()

            # 接続切断チェック
            if data.get("type") == "websocket.disconnect":
                break

            if "text" in data:
                # JSONメッセージ処理
                message = json.loads(data["text"])
                msg_type = message.get("type")

                if msg_type == "preference_change":
                    # 設定変更
                    if not room.allow_mode_switch:
                        await ws.send_json(
                            {
                                "type": "error",
                                "message": "この会議室では設定変更が許可されていません",
                            }
                        )
                        continue

                    new_audio_mode = message.get("audio_mode")
                    new_subtitle = message.get("subtitle_enabled")
                    new_target_lang = message.get("target_language")

                    # 言語が許可されているか確認
                    if (
                        new_target_lang
                        and new_target_lang not in room.allowed_languages
                    ):
                        await ws.send_json(
                            {
                                "type": "error",
                                "message": f"言語 {new_target_lang} は許可されていません",
                            }
                        )
                        continue

                    updated = await room_manager.update_preference(
                        room_id,
                        user_id,
                        audio_mode=new_audio_mode,
                        subtitle_enabled=new_subtitle,
                        target_language=new_target_lang,
                    )

                    if updated:
                        await ws.send_json(
                            {
                                "type": "preference_updated",
                                "preference": asdict(updated),
                            }
                        )
                        # 他の参加者にも通知
                        await conn_mgr.broadcast_json(
                            room_id,
                            {
                                "type": "user_preference_changed",
                                "user_id": user_id,
                                "audio_mode": updated.audio_mode,
                            },
                            exclude_user=user_id,
                        )

                elif msg_type == "speaking_start":
                    await room_manager.set_active_speaker(room_id, user_id)
                    await conn_mgr.broadcast_json(
                        room_id,
                        {"type": "speaking_start", "user_id": user_id},
                    )

                elif msg_type == "speaking_end":
                    await room_manager.set_active_speaker(room_id, None)
                    await conn_mgr.broadcast_json(
                        room_id,
                        {"type": "speaking_end", "user_id": user_id},
                    )

            elif "bytes" in data:
                # 音声データ処理
                audio_bytes = data["bytes"]
                if not audio_bytes or len(audio_bytes) < 44:
                    # 空または無効な音声データはスキップ
                    continue

                current_participant = await room_manager.get_participant(
                    room_id, user_id
                )
                if not current_participant:
                    continue

                speaker_lang = current_participant.native_language
                all_participants = await room_manager.get_participants(room_id)

                # 翻訳結果キャッシュ（同じ言語ペアは1回だけ処理）
                # key: target_lang, value: TranslationResult
                translation_cache: dict = {}
                # 原文ASR結果（1回だけ取得）
                original_asr_result = None

                # 各参加者の設定に基づいて配信
                for p in all_participants.values():
                    if p.user_id == user_id:
                        continue  # 自分自身にはスキップ

                    if p.audio_mode == "original":
                        # 原声モード: 元の音声をそのまま送信
                        await conn_mgr.send_bytes_to_user(
                            room_id, p.user_id, audio_bytes
                        )

                        # 字幕が有効な場合は原文テキストを送信
                        if p.subtitle_enabled:
                            # ASRで原文を取得（1回だけ実行）
                            if original_asr_result is None:
                                original_asr_result = await ai_pipeline.process_audio(
                                    audio_bytes, speaker_lang, speaker_lang, user_id
                                )
                            await conn_mgr.send_to_user(
                                room_id,
                                p.user_id,
                                {
                                    "type": "subtitle",
                                    "speaker_id": user_id,
                                    "text": original_asr_result.original_text,
                                    "language": speaker_lang,
                                    "is_translated": False,
                                },
                            )

                    else:
                        # 翻訳モード: 翻訳済み音声・字幕を送信
                        target_lang = p.target_language or p.native_language

                        if target_lang == speaker_lang:
                            # 同じ言語の場合は原声
                            await conn_mgr.send_bytes_to_user(
                                room_id, p.user_id, audio_bytes
                            )
                            if p.subtitle_enabled:
                                if original_asr_result is None:
                                    original_asr_result = await ai_pipeline.process_audio(
                                        audio_bytes, speaker_lang, speaker_lang, user_id
                                    )
                                await conn_mgr.send_to_user(
                                    room_id,
                                    p.user_id,
                                    {
                                        "type": "subtitle",
                                        "speaker_id": user_id,
                                        "text": original_asr_result.original_text,
                                        "language": speaker_lang,
                                        "is_translated": False,
                                    },
                                )
                        else:
                            # 翻訳処理（同じ言語ペアはキャッシュ再利用）
                            if target_lang in translation_cache:
                                result = translation_cache[target_lang]
                            else:
                                result = await ai_pipeline.process_audio(
                                    audio_bytes, speaker_lang, target_lang, user_id
                                )
                                translation_cache[target_lang] = result

                            # QoS劣化時は字幕フォールバック
                            if result.metrics.should_fallback_to_subtitle:
                                await conn_mgr.send_to_user(
                                    room_id,
                                    p.user_id,
                                    {
                                        "type": "qos_warning",
                                        "level": result.metrics.degradation_level.value,
                                        "message": "遅延が発生しています。字幕モードに切り替えました。",
                                    },
                                )

                            # 翻訳音声があれば送信（なければ原声）
                            if result.audio_data:
                                await conn_mgr.send_bytes_to_user(
                                    room_id, p.user_id, result.audio_data
                                )
                            else:
                                await conn_mgr.send_bytes_to_user(
                                    room_id, p.user_id, audio_bytes
                                )

                            # 翻訳字幕を送信
                            if p.subtitle_enabled:
                                await conn_mgr.send_to_user(
                                    room_id,
                                    p.user_id,
                                    {
                                        "type": "subtitle",
                                        "speaker_id": user_id,
                                        "text": result.translated_text,
                                        "language": target_lang,
                                        "is_translated": True,
                                        "latency_ms": result.metrics.total_latency_ms,
                                    },
                                )

    except WebSocketDisconnect:
        pass
    finally:
        # クリーンアップ
        await conn_mgr.disconnect(room_id, user_id)
        await room_manager.remove_participant(room_id, user_id)
        await conn_mgr.broadcast_json(
            room_id,
            {"type": "user_left", "user_id": user_id},
        )
