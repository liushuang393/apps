"""A/B ライブ実行時配線（P4-wiring ②）の単体テスト：文脈・セレクタ選択・指標記録。"""

import asyncio

import pytest

from app.ai_pipeline import ab_runtime
from app.ai_pipeline.ab_runtime import (
    ABContext,
    CompositeExperimentSelector,
    get_ab_context,
    reset_ab_context,
    set_ab_context,
)
from app.ai_pipeline.ab_testing import Experiment, ExperimentRegistry, ExperimentVariant

# ---- ContextVar ----


def test_context_set_get_reset() -> None:
    assert get_ab_context() is None
    tok = set_ab_context(ABContext(user_id="u1"))
    assert get_ab_context().user_id == "u1"
    reset_ab_context(tok)
    assert get_ab_context() is None


# ---- セレクタ用の足場 ----


class _FakeReg:
    """registry.resolve の最小スタブ。name→実体を辞書で返す。"""

    def __init__(self, table: dict) -> None:
        self._table = table
        self.calls = 0

    def resolve(self, stage: str, name: str):
        self.calls += 1
        return self._table.get((stage, name))


def _exp(stage: str = "t2t", unit: str = "user") -> Experiment:
    return Experiment(
        key=f"exp_{stage}",
        stage=stage,
        variants=(
            ExperimentVariant("control", "model-control", 1),
            ExperimentVariant("treatment", "model-treatment", 1),
        ),
        unit=unit,
        enabled=True,
    )


def _registry_with(*exps: Experiment) -> ExperimentRegistry:
    reg = ExperimentRegistry()
    for e in exps:
        reg.register(e)
    return reg


# ---- select ----


def test_select_no_experiment_returns_default() -> None:
    sel = CompositeExperimentSelector(
        registry=_FakeReg({}), experiments=ExperimentRegistry()
    )
    default = object()
    assert sel.select("mt", default) == (default, None, None)


def test_select_unknown_stage_returns_default() -> None:
    sel = CompositeExperimentSelector(
        registry=_FakeReg({}), experiments=_registry_with(_exp())
    )
    default = object()
    # "summary" は _STAGE_TO_CATALOG に無い → 既定。
    assert sel.select("summary", default) == (default, None, None)


def test_select_no_unit_context_returns_default() -> None:
    """unit=user だが文脈未設定 → 割当なし → 既定。"""
    sel = CompositeExperimentSelector(
        registry=_FakeReg({}), experiments=_registry_with(_exp(unit="user"))
    )
    default = object()
    assert sel.select("mt", default) == (default, None, None)


def test_select_assigns_and_resolves(monkeypatch) -> None:
    """文脈あり → variant 割当 → provider_name 解決 → 実体を返す。"""
    inst_c = object()
    inst_t = object()
    fake_reg = _FakeReg({("mt", "prov-control"): inst_c, ("mt", "prov-treatment"): inst_t})
    monkeypatch.setattr(
        ab_runtime,
        "provider_name_for_model",
        lambda mid: {"model-control": "prov-control", "model-treatment": "prov-treatment"}[mid],
    )
    sel = CompositeExperimentSelector(
        registry=fake_reg, experiments=_registry_with(_exp(stage="t2t", unit="user"))
    )
    tok = set_ab_context(ABContext(user_id="u1"))
    try:
        inst, ek, vn = sel.select("mt", object())
    finally:
        reset_ab_context(tok)
    assert inst in (inst_c, inst_t)
    assert ek == "exp_t2t"
    assert vn in ("control", "treatment")


def test_select_determinism_and_cache(monkeypatch) -> None:
    """同一 unit は同一 variant・実体解決はキャッシュされ 1 回だけ。"""
    inst = object()
    fake_reg = _FakeReg({("mt", "p"): inst})
    monkeypatch.setattr(ab_runtime, "provider_name_for_model", lambda _mid: "p")
    sel = CompositeExperimentSelector(
        registry=fake_reg, experiments=_registry_with(_exp(unit="user"))
    )
    tok = set_ab_context(ABContext(user_id="u1"))
    try:
        r1 = sel.select("mt", object())
        r2 = sel.select("mt", object())
    finally:
        reset_ab_context(tok)
    assert r1[2] == r2[2]  # 同一 variant
    assert fake_reg.calls == 1  # キャッシュ済み


