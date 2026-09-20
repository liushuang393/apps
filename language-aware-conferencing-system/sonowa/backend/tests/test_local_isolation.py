"""ローカル指定時の依存不足がクラウド送信を起こさないことを検証する。"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.ai_pipeline import registry as module
from app.ai_pipeline.effective_config import (
    PipelineSettingsValues,
    collect_availability_warnings,
    reset_pipeline_settings_cache_for_tests,
    set_cached_pipeline_settings,
)


@pytest.mark.parametrize("stage", ["asr", "mt", "tts"])
def test_missing_local_dependency_never_constructs_cloud(
    monkeypatch: pytest.MonkeyPatch, stage: str
) -> None:
    """各 local スロットが利用不可でもクラウド factory を呼ばない。"""
    cloud = Mock(return_value=object())
    monkeypatch.setattr(module, f"_local_{stage}_available", lambda: False)
    reg = module._build_default_registry()
    for name in ("gpt4o", "openai"):
        if name in reg.names(stage):
            reg.register(module.ProviderSpec(name=name, stage=stage, factory=cloud))
    result = reg.resolve(stage, "local")
    cloud.assert_not_called()
    if stage == "tts":
        assert getattr(result, "name", None) == "none"
    else:
        assert result is None


def test_local_warning_does_not_promise_cloud_fallback() -> None:
    """管理者の診断表示もローカル失敗時の送信禁止を説明する。"""
    values = PipelineSettingsValues(
        ai_provider="gpt4o_transcribe",
        asr_provider="local",
        mt_provider="local",
        tts_provider="local",
        default_mode="hybrid",
    )
    warnings = collect_availability_warnings(values)
    assert not any("雲プロバイダーへ縮退" in warning for warning in warnings)


@pytest.mark.parametrize("stage", ["asr", "mt"])
def test_experiment_cannot_replace_explicit_local_stage(stage: str) -> None:
    """A/B 実験が有効でも local 指定はクラウド候補に置き換えない。"""
    local = SimpleNamespace(name="local")
    selector = Mock()
    selector.select.return_value = (object(), "cloud-experiment", "cloud")
    provider = module.CompositeAIProvider(local, local, None, selector=selector)
    assert provider._pick(stage, local) == (local, None, None)
    selector.select.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("local_result", ["Hello", ""])
async def test_reading_lane_uses_local_mt_without_cloud_cache_or_correction(
    monkeypatch: pytest.MonkeyPatch, local_result: str
) -> None:
    """読む主線も local を尊重し、失敗してもクラウド処理を呼ばない。"""
    from app.translate import engine

    local = Mock()
    local.translate_text = AsyncMock(return_value=local_result)
    resolve = Mock(return_value=local)
    cloud = AsyncMock(return_value="cloud result")
    redis = AsyncMock()
    redis.return_value.get.return_value = None
    monkeypatch.setattr(module.registry, "resolve", resolve)
    monkeypatch.setattr(engine, "_call_openai_translate", cloud)
    monkeypatch.setattr(engine, "_glossary_version", AsyncMock(return_value="0"))
    monkeypatch.setattr(engine, "_get_redis", redis)
    monkeypatch.setattr(engine, "_record_glossary_qos", AsyncMock())
    monkeypatch.setattr(engine.translation_memory, "store", AsyncMock())
    monkeypatch.setattr(
        engine.translation_memory, "lookup", AsyncMock(return_value=None)
    )
    set_cached_pipeline_settings(
        PipelineSettingsValues(
            ai_provider="gpt4o_transcribe",
            asr_provider="local",
            mt_provider="local",
            tts_provider="local",
            default_mode="hybrid",
        )
    )
    try:
        result = await engine.translate_text("こんにちは", "ja", "en")
        assert result == local_result
        resolve.assert_called_once_with("mt", "local")
        local.translate_text.assert_awaited_once_with("こんにちは", "ja", "en")
        cloud.assert_not_awaited()
        redis.assert_not_awaited()
    finally:
        reset_pipeline_settings_cache_for_tests()


@pytest.mark.asyncio
async def test_translate_api_respects_local_mt(monkeypatch: pytest.MonkeyPatch) -> None:
    """テキスト API も local MT を選び、クラウドキャッシュを利用しない。"""
    from app.db.models import User
    from app.translate import routes

    local = AsyncMock(return_value="Hello")
    cloud = AsyncMock(return_value="cloud result")
    redis = AsyncMock()
    redis.return_value.get.return_value = None
    monkeypatch.setattr(routes, "translate_text_simple", local)
    monkeypatch.setattr(routes, "_call_openai_translate", cloud)
    monkeypatch.setattr(routes, "_glossary_version", AsyncMock(return_value="0"))
    monkeypatch.setattr(routes, "_get_redis", redis)
    monkeypatch.setattr(routes, "_get_context", AsyncMock(return_value=[]))
    monkeypatch.setattr(routes, "_add_context", AsyncMock())
    set_cached_pipeline_settings(
        PipelineSettingsValues("gpt4o_transcribe", "local", "local", "local", "hybrid")
    )
    try:
        result = await routes.translate_text(
            routes.TranslateRequest(
                text="こんにちは", source_language="ja", target_language="en"
            ),
            user=User(id="local-test", display_name="Local", email="local@example.com"),
        )
        assert result.translated_text == "Hello"
        cloud.assert_not_awaited()
        redis.assert_not_awaited()
    finally:
        reset_pipeline_settings_cache_for_tests()
