"""離線重跑 回放ログ（P3-D）の単体テスト：記録・照会・状態更新・結果保存。

in-memory sqlite（StaticPool で単一接続共有）へ実テーブルを作り、record/list/mark/save を
実 DB で検証する。記録系は失敗時に None/False/[] を返しライブを壊さないことも確認する。
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import replay
from app.db.models import Base, PipelineEvent, RerunResult, RerunStatus


async def _setup(monkeypatch) -> async_sessionmaker:
    """sqlite in-memory エンジンを作り、replay.async_session を差し替える。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(replay, "async_session", maker)
    return maker


@pytest.mark.asyncio
async def test_record_pipeline_event_persists(monkeypatch) -> None:
    """id を返し、rerun_status=pending・translations/tags が JSON で往復する。"""
    maker = await _setup(monkeypatch)
    eid = await replay.record_pipeline_event(
        source_language="ja",
        asr_text="こんにちは",
        session_id="s1",
        translations={"en": "hello", "zh": "你好"},
        tags=[{"type": "term", "value": "AI"}],
    )
    assert eid is not None
    async with maker() as db:
        row = await db.get(PipelineEvent, eid)
        assert row.rerun_status == RerunStatus.PENDING.value
        assert row.translations == {"en": "hello", "zh": "你好"}
        assert row.tags == [{"type": "term", "value": "AI"}]
        assert row.degraded is False


@pytest.mark.asyncio
async def test_record_degraded_without_audio_hash(monkeypatch) -> None:
    """degraded=True かつ audio_hash=None でも正しく保存できる。"""
    maker = await _setup(monkeypatch)
    eid = await replay.record_pipeline_event(
        source_language="en",
        asr_text="partial",
        session_id="s1",
        degraded=True,
        audio_hash=None,
    )
    assert eid is not None
    async with maker() as db:
        row = await db.get(PipelineEvent, eid)
        assert row.degraded is True
        assert row.audio_hash is None


@pytest.mark.asyncio
async def test_list_rerunnable_events_filters_status_and_session(monkeypatch) -> None:
    """pending+failed のみ・指定セッションのみ・created_at 昇順で返す。"""
    await _setup(monkeypatch)
    # s1 に 4 件（pending / done / skipped / failed）
    e_pending = await replay.record_pipeline_event(
        source_language="ja", asr_text="a", session_id="s1"
    )
    e_done = await replay.record_pipeline_event(
        source_language="ja", asr_text="b", session_id="s1"
    )
    e_skipped = await replay.record_pipeline_event(
        source_language="ja", asr_text="c", session_id="s1"
    )
    e_failed = await replay.record_pipeline_event(
        source_language="ja", asr_text="d", session_id="s1"
    )
    # 別セッションの pending は除外されること
    e_other = await replay.record_pipeline_event(
        source_language="ja", asr_text="e", session_id="s2"
    )
    await replay.mark_rerun_status(e_done, RerunStatus.DONE.value)
    await replay.mark_rerun_status(e_skipped, RerunStatus.SKIPPED.value)
    await replay.mark_rerun_status(e_failed, RerunStatus.FAILED.value)

    rows = await replay.list_rerunnable_events("s1")
    ids = [r.id for r in rows]
    assert ids == [e_pending, e_failed]  # 挿入=created_at 昇順、pending→failed
    assert e_done not in ids
    assert e_skipped not in ids
    assert e_other not in ids


@pytest.mark.asyncio
async def test_list_rerunnable_events_respects_limit(monkeypatch) -> None:
    """limit で返却件数を制限する。"""
    await _setup(monkeypatch)
    for text in ("a", "b", "c"):
        await replay.record_pipeline_event(
            source_language="ja", asr_text=text, session_id="s1"
        )
    rows = await replay.list_rerunnable_events("s1", limit=2)
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_mark_rerun_status_updates_and_unknown_returns_false(
    monkeypatch,
) -> None:
    """既存 id は True で状態更新、未知 id は False。"""
    maker = await _setup(monkeypatch)
    eid = await replay.record_pipeline_event(
        source_language="ja", asr_text="a", session_id="s1"
    )
    ok = await replay.mark_rerun_status(eid, RerunStatus.DONE.value)
    assert ok is True
    async with maker() as db:
        row = await db.get(PipelineEvent, eid)
        assert row.rerun_status == RerunStatus.DONE.value

    assert await replay.mark_rerun_status("no-such-id", RerunStatus.DONE.value) is False


@pytest.mark.asyncio
async def test_save_rerun_result_persists(monkeypatch) -> None:
    """RerunResult の id を返し、translations とモデル名が保存される。"""
    maker = await _setup(monkeypatch)
    eid = await replay.record_pipeline_event(
        source_language="ja", asr_text="a", session_id="s1"
    )
    rid = await replay.save_rerun_result(
        pipeline_event_id=eid,
        source_language="ja",
        asr_text="こんにちは（高品質）",
        translations={"en": "hello (hq)"},
        asr_model="whisper-large-v3",
        mt_model="gpt-4o",
    )
    assert rid is not None
    async with maker() as db:
        row = await db.get(RerunResult, rid)
        assert row.pipeline_event_id == eid
        assert row.translations == {"en": "hello (hq)"}
        assert row.asr_model == "whisper-large-v3"
        assert row.mt_model == "gpt-4o"


@pytest.mark.asyncio
async def test_record_and_queries_fail_safely(monkeypatch) -> None:
    """DB 障害時は record=None / list=[] / mark=False を返し例外を投げない。"""

    class _Boom:
        def __call__(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(replay, "async_session", _Boom())
    assert (
        await replay.record_pipeline_event(source_language="ja", asr_text="x") is None
    )
    assert await replay.list_rerunnable_events("s1") == []
    assert await replay.mark_rerun_status("any", RerunStatus.DONE.value) is False
    assert (
        await replay.save_rerun_result(
            pipeline_event_id="e1", source_language="ja", asr_text="x"
        )
        is None
    )
