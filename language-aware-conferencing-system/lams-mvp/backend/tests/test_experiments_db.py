"""A/B 実験指標の記録・集計（P4-C）の単体テスト：in-memory sqlite で永続層を検証。"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import experiments
from app.db.models import Base


async def _setup(monkeypatch) -> async_sessionmaker:
    """in-memory sqlite を作り experiments.async_session を差し替える。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(experiments, "async_session", maker)
    return maker


@pytest.mark.asyncio
async def test_record_returns_id(monkeypatch) -> None:
    """記録成功で id を返す。"""
    await _setup(monkeypatch)
    rid = await experiments.record_experiment_metric(
        experiment_key="e1",
        variant="control",
        metric_name="latency_ms",
        metric_value=300.0,
    )
    assert rid is not None


@pytest.mark.asyncio
async def test_summarize_aggregates_by_variant_and_metric(monkeypatch) -> None:
    """群×指標で count/mean/min/max を集計する。"""
    await _setup(monkeypatch)
    for v, val in [
        ("control", 100.0),
        ("control", 300.0),
        ("treatment", 200.0),
    ]:
        await experiments.record_experiment_metric(
            experiment_key="e1",
            variant=v,
            metric_name="latency_ms",
            metric_value=val,
        )
    summary = await experiments.summarize_experiment("e1")
    assert summary["control"]["latency_ms"]["count"] == 2
    assert summary["control"]["latency_ms"]["mean"] == 200.0
    assert summary["control"]["latency_ms"]["min"] == 100.0
    assert summary["control"]["latency_ms"]["max"] == 300.0
    assert summary["treatment"]["latency_ms"]["count"] == 1
    assert summary["treatment"]["latency_ms"]["mean"] == 200.0


@pytest.mark.asyncio
async def test_summarize_separates_metrics(monkeypatch) -> None:
    """同一群でも metric_name ごとに分けて集計する。"""
    await _setup(monkeypatch)
    await experiments.record_experiment_metric(
        experiment_key="e1", variant="c", metric_name="latency_ms", metric_value=500.0
    )
    await experiments.record_experiment_metric(
        experiment_key="e1", variant="c", metric_name="quality", metric_value=0.9
    )
    summary = await experiments.summarize_experiment("e1")
    assert set(summary["c"].keys()) == {"latency_ms", "quality"}


@pytest.mark.asyncio
async def test_summarize_unknown_key_empty(monkeypatch) -> None:
    """該当なしは空 dict。"""
    await _setup(monkeypatch)
    assert await experiments.summarize_experiment("nope") == {}


@pytest.mark.asyncio
async def test_summarize_scoped_by_experiment_key(monkeypatch) -> None:
    """他実験の観測は混ざらない。"""
    await _setup(monkeypatch)
    await experiments.record_experiment_metric(
        experiment_key="e1", variant="c", metric_name="q", metric_value=1.0
    )
    await experiments.record_experiment_metric(
        experiment_key="e2", variant="c", metric_name="q", metric_value=2.0
    )
    assert await experiments.summarize_experiment("e1") == {
        "c": {"q": {"count": 1, "mean": 1.0, "min": 1.0, "max": 1.0}}
    }


@pytest.mark.asyncio
async def test_record_fails_closed_on_db_error(monkeypatch) -> None:
    """DB 障害時は None（ライブを壊さない）。"""

    class _Boom:
        def __call__(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(experiments, "async_session", _Boom())
    rid = await experiments.record_experiment_metric(
        experiment_key="e1", variant="c", metric_name="q", metric_value=1.0
    )
    assert rid is None


@pytest.mark.asyncio
async def test_summarize_fails_safe_on_db_error(monkeypatch) -> None:
    """集計時の DB 障害は空 dict。"""

    class _Boom:
        def __call__(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(experiments, "async_session", _Boom())
    assert await experiments.summarize_experiment("e1") == {}
