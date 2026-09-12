"""読む主線向け翻訳エンジンの単体テスト。"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.ai_pipeline.qos import HybridQoSMonitor
from app.translate import engine
from app.translate.glossary import GlossaryMatch


@pytest.mark.asyncio
async def test_same_language_returns_original_text() -> None:
    """翻訳元と翻訳先が同じ場合は外部処理なしで原文を返す。"""
    assert await engine.translate_text("同じ文章", "ja", "ja") == "同じ文章"


@pytest.mark.asyncio
async def test_empty_stripped_text_returns_original_text() -> None:
    """空白だけの入力は空白を保持したまま返す。"""
    assert await engine.translate_text(" \n ", "ja", "en") == " \n "


@pytest.mark.asyncio
async def test_explicit_qos_monitor_records_glossary_without_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """明示モニター指定時は ContextVar を使わず用語命中を直接記録する。"""
    redis = MagicMock()
    redis.get = AsyncMock(return_value=None)
    monkeypatch.setattr(engine, "_get_redis", AsyncMock(return_value=redis))
    monkeypatch.setattr(engine, "_glossary_version", AsyncMock(return_value="1"))
    monkeypatch.setattr(
        engine.translation_memory,
        "lookup",
        AsyncMock(return_value="请进行审批"),
    )
    monkeypatch.setattr(
        engine.glossary,
        "match_terms_for_text",
        AsyncMock(
            return_value=[
                GlossaryMatch(
                    source_term="承認",
                    target_term="审批",
                    do_not_translate=False,
                    priority=10,
                )
            ]
        ),
    )
    context_fallback = MagicMock()
    monkeypatch.setattr(engine, "record_glossary_if_bound", context_fallback)
    monitor = MagicMock(spec=HybridQoSMonitor)

    translated = await engine.translate_text(
        "承認を進めてください",
        "ja",
        "zh",
        qos_monitor=monitor,
    )

    assert translated == "请进行审批"
    monitor.record_glossary.assert_called_once_with(1, 1)
    context_fallback.assert_not_called()
