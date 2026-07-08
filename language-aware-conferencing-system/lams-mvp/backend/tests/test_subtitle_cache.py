"""字幕翻訳の失敗がキャッシュ固定化されないことのテスト（欠陥 #15）。"""

from unittest.mock import AsyncMock

import pytest

from app.translate import subtitle_cache


@pytest.mark.asyncio
async def test_release_claim_deletes_pending_marker(monkeypatch) -> None:
    fake_redis = AsyncMock()

    async def get_redis() -> AsyncMock:
        return fake_redis

    monkeypatch.setattr(subtitle_cache, "_get_redis", get_redis)

    await subtitle_cache.release_claim("sub-1", "en")
    fake_redis.delete.assert_awaited_once_with(
        subtitle_cache._pending_key("sub-1", "en")
    )


@pytest.mark.asyncio
async def test_translation_error_not_cached(monkeypatch) -> None:
    """翻訳例外時に store_translation（原文の ready 固定化）を呼ばない。"""
    from app.translate import routes

    stored: list = []
    monkeypatch.setattr(
        subtitle_cache, "get_translation", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        subtitle_cache,
        "get_original",
        AsyncMock(return_value=("こんにちは", "ja")),
    )
    monkeypatch.setattr(
        subtitle_cache, "mark_translation_pending", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(
        subtitle_cache,
        "store_translation",
        AsyncMock(side_effect=lambda *a: stored.append(a)),
    )
    released = AsyncMock()
    monkeypatch.setattr(subtitle_cache, "release_claim", released)

    async def boom(_text: str, _src: str, _tgt: str) -> str:
        raise RuntimeError("api down")

    monkeypatch.setattr(routes, "translate_text_simple", boom)

    resp = await routes.get_subtitle_translation("sub-1", "en", wait=True)
    assert resp.status == "error"
    assert stored == []  # 原文が翻訳としてキャッシュされない
    released.assert_awaited_once()
