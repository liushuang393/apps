"""
A/B テスト配信（Experiment Routing / 改善案 §5.1 P4-C）。

目的:
    モデル/adapter の候補（model_registry の ModelCard）を、決定的なハッシュ配信で
    実験群（variant）へ割り当てる。同一 unit（会議/利用者/セッション）は常に同じ
    variant へ落ちるため、実験の一貫性と再現性を保証する（乱数・時刻に依存しない）。
責務境界（重要）:
    本モジュールは「どの unit をどの variant へ配信するか」という純ロジックのみを扱う。
    variant の実体（実際のモデル解決）は registry.py、カタログ治理は model_registry.py。
    指標の収集・集計は app.db.experiments（DB 永続層）が担う。
設計原則:
    - 決定的: 割り当ては sha256(key:unit_id) のバケットのみで決まる（salt 付き組み込み
      hash() や乱数・時刻を使わない。プロセス跨ぎで安定）。
    - 既定無効/安全: 実験が無効・variant 空・unit_id 欠落・重み総和 0 なら None を返し、
      呼び出し側は既定（非実験）経路へフォールバックする。
"""

import hashlib
import json
import logging
from dataclasses import dataclass

from app.ai_pipeline.model_registry import STAGES
from app.config import settings

logger = logging.getLogger(__name__)

# 配信単位（どの id でバケットするか）。
UNIT_ROOM = "room"
UNIT_USER = "user"
UNIT_SESSION = "session"
UNITS: frozenset[str] = frozenset({UNIT_ROOM, UNIT_USER, UNIT_SESSION})


@dataclass(frozen=True)
class ExperimentVariant:
    """実験群 1 件。

    name: 群名（例: "control" / "treatment"）。実験内で一意。
    model_id: この群で用いる ModelCard の model_id（実体解決は registry.py）。
    weight: 配信重み（正の整数）。総和に対する比率で配信される。
    """

    name: str
    model_id: str
    weight: int = 1

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("variant.name は必須です")
        if not self.model_id:
            raise ValueError("variant.model_id は必須です")
        if self.weight <= 0:
            raise ValueError(f"variant.weight は正の整数: {self.weight!r}")


@dataclass(frozen=True)
class Experiment:
    """A/B 実験 1 件。

    key: 実験の一意キー（配信ハッシュ・指標集計のキー）。
    stage: 対象ステージ（model_registry.STAGES のいずれか）。
    variants: 実験群のタプル（1 件以上・name 一意）。
    unit: 配信単位（room/user/session）。
    enabled: 有効フラグ（False なら assign は None）。
    """

    key: str
    stage: str
    variants: tuple[ExperimentVariant, ...]
    unit: str = UNIT_SESSION
    enabled: bool = True

    def __post_init__(self) -> None:
        if not self.key:
            raise ValueError("experiment.key は必須です")
        if self.stage not in STAGES:
            raise ValueError(
                f"未知の stage: {self.stage!r}（許可={sorted(STAGES)}）"
            )
        if self.unit not in UNITS:
            raise ValueError(f"未知の unit: {self.unit!r}（許可={sorted(UNITS)}）")
        if not self.variants:
            raise ValueError("experiment.variants は 1 件以上必要です")
        names = [v.name for v in self.variants]
        if len(names) != len(set(names)):
            raise ValueError(f"variant.name が重複: {names}")

    @property
    def total_weight(self) -> int:
        """配信重みの総和。"""
        return sum(v.weight for v in self.variants)


def assign(experiment: Experiment, unit_id: str | None) -> ExperimentVariant | None:
    """unit_id を実験群へ決定的に割り当てる（非該当は None）。

    入力: 実験定義と配信単位の id（会議/利用者/セッション id）。
    出力: 割り当てられた ExperimentVariant（無効・欠落時は None）。
    注意点: 同一 (key, unit_id) は常に同じ variant を返す（sha256 バケット）。
        乱数・時刻・組み込み hash() は使わない（プロセス跨ぎで安定させるため）。
    """
    if not experiment.enabled or not experiment.variants or not unit_id:
        return None
    total = experiment.total_weight
    if total <= 0:
        return None
    # sha256 は salt 無しでプロセス跨ぎ安定。上位 16 進を整数化しバケット化する。
    digest = hashlib.sha256(f"{experiment.key}:{unit_id}".encode()).hexdigest()
    bucket = int(digest, 16) % total
    cumulative = 0
    for variant in experiment.variants:
        cumulative += variant.weight
        if bucket < cumulative:
            return variant
    # 到達しない想定（数値の保険）。最後の variant を返す。
    return experiment.variants[-1]