def test_select_room_unit_resolves_from_context(monkeypatch) -> None:
    """unit=room の実験は ABContext.room_id で割当できる（room unit ライブ有効化）。"""
    inst = object()
    fake_reg = _FakeReg({("mt", "p"): inst})
    monkeypatch.setattr(ab_runtime, "provider_name_for_model", lambda _mid: "p")
    sel = CompositeExperimentSelector(
        registry=fake_reg, experiments=_registry_with(_exp(unit="room"))
    )
    # room_id のみ設定（user 未設定でも room 実験は解決できる）。
    tok = set_ab_context(ABContext(room_id="r1"))
    try:
        got, ek, vn = sel.select("mt", object())
    finally:
        reset_ab_context(tok)
    assert got is inst and ek == "exp_t2t" and vn in ("control", "treatment")


def test_select_missing_provider_name_returns_default(monkeypatch) -> None:
    """model_id に provider_name が無い → 既定。"""
    monkeypatch.setattr(ab_runtime, "provider_name_for_model", lambda _mid: None)
    sel = CompositeExperimentSelector(
        registry=_FakeReg({}), experiments=_registry_with(_exp(unit="user"))
    )
    default = object()
    tok = set_ab_context(ABContext(user_id="u1"))
    try:
        assert sel.select("mt", default) == (default, None, None)
    finally:
        reset_ab_context(tok)


def test_select_unresolvable_instance_returns_default(monkeypatch) -> None:
    """registry.resolve が None → 既定。"""
    monkeypatch.setattr(ab_runtime, "provider_name_for_model", lambda _mid: "p")
    sel = CompositeExperimentSelector(
        registry=_FakeReg({}),  # ("mt","p") 未登録 → None
        experiments=_registry_with(_exp(unit="user")),
    )
    default = object()
    tok = set_ab_context(ABContext(user_id="u1"))
    try:
        assert sel.select("mt", default) == (default, None, None)
    finally:
        reset_ab_context(tok)


def test_select_never_raises_into_live_path() -> None:
    """配信判定の想定外例外もライブへ漏らさず既定へ縮退する（review 指摘）。"""

    class _BoomReg(ExperimentRegistry):
        def for_stage(self, *_a, **_k):
            raise RuntimeError("boom")

    sel = CompositeExperimentSelector(registry=_FakeReg({}), experiments=_BoomReg())
    default = object()
    assert sel.select("mt", default) == (default, None, None)


# ---- note（fire-and-forget 指標記録） ----


@pytest.mark.asyncio
async def test_note_records_via_record_fn() -> None:
    """note は record_fn を fire-and-forget で呼ぶ。"""
    captured: list = []

    async def _rec(**kw):
        captured.append(kw)

    sel = CompositeExperimentSelector(
        registry=_FakeReg({}), experiments=ExperimentRegistry(), record_fn=_rec
    )
    tok = set_ab_context(ABContext(user_id="u1"))
    try:
        sel.note(
            experiment_key="e",
            variant="control",
            stage="mt",
            metric_name="latency_ms",
            metric_value=123.0,
        )
        await asyncio.gather(*list(sel._pending))
    finally:
        reset_ab_context(tok)
    assert len(captured) == 1
    assert captured[0]["experiment_key"] == "e"
    assert captured[0]["variant"] == "control"
    assert captured[0]["metric_value"] == 123.0
    assert captured[0]["unit_id"] == "u1"


@pytest.mark.asyncio
async def test_note_swallows_record_errors() -> None:
    """record_fn が例外でも note はライブを壊さない。"""

    async def _boom(**_kw):
        raise RuntimeError("db down")

    sel = CompositeExperimentSelector(
        registry=_FakeReg({}), experiments=ExperimentRegistry(), record_fn=_boom
    )
    sel.note(
        experiment_key="e",
        variant="c",
        stage="mt",
        metric_name="latency_ms",
        metric_value=1.0,
    )
    # 例外はタスク内で握られる（gather しても伝播しない）。
    await asyncio.gather(*list(sel._pending))


def test_note_without_event_loop_is_noop() -> None:
    """event loop 非実行時（同期文脈）は何もしない。"""
    sel = CompositeExperimentSelector(
        registry=_FakeReg({}), experiments=ExperimentRegistry()
    )
    # 例外を投げずに黙って戻る。
    sel.note(
        experiment_key="e",
        variant="c",
        stage="mt",
        metric_name="x",
        metric_value=1.0,
    )
    assert sel._pending == set()
