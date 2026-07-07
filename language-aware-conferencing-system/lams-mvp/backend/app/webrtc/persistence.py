"""
収束の永続化（Phase 3 C1）：会議セッション・字幕の DB 保存と採番/重複排除。

README §0 の「収束は Output Manager と DB のみ」に従い、LiveKit Agent から
transport 非依存で呼べる永続化境界を提供する。WS 廃止（C1-8）後はこのモジュールが
セッション/字幕永続化の単一の住処となる（旧 handler の重複定義は撤去予定）。

設計原則:
    - 採番・重複排除（SubtitleSequencer）は純ロジックで単体テスト可能。
    - DB I/O（get_or_create_session / end_session / save_transcript_segment）は
      明示の失敗処理付き。
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_pipeline.qos import HybridQoSMonitor
from app.db.database import async_session
from app.db.models import (
    MeetingMode,
    MeetingSession,
    Participant,
    Room,
    TranscriptSegment,
    TranslationSegment,
)

logger = logging.getLogger(__name__)

# room_id -> active session_id（メモリ内キャッシュ。DB が真実の源）。
_active_sessions: dict[str, str] = {}
# room_id -> 会議中の QoS モニタ（数字保持率を累積。end_session で永続化し破棄）。
_session_monitors: dict[str, HybridQoSMonitor] = {}


@dataclass(frozen=True)
class MeetingConfig:
    """会議の主線ルーティング設定（Orchestrator/ModeRouter への入力）。

    Room（会議既定）と進行中の MeetingSession.mode（実行時モード）を統合した
    transport 非依存のスナップショット。Agent は発話ごとにこれを参照して主線を選ぶ。
    """

    mode: str = MeetingMode.A.value  # 実行時モード（a / b / hybrid）
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
                mode=mode or MeetingMode.A.value,
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
        room = (
            await db.execute(select(Room).where(Room.id == room_id))
        ).scalar_one_or_none()
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
        new_session = MeetingSession(
            room_id=room_id,
            mode=(room.default_mode if room is not None else MeetingMode.A.value),
        )
        db.add(new_session)
        await db.commit()
        await db.refresh(new_session)
        _active_sessions[room_id] = new_session.id
        logger.info("[SESSION] 新規セッション開始: room=%s", room_id)
        return new_session.id


async def end_session(room_id: str) -> None:
    """会議セッションを終了する（全員退室時に呼び出す）。QoS サマリも永続化する。"""
    session_id = _active_sessions.pop(room_id, None)
    monitor = _session_monitors.pop(room_id, None)
    async with async_session() as db:
        if not session_id:
            result = await db.execute(
                select(MeetingSession).where(
                    MeetingSession.room_id == room_id,
                    MeetingSession.is_active.is_(True),
                )
            )
            active = result.scalar_one_or_none()
            if active is None:
                return
            session_id = active.id
        result = await db.execute(
            select(MeetingSession).where(MeetingSession.id == session_id)
        )
        session = result.scalar_one_or_none()
        if session:
            if not session.is_active:
                return
            session.is_active = False
            session.ended_at = datetime.now(timezone.utc)
            # QoS サマリ（改善.md §15）。現状は数字保持率のみ実測可能。
            if monitor is not None:
                rate = monitor.number_retention_rate()
                if rate is not None:
                    session.qos_summary = {
                        "number_retention_rate": round(rate, 4),
                        "number_samples": monitor.number_samples(),
                    }
            await db.commit()
            logger.info("[SESSION] セッション終了: room=%s", room_id)


def _providers_by_lang(tags: list[dict]) -> dict[str, str | None]:
    """orchestrator の tags から target_language → 翻訳 provider を導出する（純ロジック）。

    収束時のタグ（subtitle_mainline / s2s_provider）から TranslationSegment.provider を
    決める。聞く主線なら S2S provider、読む主線なら "asr_mt"、字幕なしは None。
    """
    out: dict[str, str | None] = {}
    for t in tags:
        lang = t.get("target_language")
        if not lang:
            continue
        out[lang] = (
            t.get("s2s_provider")
            if t.get("subtitle_mainline") == "hearing"
            else "asr_mt"
        )
    return out


async def save_transcript_segment(
    *,
    room_id: str,
    speaker_id: str,
    source_language: str,
    text: str,
    translations: dict[str, str],
    tags: list[dict] | None = None,
) -> None:
    """発話を TranscriptSegment 1 件＋言語別 TranslationSegment N 件へ正規化保存する。

    改善.md §13.3/§13.4 の正式記録基盤。失敗はログのみ（既存挙動踏襲）。
    """
    try:
        session_id = await get_or_create_session(room_id)
        provider_by_lang = _providers_by_lang(tags or [])
        # QoS: 数字・日付・金額の保持率を会議単位で累積（改善.md §15）。
        monitor = _session_monitors.setdefault(room_id, HybridQoSMonitor())
        for target_lang, translated_text in translations.items():
            if target_lang == source_language:
                continue
            if translated_text:
                monitor.record_number_retention(text, translated_text)
        async with async_session() as db:
            seg = TranscriptSegment(
                room_id=room_id,
                session_id=session_id,
                speaker_id=speaker_id,
                source_language=source_language,
                text=text,
                # ponytail: confidence/provider は ASR 層から安価に取れないため null。
                # ASR provider を OrchestrationResult に乗せられるようになったら充填する。
            )
            db.add(seg)
            await db.flush()  # seg.id 採番のため（FK 紐付けに必要）
            for target_lang, translated_text in translations.items():
                if not translated_text:
                    continue
                if target_lang == source_language:
                    continue
                db.add(
                    TranslationSegment(
                        transcript_segment_id=seg.id,
                        source_language=source_language,
                        target_language=target_lang,
                        translated_text=translated_text,
                        provider=provider_by_lang.get(target_lang),
                        # ponytail: llm_provider/glossary_version/quality_score は
                        # 未計測のため null。評価ハーネス整備時に充填する。
                    )
                )
            await db.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning("[PERSIST] segment DB保存エラー(room=%s): %s", room_id, e)


async def _active_session_id(db: AsyncSession, room_id: str) -> str | None:
    """アクティブな MeetingSession.id を返す（無ければ None。新規作成はしない）。"""
    session = (
        await db.execute(
            select(MeetingSession).where(
                MeetingSession.room_id == room_id,
                MeetingSession.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    return session.id if session is not None else None


async def upsert_participant(
    *,
    room_id: str,
    user_id: str,
    display_name: str,
    preferred_language: str,
    output_language: str,
    voice_translation_enabled: bool,
) -> None:
    """参加者の耐久レコードを (room_id, user_id) で upsert する（改善.md §13.2）。

    Redis（room_manager）からの write-through。失敗はログのみで、ライブ動作は壊さない。
    """
    try:
        async with async_session() as db:
            existing = (
                await db.execute(
                    select(Participant).where(
                        Participant.room_id == room_id,
                        Participant.user_id == user_id,
                    )
                )
            ).scalar_one_or_none()
            session_id = await _active_session_id(db, room_id)
            if existing is None:
                db.add(
                    Participant(
                        room_id=room_id,
                        user_id=user_id,
                        session_id=session_id,
                        display_name=display_name,
                        preferred_language=preferred_language,
                        output_language=output_language,
                        voice_translation_enabled=voice_translation_enabled,
                    )
                )
            else:
                existing.display_name = display_name
                existing.preferred_language = preferred_language
                existing.output_language = output_language
                existing.voice_translation_enabled = voice_translation_enabled
                if session_id is not None:
                    existing.session_id = session_id
            await db.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PERSIST] 参加者DB保存エラー(room=%s, user=%s): %s", room_id, user_id, e
        )


def generate_subtitle_id() -> str:
    """字幕 ID（順序保証・キャッシュ照合用の UUID）を生成する。"""
    return str(uuid.uuid4())
