"""
訓練データ闭环の記録・導出（改善.md §5.2 / P3-C）。

ASR/翻訳の訂正ペア、話者エンロールメント、TTS 同意、評価集の収集 API と、学習用
エクスポートを提供する。**不変条件**：学習エクスポート（export_*_training_pairs）は
訂正テーブル（*_correction）のみを参照し、評価集（evaluation_sample）を一切含めない。
評価集は物理的に別テーブルへ隔離し、専用の export_evaluation_set からのみ取り出す。

設計原則:
    - 収集系（record_*）は失敗をログのみで握り、ライブ動作を壊さない（persistence 踏襲）。
    - セッションは app.db.database.async_session を用いる（テストは差し替え可能）。
    - split は train/holdout のみ。eval は列値ではなく別テーブルで表現し混入を構造的に防ぐ。
"""

import logging

from sqlalchemy import select

from app.db.database import async_session
from app.db.models import (
    ASRCorrection,
    DataSplit,
    EvaluationSample,
    SpeakerEnrollment,
    TranslationCorrection,
    TTSConsent,
    utc_now,
)

logger = logging.getLogger(__name__)


def is_training_split(split: str) -> bool:
    """学習に使用してよい分割か（holdout は False）。純関数。"""
    return split == DataSplit.TRAIN.value


# ============================================================
# 収集（record_*）：失敗はログのみ・None 返却でライブを壊さない
# ============================================================
async def record_asr_correction(
    *,
    source_language: str,
    asr_text: str,
    corrected_text: str,
    room_id: str | None = None,
    session_id: str | None = None,
    transcript_segment_id: str | None = None,
    audio_hash: str | None = None,
    corrected_by: str | None = None,
    split: str = DataSplit.TRAIN.value,
) -> str | None:
    """ASR 訂正ペアを保存し id を返す（失敗時 None）。"""
    row = ASRCorrection(
        source_language=source_language,
        asr_text=asr_text,
        corrected_text=corrected_text,
        room_id=room_id,
        session_id=session_id,
        transcript_segment_id=transcript_segment_id,
        audio_hash=audio_hash,
        corrected_by=corrected_by,
        split=split,
    )
    return await _insert(row, "asr_correction")


async def record_translation_correction(
    *,
    source_language: str,
    target_language: str,
    source_text: str,
    mt_text: str,
    corrected_text: str,
    translation_segment_id: str | None = None,
    corrected_by: str | None = None,
    glossary_version: str | None = None,
    split: str = DataSplit.TRAIN.value,
) -> str | None:
    """翻訳訂正ペアを保存し id を返す（失敗時 None）。"""
    row = TranslationCorrection(
        source_language=source_language,
        target_language=target_language,
        source_text=source_text,
        mt_text=mt_text,
        corrected_text=corrected_text,
        translation_segment_id=translation_segment_id,
        corrected_by=corrected_by,
        glossary_version=glossary_version,
        split=split,
    )
    return await _insert(row, "translation_correction")


async def record_tts_consent(
    *,
    user_id: str,
    voice_id: str,
    granted: bool,
    scope: str = "meeting",
    watermark_required: bool = True,
) -> str | None:
    """TTS クローン同意を保存し id を返す（granted 時は granted_at を打つ）。"""
    row = TTSConsent(
        user_id=user_id,
        voice_id=voice_id,
        granted=granted,
        scope=scope,
        watermark_required=watermark_required,
        granted_at=utc_now() if granted else None,
    )
    return await _insert(row, "tts_consent")


async def add_evaluation_sample(
    *,
    stage: str,
    source_language: str,
    reference_text: str,
    target_language: str | None = None,
    input_text: str | None = None,
    audio_hash: str | None = None,
    notes: str | None = None,
) -> str | None:
    """評価集サンプルを保存し id を返す（学習には決して使われない別テーブル）。"""
    row = EvaluationSample(
        stage=stage,
        source_language=source_language,
        reference_text=reference_text,
        target_language=target_language,
        input_text=input_text,
        audio_hash=audio_hash,
        notes=notes,
    )
    return await _insert(row, "evaluation_sample")