def resolve_unit_id(
    experiment: Experiment,
    *,
    room_id: str | None = None,
    user_id: str | None = None,
    session_id: str | None = None,
) -> str | None:
    """実験の配信単位に対応する id を選ぶ（無ければ None）。"""
    if experiment.unit == UNIT_ROOM:
        return room_id
    if experiment.unit == UNIT_USER:
        return user_id
    return session_id


class ExperimentRegistry:
    """実験定義の登録簿（登録・照会）。実行時の実体解決は行わない。"""

    def __init__(self) -> None:
        self._by_key: dict[str, Experiment] = {}
        # stage → 実験キー一覧（登録順）。
        self._by_stage: dict[str, list[str]] = {}

    def register(self, experiment: Experiment) -> None:
        """実験を登録する（同一 key は上書き）。"""
        if experiment.key in self._by_key:
            logger.info("[AB] 既存実験を上書き: %s", experiment.key)
            # 既存の stage 索引から除去してから再登録する（stage 変更に追従）。
            for keys in self._by_stage.values():
                if experiment.key in keys:
                    keys.remove(experiment.key)
        self._by_key[experiment.key] = experiment
        self._by_stage.setdefault(experiment.stage, []).append(experiment.key)

    def get(self, key: str) -> Experiment | None:
        """key で実験を取得する（無ければ None）。"""
        return self._by_key.get(key)

    def for_stage(self, stage: str, *, enabled_only: bool = True) -> list[Experiment]:
        """指定ステージの実験一覧を返す（登録順）。"""
        result: list[Experiment] = []
        for key in self._by_stage.get(stage, []):
            exp = self._by_key.get(key)
            if exp is None:
                continue
            if enabled_only and not exp.enabled:
                continue
            result.append(exp)
        return result

    def list(self) -> list[Experiment]:
        """登録済み実験の一覧（登録順）。"""
        return list(self._by_key.values())


def _parse_variant(raw: dict) -> ExperimentVariant:
    """dict から ExperimentVariant を生成する（不正は ValueError）。"""
    return ExperimentVariant(
        name=str(raw["name"]),
        model_id=str(raw["model_id"]),
        weight=int(raw.get("weight", 1)),
    )


def _parse_experiment(raw: dict) -> Experiment:
    """dict から Experiment を生成する（不正は ValueError）。"""
    variants = tuple(_parse_variant(v) for v in raw.get("variants", []))
    return Experiment(
        key=str(raw["key"]),
        stage=str(raw["stage"]),
        variants=variants,
        unit=str(raw.get("unit", UNIT_SESSION)),
        enabled=bool(raw.get("enabled", True)),
    )


def build_experiment_registry() -> ExperimentRegistry:
    """settings から実験定義を読み ExperimentRegistry を構築する（fail-safe）。

    出力: 設定された実験を登録した ExperimentRegistry（無効・不正時は空の登録簿）。
    注意点: enable_ab_testing=False・JSON 不正・個別実験不正は空/当該のみスキップし、
        例外を投げない（実験設定の誤りでライブを壊さない）。
    """
    registry = ExperimentRegistry()
    if not settings.enable_ab_testing:
        return registry
    raw = (settings.experiments_config or "").strip()
    if not raw:
        return registry
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError) as e:
        logger.warning("[AB] experiments_config の JSON 解析に失敗: %s", e)
        return registry
    if not isinstance(parsed, list):
        logger.warning("[AB] experiments_config は配列である必要があります")
        return registry
    for item in parsed:
        try:
            registry.register(_parse_experiment(item))
        except (ValueError, KeyError, TypeError) as e:
            logger.warning("[AB] 不正な実験定義をスキップ: %s（%s）", item, e)
    return registry
