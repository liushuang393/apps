"""離線重跑トリガー API（P3-D）の単体テスト。

FastAPI DI/認証ハーネスを介さず、ハンドラ関数を直接呼んで分岐を検証する
（本プロジェクトは HTTP ルートの認証付き結合テストを持たないため軽量に確認する）。
reranker ビルダーを monkeypatch し、本地モデル不在（None）と実行成功の両経路を見る。
"""

import pytest
from fastapi import HTTPException

from app.ai_pipeline import rerun_routes
from app.ai_pipeline.offline_rerun import RerunSummary


@pytest.mark.asyncio
async def test_rerun_returns_503_when_no_reranker(monkeypatch) -> None:
    """本地モデル不在（builder が None）→ 503 を返す。"""
    monkeypatch.setattr(rerun_routes, "_build_reranker", lambda: None)
    with pytest.raises(HTTPException) as ei:
        await rerun_routes.trigger_session_rerun(session_id="s1", _admin=object())
    assert ei.value.status_code == 503


@pytest.mark.asyncio
async def test_rerun_returns_summary(monkeypatch) -> None:
    """reranker 有り → rerun_session を呼び集計を返す。"""

    class _FakeReranker:
        def __init__(self) -> None:
            self.called_with: str | None = None

        async def rerun_session(self, session_id: str) -> RerunSummary:
            self.called_with = session_id
            return RerunSummary(total=3, done=2, skipped=1, failed=0)

    fake = _FakeReranker()
    monkeypatch.setattr(rerun_routes, "_build_reranker", lambda: fake)
    resp = await rerun_routes.trigger_session_rerun(session_id="s1", _admin=object())
    assert fake.called_with == "s1"
    assert resp.session_id == "s1"
    assert resp.total == 3 and resp.done == 2 and resp.skipped == 1 and resp.failed == 0
