"""
旧 QoS controller 系の利用 inventory と production dependency boundary。

目的:
    旧系記号の削除完了後も、import／定義の再導入を検出する。
    品質権威は HybridQoSMonitor + QoE のみ。
入力:
    backend ルートと検査対象モジュール相対パス。
出力:
    LegacyUsage 一覧、品質 composition、削除可否判定、定義残存一覧。
注意:
    単純な全文検索は使わず、ImportFrom／ClassDef の AST のみを対象とする。
"""

from __future__ import annotations

import ast
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from app.ai_pipeline.qoe import QoEStateMachine
from app.ai_pipeline.qos import HybridQoSMonitor

# 旧 latency controller 系（縮退権威として再利用禁止・削除済み）
LEGACY_CONTROLLER_SYMBOLS: frozenset[str] = frozenset(
    {
        "QoSController",
        "AdaptiveQoSController",
    }
)

# 旧系の関連型（controller と同居していた削除済み記号）
LEGACY_RELATED_SYMBOLS: frozenset[str] = frozenset(
    {
        "QoSMetrics",
        "QoSState",
        "DegradationLevel",
    }
)

LEGACY_QOS_SYMBOLS: frozenset[str] = LEGACY_CONTROLLER_SYMBOLS | LEGACY_RELATED_SYMBOLS

# 品質権威・主線 composition。ここに旧 controller が再導入されたら deletion test が失敗する。
QUALITY_AUTHORITY_MODULES: tuple[str, ...] = (
    "app/ai_pipeline/orchestrator.py",
    "app/ai_pipeline/qoe.py",
    "app/ai_pipeline/output_manager/__init__.py",
    "app/ai_pipeline/output_manager/manager.py",
    "app/ai_pipeline/output_manager/adapter.py",
    "app/ai_pipeline/output_manager/commands.py",
    "app/ai_pipeline/output_manager/sink_adapter.py",
    "app/webrtc/agent.py",
    "app/webrtc/processor.py",
    "app/webrtc/persistence.py",
)


class UsageCategory(str, Enum):
    """利用箇所の境界分類。"""

    PRODUCTION_COMPOSITION = "production_composition"
    RUNTIME_IMPORT = "runtime_import"
    PUBLIC_API = "public_api"
    TEST_ONLY = "test_only"
    UNCLASSIFIED = "unclassified"


class UsageRole(str, Enum):
    """旧系利用の役割分類（削除判断用）。"""

    MEASUREMENT = "measurement"
    WARNING = "warning"
    DEGRADATION_DECISION = "degradation_decision"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class LegacyUsage:
    """旧 QoS 記号の 1 利用エントリ。"""

    module_relpath: str
    symbol: str
    category: UsageCategory
    role: UsageRole
    deletion_allowed: bool
    notes: str


@dataclass(frozen=True)
class QualityComposition:
    """production 品質制御の到達可能面（monitor + QoE のみ）。"""

    monitor: HybridQoSMonitor
    qoe: QoEStateMachine
    legacy_controller: None


def expected_inventory() -> tuple[LegacyUsage, ...]:
    """
    利用 inventory（分類済み）。

    削除完了後は production／test ともに旧記号 import はゼロ。
    再導入は collect_legacy_symbol_imports／definitions が検出する。
    """
    return ()


def inventory_by_key(module_relpath: str, symbol: str) -> LegacyUsage | None:
    """module + symbol で inventory エントリを返す。"""
    for entry in expected_inventory():
        if entry.module_relpath == module_relpath and entry.symbol == symbol:
            return entry
    return None


def deletion_allowed(symbol: str) -> bool:
    """
    旧記号の削除可否。

    削除完了後は登録済み旧記号すべてが True。
    未知記号は再導入候補として False。
    """
    return symbol in LEGACY_QOS_SYMBOLS


