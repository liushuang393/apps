"""A/B 実験 API（P4-C）の単体テスト：ハンドラ関数を直接呼び分岐を検証する。

FastAPI DI/認証ハーネスを介さず、registry ビルダーと集計関数を monkeypatch して
一覧・集計の応答整形を確認する（test_rerun_routes 踏襲）。
"""

import pytest

from app.ai_pipeline import experiment_routes
from app.ai_pipeline.ab_testing import Experiment, ExperimentRegistry, ExperimentVariant


@pytest.mark.asyncio
async def test_list_experiments_maps_views(monkeypatch) -> None:
    """登録簿の実験を ExperimentView 一覧へ整形する。"""
    reg = ExperimentRegistry()
    reg.register(
        Experiment(
            key="e1",
            stage="asr",
            variants=(
                ExperimentVariant("control", "m1", 70),
                ExperimentVariant("treatment", "m2", 30),
            ),
            unit="session",
            enabled=True,
        )
    )
    monkeypatch.setattr(experiment_routes, "_build_registry", lambda: reg)
    views = await experiment_routes.list_experiments(_admin=object())
    assert len(views) == 1
    assert views[0].key == "e1" and views[0].stage == "asr"
    assert [v.name for v in views[0].variants] == ["control", "treatment"]
    assert views[0].variants[0].weight == 70


@pytest.mark.asyncio
async def test_list_experiments_empty(monkeypatch) -> None:
    """実験なしは空リスト。"""
    monkeypatch.setattr(
        experiment_routes, "_build_registry", lambda: ExperimentRegistry()
    )
    assert await experiment_routes.list_experiments(_admin=object()) == []


@pytest.mark.asyncio
async def test_get_summary_returns_aggregation(monkeypatch) -> None:
    """集計関数の結果をそのまま応答へ載せる。"""

    async def _fake_summary(key: str):
        assert key == "e1"
        return {"control": {"latency_ms": {"count": 2, "mean": 200.0}}}

    monkeypatch.setattr(experiment_routes, "summarize_experiment", _fake_summary)
    resp = await experiment_routes.get_experiment_summary(
        experiment_key="e1", _admin=object()
    )
    assert resp.experiment_key == "e1"
    assert resp.summary["control"]["latency_ms"]["mean"] == 200.0


@pytest.mark.asyncio
async def test_get_summary_empty_when_no_data(monkeypatch) -> None:
    """観測なしは空 summary。"""

    async def _fake_summary(_key: str):
        return {}

    monkeypatch.setattr(experiment_routes, "summarize_experiment", _fake_summary)
    resp = await experiment_routes.get_experiment_summary(
        experiment_key="unknown", _admin=object()
    )
    assert resp.summary == {}
