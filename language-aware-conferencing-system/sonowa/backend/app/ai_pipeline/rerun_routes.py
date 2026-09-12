"""
離線高質量重跑のトリガー API（改善案 §5.3 / P3-D）。

会議後に、記録済みの中間パイプライン事件（PipelineEvent）を最強モデルで再処理し、
高品質な ASR/翻訳結果（RerunResult）と、実時出力との差分から訓練訂正候補（既定
holdout）を生成する。管理者専用。実行は重いため同期呼び出しは小規模セッション向け。

設計原則:
    - 本地モデル（.[local]）未導入・GPU 不在の環境では reranker を構築できないため、
      503 を返して明示する（沈黙の無処理を避ける）。
    - reranker ビルダーは差し替え可能（テストで注入）。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.ai_pipeline.offline_rerun import OfflineReranker, build_default_reranker
from app.auth.dependencies import require_admin
from app.db.models import User

logger = logging.getLogger(__name__)

router = APIRouter()


class RerunSummaryResponse(BaseModel):
    """離線重跑の集計結果。"""

    session_id: str
    total: int
    done: int
    skipped: int
    failed: int


def _build_reranker() -> OfflineReranker | None:
    """既定の reranker を構築する（テストで monkeypatch 可能な間接層）。"""
    return build_default_reranker()


@router.post("/sessions/{session_id}/rerun", response_model=RerunSummaryResponse)
async def trigger_session_rerun(
    session_id: str,
    _admin: User = Depends(require_admin),
) -> RerunSummaryResponse:
    """指定セッションの中間事件を最強モデルで離線再処理する（管理者専用）。

    利用可能な本地モデルが無い場合は 503 を返す。
    """
    reranker = _build_reranker()
    if reranker is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "離線重跑に利用可能な本地モデルがありません"
                "（.[local] 未導入 または ASR/MT いずれも不可）。"
            ),
        )
    logger.info("[RERUN] セッション再処理を開始: session=%s", session_id)
    summary = await reranker.rerun_session(session_id)
    return RerunSummaryResponse(
        session_id=session_id,
        total=summary.total,
        done=summary.done,
        skipped=summary.skipped,
        failed=summary.failed,
    )