def build_production_quality_composition(
    *,
    clock: Callable[[], float] | None = None,
    recovery_cooldown_s: float | None = None,
) -> QualityComposition:
    """
    production 相当の品質制御 composition を構築する architecture seam。

    旧 QoSController は組み立てに含めない（legacy_controller は常に None）。
    """
    monitor = HybridQoSMonitor()
    if clock is None and recovery_cooldown_s is None:
        qoe = QoEStateMachine()
    elif clock is None:
        assert recovery_cooldown_s is not None
        qoe = QoEStateMachine(recovery_cooldown_s=recovery_cooldown_s)
    elif recovery_cooldown_s is None:
        qoe = QoEStateMachine(clock=clock)
    else:
        qoe = QoEStateMachine(clock=clock, recovery_cooldown_s=recovery_cooldown_s)
    return QualityComposition(monitor=monitor, qoe=qoe, legacy_controller=None)


def _iter_python_files(
    root: Path, module_relpaths: Sequence[str] | None
) -> Iterable[Path]:
    """検査対象の .py ファイルを列挙する。"""
    if module_relpaths is not None:
        for rel in module_relpaths:
            path = root / rel
            if path.is_file():
                yield path
        return
    app_dir = root / "app"
    if app_dir.is_dir():
        yield from sorted(app_dir.rglob("*.py"))
    tests_dir = root / "tests"
    if tests_dir.is_dir():
        yield from sorted(tests_dir.rglob("*.py"))


def _is_production_path(relpath: str) -> bool:
    """app/ 配下かつ tests 配下でないパスを production とみなす。"""
    return relpath.startswith("app/") and "/tests/" not in relpath


def _imported_names(node: ast.ImportFrom, symbols: frozenset[str]) -> list[str]:
    """ImportFrom から対象記号名を抽出する。"""
    found: list[str] = []
    for alias in node.names:
        name = alias.name
        if name in symbols:
            found.append(name)
        # from module import * は境界検査では禁止扱い（明示 import のみ許可）
        if name == "*":
            found.extend(sorted(symbols))
    return found


def collect_legacy_symbol_imports(
    root: Path,
    *,
    module_relpaths: Sequence[str] | None,
    symbols: frozenset[str],
    production_only: bool = False,
) -> list[LegacyUsage]:
    """
    ImportFrom AST から旧 QoS 記号の依存を収集する。

    production_only=True のときは app/ 配下のみ。
    inventory 登録済みなら分類を付与し、未登録は UNCLASSIFIED として返す。
    """
    catalog = {
        (entry.module_relpath, entry.symbol): entry for entry in expected_inventory()
    }
    results: list[LegacyUsage] = []
    seen: set[tuple[str, str]] = set()

    for path in _iter_python_files(root, module_relpaths):
        try:
            relpath = path.relative_to(root).as_posix()
        except ValueError:
            continue
        if production_only and not _is_production_path(relpath):
            continue
        # 境界モジュール自身の自己参照は inventory 対象外
        if relpath == "app/ai_pipeline/legacy_qos_boundary.py":
            continue
        # 削除済み記号の定義場所だった qos.py は import 対象外（定義は別 API）
        if relpath == "app/ai_pipeline/qos.py":
            continue
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom):
                continue
            for symbol in _imported_names(node, symbols):
                key = (relpath, symbol)
                if key in seen:
                    continue
                seen.add(key)
                if key in catalog:
                    results.append(catalog[key])
                else:
                    results.append(
                        LegacyUsage(
                            module_relpath=relpath,
                            symbol=symbol,
                            category=UsageCategory.UNCLASSIFIED,
                            role=UsageRole.UNKNOWN,
                            deletion_allowed=False,
                            notes="inventory 未登録の production／検査対象依存",
                        )
                    )
    return sorted(results, key=lambda u: (u.module_relpath, u.symbol))


def collect_legacy_symbol_definitions(root: Path) -> list[str]:
    """
    qos.py に残る旧記号の ClassDef 名を収集する。

    入力:
        backend ルート。
    出力:
        検出した旧記号名（ソート済み）。無ければ空。
    注意:
        削除後は常に空であるべき。再導入防止の定義側 guard。
    """
    path = root / "app" / "ai_pipeline" / "qos.py"
    if not path.is_file():
        return []
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name in LEGACY_QOS_SYMBOLS:
            found.append(node.name)
    return sorted(set(found))
