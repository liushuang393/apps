"""
チケット14: 旧 QoS 系の deletion test と利用 inventory。

検証観点:
    - production composition の品質制御は HybridQoSMonitor + QoE のみ到達可能
    - 旧 QoSController 系の利用は inventory で分類され、即時削除しない判断が残る
    - 単純な全文検索ではなく AST の import dependency boundary を検証する
    - 現行 monitor／QoE の品質 behavior baseline が成立する
    - 旧系が品質権威モジュールへ再導入されたら失敗する guard
"""

from __future__ import annotations

from pathlib import Path

from app.ai_pipeline.legacy_qos_boundary import (
    LEGACY_CONTROLLER_SYMBOLS,
    QUALITY_AUTHORITY_MODULES,
    UsageCategory,
    UsageRole,
    build_production_quality_composition,
    collect_legacy_symbol_imports,
    deletion_allowed,
    expected_inventory,
    inventory_by_key,
)
from app.ai_pipeline.qoe import QoEInput, QoEState, QoEStateMachine
from app.ai_pipeline.qos import (
    GLOSSARY_HIT_RATE_TARGET,
    HEARING_P95_TARGET_MS,
    NUMBER_RETENTION_TARGET,
    HybridQoSMonitor,
)


def _backend_root() -> Path:
    """backend/ ルート（app/ の親）を返す。"""
    return Path(__file__).resolve().parents[1]


def test_quality_authority_modules_do_not_import_legacy_controllers() -> None:
    """品質権威・主線 composition は旧 controller 系を import しない。"""
    root = _backend_root()
    hits = collect_legacy_symbol_imports(
        root,
        module_relpaths=QUALITY_AUTHORITY_MODULES,
        symbols=LEGACY_CONTROLLER_SYMBOLS,
    )
    assert hits == [], f"品質権威への旧 QoS 再導入: {hits}"


def test_inventory_covers_all_production_legacy_imports() -> None:
    """
    production の旧記号 import は inventory と一致する（漏れ・過剰登録を防ぐ）。

    テスト専用・docs は対象外。単純な文字列検索ではなく ImportFrom AST のみ。
    """
    root = _backend_root()
    actual = {
        (u.module_relpath, u.symbol, u.category, u.role)
        for u in collect_legacy_symbol_imports(
            root,
            module_relpaths=None,
            symbols=LEGACY_CONTROLLER_SYMBOLS
            | frozenset({"QoSMetrics", "QoSState", "DegradationLevel"}),
            production_only=True,
        )
    }
    expected = {
        (e.module_relpath, e.symbol, e.category, e.role)
        for e in expected_inventory()
        if e.category is not UsageCategory.TEST_ONLY
    }
    assert actual == expected


def test_inventory_distinguishes_test_only_import() -> None:
    """テスト専用 import が inventory で TEST_ONLY に分類される。"""
    entry = inventory_by_key("tests/test_ai_providers.py", "QoSController")
    assert entry is not None
    assert entry.category is UsageCategory.TEST_ONLY
    assert entry.role is UsageRole.MEASUREMENT


def test_inventory_classifies_residual_pipeline_as_measurement() -> None:
    """pipeline の QoSController 利用は測定に分類し、縮退 decision ではない。"""
    entry = inventory_by_key("app/ai_pipeline/pipeline.py", "QoSController")
    assert entry is not None
    assert entry.category is UsageCategory.PRODUCTION_COMPOSITION
    assert entry.role is UsageRole.MEASUREMENT
    assert entry.deletion_allowed is False


def test_adaptive_controller_has_no_production_import() -> None:
    """AdaptiveQoSController は production から到達不能（削除候補の判定材料）。"""
    root = _backend_root()
    hits = collect_legacy_symbol_imports(
        root,
        module_relpaths=None,
        symbols=frozenset({"AdaptiveQoSController"}),
        production_only=True,
    )
    assert hits == []
    assert deletion_allowed("AdaptiveQoSController") is False  # 同居記号がある間は維持


