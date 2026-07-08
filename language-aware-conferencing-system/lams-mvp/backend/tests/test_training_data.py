"""訓練データ闭环（P3-C）の単体テスト：収集・導出・評価集の物理隔離。

in-memory sqlite（StaticPool で単一接続共有）へ実テーブルを作り、record/export を
実 DB で検証する。**核心不変条件**：学習エクスポートに評価集が混入しないこと。
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import training
from app.db.models import Base, DataSplit


async def _setup(monkeypatch) -> async_sessionmaker:
    """sqlite in-memory エンジンを作り、training.async_session を差し替える。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(training, "async_session", maker)
    return maker


def test_is_training_split_pure() -> None:
    assert training.is_training_split(DataSplit.TRAIN.value) is True
    assert training.is_training_split(DataSplit.HOLDOUT.value) is False
    assert training.is_training_split("eval") is False


@pytest.mark.asyncio
async def test_record_and_export_asr(monkeypatch) -> None:
    await _setup(monkeypatch)
    rid = await training.record_asr_correction(
        source_language="ja", asr_text="こんにちわ", corrected_text="こんにちは"
    )
    assert rid is not None
    pairs = await training.export_asr_training_pairs(source_language="ja")
    assert pairs == [("こんにちわ", "こんにちは")]


@pytest.mark.asyncio
async def test_holdout_excluded_from_training_export(monkeypatch) -> None:
    await _setup(monkeypatch)
    await training.record_asr_correction(
        source_language="ja", asr_text="a", corrected_text="A"
    )
    await training.record_asr_correction(
        source_language="ja",
        asr_text="b",
        corrected_text="B",
        split=DataSplit.HOLDOUT.value,
    )
    train_only = await training.export_asr_training_pairs(source_language="ja")
    assert train_only == [("a", "A")]
    with_holdout = await training.export_asr_training_pairs(
        source_language="ja", include_holdout=True
    )
    assert len(with_holdout) == 2


@pytest.mark.asyncio
async def test_evaluation_set_never_in_training_export(monkeypatch) -> None:
    """核心不変条件：評価集は学習エクスポートに混入しない（物理隔離）。"""
    await _setup(monkeypatch)
    # 訓練用の訂正ペア
    await training.record_translation_correction(
        source_language="en",
        target_language="ja",
        source_text="hello",
        mt_text="やあ",
        corrected_text="こんにちは",
    )
    # 評価集（別テーブル）
    await training.add_evaluation_sample(
        stage="t2t",
        source_language="en",
        target_language="ja",
        input_text="hello",
        reference_text="EVAL_REFERENCE_MUST_NOT_LEAK",
    )
    pairs = await training.export_translation_training_pairs(
        source_language="en", target_language="ja"
    )
    # 学習ペアは訂正のみ。評価参照は含まれない。
    assert pairs == [("hello", "こんにちは")]
    flat = [t for pair in pairs for t in pair]
    assert "EVAL_REFERENCE_MUST_NOT_LEAK" not in flat
    # 評価集は専用口からのみ取得できる。
    evals = await training.export_evaluation_set(stage="t2t", source_language="en")
    assert len(evals) == 1
    assert evals[0].reference_text == "EVAL_REFERENCE_MUST_NOT_LEAK"


@pytest.mark.asyncio
async def test_tts_consent_sets_granted_at(monkeypatch) -> None:
    maker = await _setup(monkeypatch)
    cid = await training.record_tts_consent(
        user_id="u1", voice_id="v1", granted=True
    )
    assert cid is not None
    from app.db.models import TTSConsent

    async with maker() as db:
        row = await db.get(TTSConsent, cid)
        assert row.granted is True
        assert row.granted_at is not None
        assert row.watermark_required is True  # 既定で透かし必須


@pytest.mark.asyncio
async def test_tts_consent_not_granted_has_no_timestamp(monkeypatch) -> None:
    maker = await _setup(monkeypatch)
    cid = await training.record_tts_consent(
        user_id="u1", voice_id="v1", granted=False
    )
    from app.db.models import TTSConsent

    async with maker() as db:
        row = await db.get(TTSConsent, cid)
        assert row.granted is False
        assert row.granted_at is None


@pytest.mark.asyncio
async def test_speaker_enrollment_upsert(monkeypatch) -> None:
    await _setup(monkeypatch)
    id1 = await training.upsert_speaker_enrollment(
        user_id="u1", speaker_label="spk", embedding={"v": [0.1, 0.2]}, consent=True
    )
    # 同一 (user_id, speaker_label) は更新（新規行を作らない）。
    id2 = await training.upsert_speaker_enrollment(
        user_id="u1", speaker_label="spk", embedding={"v": [0.9]}, consent=False
    )
    assert id1 == id2

    from app.db.models import SpeakerEnrollment

    maker = training.async_session
    async with maker() as db:
        row = await db.get(SpeakerEnrollment, id1)
        assert row.embedding == {"v": [0.9]}
        assert row.consent is False


@pytest.mark.asyncio
async def test_record_failure_returns_none(monkeypatch) -> None:
    """DB 障害時は None を返し例外を投げない（収集はライブを壊さない）。"""

    class _Boom:
        def __call__(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(training, "async_session", _Boom())
    rid = await training.record_asr_correction(
        source_language="ja", asr_text="x", corrected_text="y"
    )
    assert rid is None
