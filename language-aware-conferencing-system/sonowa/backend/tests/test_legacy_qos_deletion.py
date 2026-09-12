"""
チケット14 follow-up: 旧 QoS 記号の実削除と再導入防止。

検証観点:
    - production／test から旧 QoS 記号への ImportFrom がゼロ
    - qos.py に旧 class 定義が残っていない
    - pipeline 測定は非権威 API（PipelineLatencyMetrics）へ移行済み
    - 品質権威 composition は HybridQoSMonitor + QoE のみ
    - glossary／number／hearing P95／cooldown の behavior baseline 維持
    - 旧系の再導入（import または定義）は guard で検出される
"""

from __future__ import annotations

import ast
from pathlib import Path

from app.ai_pipeline.legacy_qos_boundary import (
    LEGACY_CONTROLLER_SYMBOLS,
    LEGACY_QOS_SYMBOLS,
    LEGACY_RELATED_SYMBOLS,
    QUALITY_AUTHORITY_MODULES,
    build_production_quality_composition,
    collect_legacy_symbol_definitions,
    collect_legacy_symbol_imports,
    deletion_allowed,
    expected_inventory,
)
from app.ai_pipeline.pipeline import AIPipeline, PipelineLatencyMetrics
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


def test_no_production_or_test_imports_of_legacy_symbols() -> None:
    """
    旧記号の ImportFrom は production／tests ともにゼロ（削除完了の一次条件）。

    単純な文字列検索ではなく ImportFrom AST のみ。定義モジュール自身は除外。
    """
    root = _backend_root()
    hits = collect_legacy_symbol_imports(
        root,
        module_relpaths=None,
        symbols=LEGACY_QOS_SYMBOLS,
        production_only=False,
    )
    # tests 配下も含めてゼロ（削除後はテストも現行 seam のみを使う）
    assert hits == [], f"旧 QoS import 残存: {hits}"
    assert expected_inventory() == ()


def test_legacy_symbols_are_not_defined_in_qos_module() -> None:
    """qos.py に旧 class 定義が残っていない（再導入防止の定義側 guard）。"""
    root = _backend_root()
    defined = collect_legacy_symbol_definitions(root)
    assert defined == [], f"qos.py に旧記号定義が残存: {defined}"


def test_deletion_allowed_for_all_legacy_symbols() -> None:
    """削除完了後は全旧記号が deletion_allowed。"""
    for symbol in sorted(LEGACY_QOS_SYMBOLS):
        assert deletion_allowed(symbol) is True, symbol


def test_pipeline_uses_non_authoritative_latency_metrics() -> None:
    """pipeline 測定は PipelineLatencyMetrics（縮退 decision フィールドなし）。"""
    fields = {f.name for f in PipelineLatencyMetrics.__dataclass_fields__.values()}
    assert "total_latency_ms" in fields
    assert "degradation_level" not in fields
    assert "should_fallback_to_subtitle" not in fields

    pipeline_src = (_backend_root() / "app/ai_pipeline/pipeline.py").read_text(
        encoding="utf-8"
    )
    tree = ast.parse(pipeline_src)
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "app.ai_pipeline.qos":
            imported.update(alias.name for alias in node.names)
    assert imported.isdisjoint(LEGACY_QOS_SYMBOLS)
    # HybridQoSMonitor への移行も許容するが、現状は pipeline 内の非権威測定
    assert "PipelineLatencyMetrics" in pipeline_src

    pipeline = AIPipeline()
    assert not hasattr(pipeline, "_qos")


def test_no_public_http_api_exports_legacy_controllers() -> None:
    """公開 API 経路（routes）は旧 controller を import しない。"""
    root = _backend_root()
    route_files = sorted(
        p.relative_to(root).as_posix() for p in (root / "app").rglob("*routes*.py")
    )
    hits = collect_legacy_symbol_imports(
        root,
        module_relpaths=tuple(route_files),
        symbols=LEGACY_CONTROLLER_SYMBOLS | LEGACY_RELATED_SYMBOLS,
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


def test_reintroducing_legacy_import_into_orchestrator_is_detected(
    tmp_path: Path,
) -> None:
    """旧系を品質権威モジュールへ import 再導入すると boundary 検査が失敗する。"""
    fake_app = tmp_path / "app" / "ai_pipeline"
    fake_app.mkdir(parents=True)
    offender = fake_app / "orchestrator.py"
    offender.write_text(
        "from app.ai_pipeline.qos import QoSController\n",
        encoding="utf-8",
    )
    hits = collect_legacy_symbol_imports(
        tmp_path,
        module_relpaths=("app/ai_pipeline/orchestrator.py",),
        symbols=LEGACY_CONTROLLER_SYMBOLS,
    )
    assert len(hits) == 1
    assert hits[0].symbol == "QoSController"


def test_reintroducing_legacy_definition_into_qos_is_detected(
    tmp_path: Path,
) -> None:
    """qos.py へ旧 class 定義を戻すと定義側 guard が検出する。"""
    fake_app = tmp_path / "app" / "ai_pipeline"
    fake_app.mkdir(parents=True)
    (fake_app / "qos.py").write_text(
        "class QoSController:\n    pass\n\nclass QoSMetrics:\n    pass\n",
        encoding="utf-8",
    )
    defined = collect_legacy_symbol_definitions(tmp_path)
    assert set(defined) == {"QoSController", "QoSMetrics"}
