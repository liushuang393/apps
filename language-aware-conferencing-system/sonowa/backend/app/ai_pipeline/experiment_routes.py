"""
A/B 実験の照会・集計 API（改善案 §5.1 / P4-C）。

設定済みの実験定義（experiments_config）の照会と、実験群ごとの観測指標
（ExperimentMetric）の群間比較集計を提供する。管理者専用。

設計原則:
    - 実験定義は build_experiment_registry で fail-safe に読む（不正設定は空/スキップ）。
    - 集計は app.db.experiments.summarize_experiment（DB group by）に委譲する。
    - registry ビルダーは差し替え可能（テストで monkeypatch 可能な間接層）。
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.ai_pipeline.ab_testing import (
    ExperimentRegistry,
    build_experiment_registry,
)
from app.auth.dependencies import require_admin
from app.db.experiments import summarize_experiment
from app.db.models import User

logger = logging.getLogger(__name__)

router = APIRouter()


class VariantView(BaseModel):
    """実験群の表示ビュー。"""

    name: str
    model_id: str
    weight: int


class ExperimentView(BaseModel):
    """実験定義の表示ビュー。"""

    key: str
    stage: str
    unit: str
    enabled: bool
    variants: list[VariantView]


class ExperimentSummaryResponse(BaseModel):
    """実験の群×指標の集計結果。

    summary: {variant: {metric_name: {count, mean, min, max}}}。
    """

    experiment_key: str
    summary: dict[str, dict[str, dict[str, float]]]


def _build_registry() -> ExperimentRegistry:
    """既定の実験登録簿を構築する（テストで monkeypatch 可能な間接層）。"""
    return build_experiment_registry()


@router.get("/experiments", response_model=list[ExperimentView])
async def list_experiments(
    _admin: User = Depends(require_admin),
) -> list[ExperimentView]:
    """設定済みの A/B 実験一覧を返す（管理者専用）。"""
    registry = _build_registry()
    return [
        ExperimentView(
            key=exp.key,
            stage=exp.stage,
            unit=exp.unit,
            enabled=exp.enabled,
            variants=[
                VariantView(name=v.name, model_id=v.model_id, weight=v.weight)
                for v in exp.variants
            ],
        )
        for exp in registry.list()
    ]


@router.get(
    "/experiments/{experiment_key}/summary",
    response_model=ExperimentSummaryResponse,
)
async def get_experiment_summary(
    experiment_key: str,
    _admin: User = Depends(require_admin),
) -> ExperimentSummaryResponse:
    """実験群ごとの観測指標を集計して返す（管理者専用）。

    該当観測が無い実験は summary が空 dict になる（実験未実施・キー誤り）。
    """
    summary = await summarize_experiment(experiment_key)
    return ExperimentSummaryResponse(experiment_key=experiment_key, summary=summary)
