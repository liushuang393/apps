"""
translate_text_simple 経由の用語集 QoS 配線テスト。

目的:
    本番翻訳経路で measure_glossary_hits → record_glossary_if_bound が動くことを保証する。
"""

from __future__ import annotations

import pytest

from app.ai_pipeline.qos import (
    HybridQoSMonitor,
    bind_qos_monitor,
    reset_qos_monitor,
)
from app.translate import engine as translate_engine
from app.translate import glossary as glossary_mod
from app.translate import routes as translate_routes
from app.translate.glossary import GlossaryMatch


@pytest.mark.asyncio
async def test_translate_text_simple_records_glossary_qos(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """翻訳成功時に bind 済み QoS モニターへ用語命中が記録される。"""

    async def _fake_openai(
        text: str, source_language: str, target_language: str
    ) -> str:
        assert "承認" in text
        assert source_language == "ja"
        assert target_language == "zh"
        return "请进行审批操作"

    async def _fake_matches(
        _text: str, _source_language: str, _target_language: str
    ) -> list[GlossaryMatch]:
        return [
            GlossaryMatch(
                source_term="承認",
                target_term="审批",
                do_not_translate=False,
                priority=10,
            )
        ]

    async def _no_redis() -> object:
        class _R:
            async def get(self, *_a: object, **_k: object) -> None:
                return None

            async def setex(self, *_a: object, **_k: object) -> None:
                return None

        return _R()

    async def _no_tm(*_a: object, **_k: object) -> None:
        return None

    async def _store_tm(*_a: object, **_k: object) -> None:
        return None

    async def _glossary_version() -> str:
        return "v-test"

    monkeypatch.setattr(translate_engine, "_call_openai_translate", _fake_openai)
    monkeypatch.setattr(translate_engine, "_get_redis", _no_redis)
    monkeypatch.setattr(translate_engine, "_glossary_version", _glossary_version)
    monkeypatch.setattr(translate_engine.translation_memory, "lookup", _no_tm)
    monkeypatch.setattr(translate_engine.translation_memory, "store", _store_tm)
    monkeypatch.setattr(glossary_mod, "match_terms_for_text", _fake_matches)

    monitor = HybridQoSMonitor()
    token = bind_qos_monitor(monitor)
    try:
        out = await translate_routes.translate_text_simple(
            "この承認を進めてください", "ja", "zh"
        )
    finally:
        reset_qos_monitor(token)

    assert out == "请进行审批操作"
    assert monitor.glossary_hit_rate() == 1.0


@pytest.mark.asyncio
async def test_openai_mt_stage_uses_glossary_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Composite OpenAIMTStage も共通翻訳エンジンを使う。"""
    from app.ai_pipeline.providers.stages import OpenAIMTStage

    called: dict[str, str] = {}

    async def _fake_simple(text: str, src: str, tgt: str) -> str:
        called["text"] = text
        called["src"] = src
        called["tgt"] = tgt
        return "审批"

    monkeypatch.setattr("app.translate.engine.translate_text", _fake_simple)
    monkeypatch.setattr(
        "app.ai_pipeline.providers.stages.check_api_key",
        lambda *_a, **_k: None,
    )
    stage = OpenAIMTStage()
    out = await stage.translate_text("承認", "ja", "zh")
    assert out == "审批"
    assert called == {"text": "承認", "src": "ja", "tgt": "zh"}
