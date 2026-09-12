"""A/B 実験の観測指標の記録・集計（改善案 §5.1 / P4-C）。

目的:
    実験群（variant）ごとの品質/遅延などの観測値を ExperimentMetric として蓄積し、
    群間比較（件数・平均・最小/最大）で優劣を判定する集計を提供する。

設計原則:
    - 記録系（record_*）は失敗をログのみで握り、ライブ動作を壊さない（app.db.replay 踏襲）。
      成功時のみ id を返し、失敗時は None を返す。
    - 集計系（summarize_*）は DB 側で group by 集約し、失敗時は空 dict を返す。
    - セッションは app.db.database.async_session を用いる（テストは差し替え可能）。
"""

import logging

from sqlalchemy import func, select

from app.db.database import async_session
from app.db.models import ExperimentMetric

logger = logging.getLogger(__name__)


async def record_experiment_metric(
    *,
    experiment_key: str,
    variant: str,
    metric_name: str,
    metric_value: float,
    unit_id: str | None = None,
    stage: str | None = None,
    room_id: str | None = None,
    session_id: str | None = None,
) -> str | None:
    """ExperimentMetric を1件保存し id を返す（失敗時 None）。

    入力: 実験キー・群名・指標名/値と各種参照 id（unit_id/stage/room/session）。
    出力: 保存した ExperimentMetric.id（失敗時 None）。
    注意点: 記録失敗はログのみで握りライブを壊さない。1 観測 = 1 行。
    """
    row = ExperimentMetric(
        experiment_key=experiment_key,
        variant=variant,
        metric_name=metric_name,
        metric_value=float(metric_value),
        unit_id=unit_id,
        stage=stage,
        room_id=room_id,
        session_id=session_id,
    )
    try:
        async with async_session() as db:
            db.add(row)
            await db.commit()
            await db.refresh(row)
            return row.id
    except Exception as e:  # noqa: BLE001 - 記録失敗はライブを壊さない
        logger.warning("[AB] experiment_metric 保存エラー: %s", e)
        return None


async def summarize_experiment(
    experiment_key: str,
) -> dict[str, dict[str, dict[str, float]]]:
    """実験の群×指標を集計する（失敗時は空 dict）。

    入力: 対象の experiment_key。
    出力: {variant: {metric_name: {"count": n, "mean": m, "min": mn, "max": mx}}}。
    注意点: 集計は DB 側 group by（variant, metric_name）で行う。該当なしは空 dict。
        群間比較は呼び出し側で mean を突き合わせて判定する（本関数は判断しない）。
    """
    try:
        async with async_session() as db:
            stmt = (
                select(
                    ExperimentMetric.variant,
                    ExperimentMetric.metric_name,
                    func.count(ExperimentMetric.id),
                    func.avg(ExperimentMetric.metric_value),
                    func.min(ExperimentMetric.metric_value),
                    func.max(ExperimentMetric.metric_value),
                )
                .where(ExperimentMetric.experiment_key == experiment_key)
                .group_by(ExperimentMetric.variant, ExperimentMetric.metric_name)
            )
            rows = (await db.execute(stmt)).all()
    except Exception as e:  # noqa: BLE001 - 集計失敗はライブを壊さない
        logger.warning("[AB] summarize_experiment エラー: %s", e)
        return {}

    result: dict[str, dict[str, dict[str, float]]] = {}
    for variant, metric_name, count, mean, mn, mx in rows:
        result.setdefault(variant, {})[metric_name] = {
            "count": int(count),
            "mean": float(mean) if mean is not None else 0.0,
            "min": float(mn) if mn is not None else 0.0,
            "max": float(mx) if mx is not None else 0.0,
        }
    return result
