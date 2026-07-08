"""中間パイプライン事件の記録・照会（改善.md §5.3 / P3-D 離線重跑の回放ログ）。

目的:
    実時パイプラインの1発話出力（ASR 原文・言語別訳文・タグ・縮退フラグ・trace_id）を
    PipelineEvent として保存し、会議後に最強モデルで離線再処理（rerun）できる回放基盤を
    提供する。再処理対象の照会・状態更新・再処理結果（RerunResult）の保存も担う。

設計原則:
    - 記録系（record_*/save_*/mark_*/list_*）は失敗をログのみで握り、ライブ動作を壊さない
      （app.db.training 踏襲）。成功時のみ id/True/行を返し、失敗時は None/False/[] を返す。
    - セッションは app.db.database.async_session を用いる（テストは差し替え可能）。
    - 再処理対象は rerun_status が PENDING/FAILED の事件のみ（冪等再実行）。
"""

import logging

from sqlalchemy import select

from app.db.database import async_session
from app.db.models import PipelineEvent, RerunResult, RerunStatus

logger = logging.getLogger(__name__)

# 再処理対象の既定状態（未処理・失敗のみを冪等に再実行できる）
_DEFAULT_RERUN_STATUSES: tuple[str, ...] = (
    RerunStatus.PENDING.value,
    RerunStatus.FAILED.value,
)


async def record_pipeline_event(
    *,
    source_language: str,
    asr_text: str,
    room_id: str | None = None,
    session_id: str | None = None,
    transcript_segment_id: str | None = None,
    speaker_id: str | None = None,
    speaker_label: str | None = None,
    seq: int | None = None,
    audio_hash: str | None = None,
    translations: dict[str, str] | None = None,
    tags: list[dict] | None = None,
    degraded: bool = False,
    trace_id: str | None = None,
) -> str | None:
    """PipelineEvent を1件保存し id を返す（失敗時 None）。rerun_status は既定 pending。

    入力: 実時パイプラインの1発話出力と各種参照 id（speaker_label は P4-A 話者分離）。
    出力: 保存した PipelineEvent.id（失敗時 None）。
    注意点: 音声バイト列は保存せず audio_hash（暗号化アーカイブ参照）のみ保持する。
    """
    row = PipelineEvent(
        source_language=source_language,
        asr_text=asr_text,
        room_id=room_id,
        session_id=session_id,
        transcript_segment_id=transcript_segment_id,
        speaker_id=speaker_id,
        speaker_label=speaker_label,
        seq=seq,
        audio_hash=audio_hash,
        translations=translations,
        tags=tags,
        degraded=degraded,
        trace_id=trace_id,
    )
    return await _insert(row, "pipeline_event")


async def list_rerunnable_events(
    session_id: str,
    statuses: tuple[str, ...] = _DEFAULT_RERUN_STATUSES,
    limit: int | None = None,
) -> list[PipelineEvent]:
    """指定セッションの再処理対象事件を created_at 昇順で返す（失敗時 []）。

    入力: session_id・対象 rerun_status の集合・件数上限（任意）。
    出力: 条件に合致する PipelineEvent のリスト（時系列昇順）。失敗時は空リスト。
    注意点: 既定は PENDING/FAILED のみ。DONE/SKIPPED や他セッションは含めない。
    """
    try:
        async with async_session() as db:
            stmt = (
                select(PipelineEvent)
                .where(
                    PipelineEvent.session_id == session_id,
                    PipelineEvent.rerun_status.in_(statuses),
                )
                .order_by(PipelineEvent.created_at)
            )
            if limit is not None:
                stmt = stmt.limit(limit)
            return list((await db.execute(stmt)).scalars().all())
    except Exception as e:  # noqa: BLE001 - 照会失敗はライブを壊さない
        logger.warning("[REPLAY] list_rerunnable_events エラー: %s", e)
        return []


async def mark_rerun_status(event_id: str, status: str) -> bool:
    """PipelineEvent.rerun_status を更新（成功 True / 失敗・不在 False）。

    入力: 対象 PipelineEvent.id と新しい rerun_status 値。
    出力: 更新できたら True、対象が存在しない・失敗時は False。
    注意点: 存在しない id は False を返す（例外は投げない）。
    """
    try:
        async with async_session() as db:
            row = await db.get(PipelineEvent, event_id)
            if row is None:
                return False
            row.rerun_status = status
            await db.commit()
            return True
    except Exception as e:  # noqa: BLE001 - 更新失敗はライブを壊さない
        logger.warning("[REPLAY] mark_rerun_status エラー: %s", e)
        return False


async def save_rerun_result(
    *,
    pipeline_event_id: str,
    source_language: str,
    asr_text: str,
    transcript_segment_id: str | None = None,
    translations: dict[str, str] | None = None,
    asr_model: str | None = None,
    mt_model: str | None = None,
) -> str | None:
    """RerunResult を1件保存し id を返す（失敗時 None）。

    入力: 対応する pipeline_event_id と離線再処理の高品質出力・使用モデル。
    出力: 保存した RerunResult.id（失敗時 None）。
    注意点: 実時の Transcript/Translation は不変。高品質版は本テーブルに分離保存する。
    """
    row = RerunResult(
        pipeline_event_id=pipeline_event_id,
        source_language=source_language,
        asr_text=asr_text,
        transcript_segment_id=transcript_segment_id,
        translations=translations,
        asr_model=asr_model,
        mt_model=mt_model,
    )
    return await _insert(row, "rerun_result")


async def _insert(row: object, label: str) -> str | None:
    """1 行を挿入して id を返す共通ヘルパー（失敗はログのみ・None 返却）。"""
    try:
        async with async_session() as db:
            db.add(row)
            await db.commit()
            await db.refresh(row)
            return row.id  # type: ignore[attr-defined]
    except Exception as e:  # noqa: BLE001 - 記録失敗はライブを壊さない
        logger.warning("[REPLAY] %s 保存エラー: %s", label, e)
        return None