def test_no_public_http_api_exports_legacy_controllers() -> None:
    """公開 API 経路（routes）は旧 controller を import しない。"""
    root = _backend_root()
    route_files = sorted(
        p.relative_to(root).as_posix() for p in (root / "app").rglob("*routes*.py")
    )
    hits = collect_legacy_symbol_imports(
        root,
        module_relpaths=tuple(route_files),
        symbols=LEGACY_CONTROLLER_SYMBOLS,
    )
    assert hits == []


def test_production_quality_composition_exposes_monitor_and_qoe_only() -> None:
    """architecture seam: 品質制御の到達可能面は monitor + QoE のみ。"""
    composition = build_production_quality_composition()
    assert isinstance(composition.monitor, HybridQoSMonitor)
    assert isinstance(composition.qoe, QoEStateMachine)
    assert composition.legacy_controller is None
    assert type(composition.monitor).__name__ == "HybridQoSMonitor"
    assert type(composition.qoe).__name__ == "QoEStateMachine"


def test_behavior_baseline_hearing_p95_warning() -> None:
    """behavior baseline: hearing P95 超過は warning（測定）として観測される。"""
    composition = build_production_quality_composition()
    monitor = composition.monitor
    for _ in range(10):
        monitor.record_latency("hearing", HEARING_P95_TARGET_MS + 1000.0)
    warn = monitor.evaluate_latency("hearing")
    assert warn is not None
    assert warn["type"] == "qos_warning"
    assert warn["metric"] == "latency_p95"
    assert warn["mainline"] == "hearing"
    assert warn["should_fallback_to_subtitle"] is True
    # 停止の最終判断は QoE（monitor は観測のみ）
    assert monitor.hearing_p95_exceeded() is True


def test_behavior_baseline_degradation_and_cooldown() -> None:
    """behavior baseline: 縮退 decision と cooldown 回復は QoE 権威のみ。"""
    now = [0.0]
    composition = build_production_quality_composition(clock=lambda: now[0])
    qoe = composition.qoe

    degraded = qoe.evaluate(QoEInput(hearing_degraded=True))
    assert degraded.state is QoEState.HEARING_DEGRADED
    assert degraded.hearing_available is False
    assert degraded.reading_available is True

    now[0] = 1.0
    held = qoe.evaluate(QoEInput(hearing_degraded=False))
    assert held.state is QoEState.HEARING_DEGRADED
    assert held.hearing_available is False

    now[0] = 10.0
    recovered = qoe.evaluate(QoEInput(hearing_degraded=False))
    assert recovered.state is QoEState.HEALTHY
    assert recovered.hearing_available is True
    assert recovered.changed is True


def test_behavior_baseline_glossary_and_number_retention() -> None:
    """behavior baseline: 用語命中率・数字保持率の warning が現行 monitor で維持される。"""
    composition = build_production_quality_composition()
    monitor = composition.monitor

    monitor.record_glossary(5, 10)
    gwarn = monitor.evaluate_glossary()
    assert gwarn is not None
    assert gwarn["metric"] == "glossary_hit_rate"
    assert gwarn["target"] == GLOSSARY_HIT_RATE_TARGET

    monitor.record_number_retention("価格 100 個数 3", "price 100 qty 9")
    nwarn = monitor.evaluate_number_retention()
    assert nwarn is not None
    assert nwarn["metric"] == "number_retention_rate"
    assert nwarn["target"] == NUMBER_RETENTION_TARGET


def test_reintroducing_legacy_into_orchestrator_would_be_detected(
    tmp_path: Path,
) -> None:
    """旧系を品質権威モジュールへ再導入すると boundary 検査が失敗する。"""
    fake_app = tmp_path / "app" / "ai_pipeline"
    fake_app.mkdir(parents=True)
    offender = fake_app / "orchestrator.py"
    offender.write_text(
        "from app.ai_pipeline.qos import QoSController\n",
        encoding="utf-8",
    )
    # ルートを tmp に差し替え、QUALITY_AUTHORITY_MODULES 相当を検査する
    hits = collect_legacy_symbol_imports(
        tmp_path,
        module_relpaths=("app/ai_pipeline/orchestrator.py",),
        symbols=LEGACY_CONTROLLER_SYMBOLS,
    )
    assert len(hits) == 1
    assert hits[0].symbol == "QoSController"