async def upsert_speaker_enrollment(
    *,
    user_id: str,
    speaker_label: str,
    room_id: str | None = None,
    embedding: dict | None = None,
    consent: bool = False,
) -> str | None:
    """話者エンロールメントを (user_id, speaker_label) で upsert し id を返す。"""
    try:
        async with async_session() as db:
            existing = (
                await db.execute(
                    select(SpeakerEnrollment).where(
                        SpeakerEnrollment.user_id == user_id,
                        SpeakerEnrollment.speaker_label == speaker_label,
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                existing = SpeakerEnrollment(
                    user_id=user_id,
                    speaker_label=speaker_label,
                    room_id=room_id,
                    embedding=embedding,
                    consent=consent,
                )
                db.add(existing)
            else:
                existing.room_id = room_id
                existing.embedding = embedding
                existing.consent = consent
            await db.commit()
            await db.refresh(existing)
            return existing.id
    except Exception as e:  # noqa: BLE001 - 収集失敗はライブを壊さない
        logger.warning("[TRAIN] speaker_enrollment 保存エラー: %s", e)
        return None


async def _insert(row: object, label: str) -> str | None:
    """1 行を挿入して id を返す共通ヘルパー（失敗はログのみ）。"""
    try:
        async with async_session() as db:
            db.add(row)
            await db.commit()
            await db.refresh(row)
            return row.id  # type: ignore[attr-defined]
    except Exception as e:  # noqa: BLE001 - 収集失敗はライブを壊さない
        logger.warning("[TRAIN] %s 保存エラー: %s", label, e)
        return None


# ============================================================
# 学習エクスポート：訂正テーブルのみ参照（評価集は構造的に混入しない）
# ============================================================
async def export_asr_training_pairs(
    *, source_language: str | None = None, include_holdout: bool = False
) -> list[tuple[str, str]]:
    """ASR 学習ペア (asr_text, corrected_text) を返す。評価集は参照しない。"""
    async with async_session() as db:
        stmt = select(ASRCorrection.asr_text, ASRCorrection.corrected_text)
        if source_language is not None:
            stmt = stmt.where(ASRCorrection.source_language == source_language)
        if not include_holdout:
            stmt = stmt.where(ASRCorrection.split == DataSplit.TRAIN.value)
        rows = (await db.execute(stmt)).all()
        return [(r[0], r[1]) for r in rows]


async def export_translation_training_pairs(
    *,
    source_language: str | None = None,
    target_language: str | None = None,
    include_holdout: bool = False,
) -> list[tuple[str, str]]:
    """翻訳学習ペア (source_text, corrected_text) を返す。評価集は参照しない。"""
    async with async_session() as db:
        stmt = select(
            TranslationCorrection.source_text, TranslationCorrection.corrected_text
        )
        if source_language is not None:
            stmt = stmt.where(TranslationCorrection.source_language == source_language)
        if target_language is not None:
            stmt = stmt.where(TranslationCorrection.target_language == target_language)
        if not include_holdout:
            stmt = stmt.where(TranslationCorrection.split == DataSplit.TRAIN.value)
        rows = (await db.execute(stmt)).all()
        return [(r[0], r[1]) for r in rows]


async def export_evaluation_set(
    *, stage: str, source_language: str | None = None
) -> list[EvaluationSample]:
    """評価集を返す（学習には決して使わない。評価専用の唯一の取り出し口）。"""
    async with async_session() as db:
        stmt = select(EvaluationSample).where(EvaluationSample.stage == stage)
        if source_language is not None:
            stmt = stmt.where(EvaluationSample.source_language == source_language)
        return list((await db.execute(stmt)).scalars().all())


async def export_speaker_enrollments(
    *, consent_only: bool = True
) -> list[tuple[str, str, list[float]]]:
    """話者照合用に (user_id, speaker_label, embedding) を返す（P4-A diarization）。

    入力: consent_only — True なら consent 済み・embedding 有りのみを返す。
    出力: 照合可能なエンロールメントのリスト（失敗時 []）。
    注意点: **同意（consent=True）が無い話者の声紋は照合に用いない**（プライバシー）。
        embedding が list[float] でないレコードは除外する。
    """
    try:
        async with async_session() as db:
            stmt = select(
                SpeakerEnrollment.user_id,
                SpeakerEnrollment.speaker_label,
                SpeakerEnrollment.embedding,
            )
            if consent_only:
                stmt = stmt.where(SpeakerEnrollment.consent.is_(True))
            rows = (await db.execute(stmt)).all()
            out: list[tuple[str, str, list[float]]] = []
            for user_id, label, emb in rows:
                vec = _coerce_embedding(emb)
                if vec is not None:
                    out.append((user_id, label, vec))
            return out
    except Exception as e:  # noqa: BLE001 - 照合データ取得失敗は識別無しに縮退
        logger.warning("[TRAIN] 話者エンロールメント取得エラー: %s", e)
        return []


def _coerce_embedding(emb: object) -> list[float] | None:
    """JSON 保存された embedding を float ベクトルへ整える（不正は None）。純関数。"""
    if isinstance(emb, dict):
        emb = emb.get("v")
    if not isinstance(emb, list) or not emb:
        return None
    try:
        return [float(x) for x in emb]
    except (TypeError, ValueError):
        return None
