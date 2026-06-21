"""
収束の永続化（Phase 3 C1）：会議セッション・字幕の DB 保存と採番/重複排除。

README §0 の「収束は Output Manager と DB のみ」に従い、LiveKit Agent から
transport 非依存で呼べる永続化境界を提供する。WS 廃止（C1-8）後はこのモジュールが
セッション/字幕永続化の単一の住処となる（旧 handler の重複定義は撤去予定）。

設計原則:
    - 採番・重複排除（SubtitleSequencer）は純ロジックで単体テスト可能。
    - DB I/O（get_or_create_session / end_session / save_subtitle）は明示の失敗処理付き。
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select

from app.db.database import async_session
from app.db.models import MeetingMode, MeetingSession, Room, Subtitle

logger = logging.getLogger(__name__)

# room_id -> active session_id（メモリ内キャッシュ。DB が真実の源）。
_active_sessions: dict[str, str] = {}


@dataclass(frozen=True)
class MeetingConfig:
    """会議の主線ルーティング設定（Orchestrator/ModeRouter への入力）。

    Room（会議既定）と進行中の MeetingSession.mode（実行時モード）を統合した
    transport 非依存のスナップショット。Agent は発話ごとにこれを参照して主線を選ぶ。
    """

    mode: str = MeetingMode.HYBRID.value  # 実行時モード（a / b / hybrid）
    enable_openai_s2s: bool = True  # 会議レベルの聞く主線（S2S）許可
    language_routes: dict = field(default_factory=dict)  # 言語ペア単位の上書き


async def get_meeting_config(room_id: str) -> MeetingConfig:
    """room の主線ルーティング設定を DB から読み出す（失敗時は既定値）。

    実行時モードはアクティブな MeetingSession.mode を権威とし、無ければ
    Room.default_mode を用いる。S2S 許可とルートは Room から取得する。
    """
    try:
        async with async_session() as db:
            room = (
                await db.execute(select(Room).where(Room.id == room_id))
            ).scalar_one_or_none()
            if room is None:
                return MeetingConfig()
            session = (
                await db.execute(
                    select(MeetingSession).where(
                        MeetingSession.room_id == room_id,
                        MeetingSession.is_active.is_(True),
                    )
                )
            ).scalar_one_or_none()
            mode = session.mode if session is not None else room.default_mode
            return MeetingConfig(
                mode=mode or MeetingMode.HYBRID.value,
                enable_openai_s2s=bool(room.enable_openai_s2s),
                language_routes=dict(room.language_routes or {}),
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("[PERSIST] 会議設定取得エラー(room=%s): %s", room_id, e)
        return MeetingConfig()


class SubtitleSequencer:
    """room ごとの字幕シーケンス採番と連続同一テキストの重複排除（純ロジック）。"""

    def __init__(self) -> None:
        self._seq: dict[str, int] = {}
        self._last_text: dict[str, dict[str, str]] = {}

    def next_seq(self, room_id: str) -> int:
        """room の字幕シーケンス番号を単調増加で発行する。"""
        self._seq[room_id] = self._seq.get(room_id, 0) + 1
        return self._seq[room_id]

    def is_duplicate(self, room_id: str, speaker_id: str, text: str) -> bool:
        """直前と同一話者・同一テキストなら True（連続重複の抑制）。"""
        return self._last_text.get(room_id, {}).get(speaker_id) == text

    def remember(self, room_id: str, speaker_id: str, text: str) -> None:
        """話者ごとの直近テキストを記録する。"""
        self._last_text.setdefault(room_id, {})[speaker_id] = text

    def forget_room(self, room_id: str) -> None:
        """room 終了時に採番・重複排除の状態を破棄する。"""
        self._seq.pop(room_id, None)
        self._last_text.pop(room_id, None)


async def get_or_create_session(room_id: str) -> str:
    """会議室のアクティブセッションを取得、無ければ作成する。"""
    if room_id in _active_sessions:
        return _active_sessions[room_id]
    async with async_session() as db:
        result = await db.execute(
            select(MeetingSession).where(
                MeetingSession.room_id == room_id,
                MeetingSession.is_active.is_(True),
            )
        )
        session = result.scalar_one_or_none()
        if session:
            _active_sessions[room_id] = session.id
            return session.id
        new_session = MeetingSession(room_id=room_id)
        db.add(new_session)
        await db.commit()
        await db.refresh(new_session)
        _active_sessions[room_id] = new_session.id
        logger.info("[SESSION] 新規セッション開始: room=%s", room_id)
        return new_session.id


async def end_session(room_id: str) -> None:
    """会議セッションを終了する（全員退室時に呼び出す）。"""
    session_id = _active_sessions.pop(room_id, None)
    if not session_id:
        return
    async with async_session() as db:
        result = await db.execute(
            select(MeetingSession).where(MeetingSession.id == session_id)
        )
        session = result.scalar_one_or_none()
        if session:
            session.is_active = False
            session.ended_at = datetime.now(timezone.utc)
            await db.commit()
            logger.info("[SESSION] セッション終了: room=%s", room_id)


async def save_subtitle(
    *,
    room_id: str,
    speaker_id: str,
    original_text: str,
    original_language: str,
    translations: dict[str, str],
) -> None:
    """字幕レコードを DB へ保存する（セッションに紐付け）。失敗はログのみ。"""
    try:
        session_id = await get_or_create_session(room_id)
        async with async_session() as db:
            db.add(
                Subtitle(
                    room_id=room_id,
                    session_id=session_id,
                    speaker_id=speaker_id,
                    original_text=original_text,
                    original_language=original_language,
                    translations=translations,
                )
            )
            await db.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning("[PERSIST] 字幕DB保存エラー(room=%s): %s", room_id, e)


def generate_subtitle_id() -> str:
    """字幕 ID（順序保証・キャッシュ照合用の UUID）を生成する。"""
    return str(uuid.uuid4())
