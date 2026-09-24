"""全local時だけモデルを事前準備し、クラウド起動へGPU負荷を追加しない。"""

from dataclasses import replace
from unittest.mock import AsyncMock, Mock

import pytest

from app.ai_pipeline import local_warmup
from app.ai_pipeline.effective_config import env_pipeline_defaults
from app.ai_pipeline.vram_broker import VRAMBroker


@pytest.mark.asyncio
async def test_cloud_startup_does_not_load_local_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """クラウド構成の起動でモデルキャッシュやGPUへ触れない。"""
    asr_factory = Mock()
    monkeypatch.setattr(local_warmup, "LocalMultimodalStage", asr_factory)
    values = replace(env_pipeline_defaults(), asr_provider="auto", mt_provider="auto")
    assert await local_warmup.prepare_local_pipeline(values) is False
    asr_factory.assert_not_called()


def _local(tts: str = "none"):
    """ASR/MT を local にした設定値。"""
    return replace(
        env_pipeline_defaults(),
        asr_provider="local",
        mt_provider="local",
        tts_provider=tts,
    )


@pytest.mark.asyncio
async def test_insufficient_budget_does_not_thrash_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Gemma を収容できない予算で、ロードと退避を繰り返さない。"""
    monkeypatch.setattr(local_warmup, "broker", VRAMBroker(1000))
    factory = Mock()
    monkeypatch.setattr(local_warmup, "LocalMultimodalStage", factory)
    assert await local_warmup.prepare_local_pipeline(_local()) is False
    factory.assert_not_called()


@pytest.mark.asyncio
async def test_subtitle_only_preparation_loads_gemma_without_tts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """TTS 未結線（字幕のみ）でも Gemma を準備し、TTS はロードしない。"""
    monkeypatch.setattr(local_warmup, "broker", VRAMBroker(10000))
    asr = Mock(prepare=AsyncMock(), transcribe_audio=AsyncMock(return_value=""))
    monkeypatch.setattr(local_warmup, "LocalMultimodalStage", Mock(return_value=asr))
    tts_factory = Mock()
    monkeypatch.setattr(local_warmup.local_tts, "create_stage", tts_factory)
    for tts in ("none", "local"):
        assert await local_warmup.prepare_local_pipeline(_local(tts)) is True
    assert asr.prepare.await_count == 2
    tts_factory.assert_not_called()


@pytest.mark.asyncio
async def test_wired_tts_is_prepared_and_primed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """local TTS が結線済みなら両モデルを準備し、初回合成まで温める。"""
    monkeypatch.setattr(local_warmup, "broker", VRAMBroker(10000))
    monkeypatch.setattr(local_warmup.local_tts, "available", lambda: True)
    asr = Mock(prepare=AsyncMock(), transcribe_audio=AsyncMock(return_value=""))
    tts = Mock(prepare=AsyncMock(), synthesize=AsyncMock(return_value=b"wave"))
    monkeypatch.setattr(local_warmup, "LocalMultimodalStage", Mock(return_value=asr))
    monkeypatch.setattr(local_warmup.local_tts, "create_stage", Mock(return_value=tts))
    assert await local_warmup.prepare_local_pipeline(_local("local")) is True
    tts.prepare.assert_awaited_once()
    tts.synthesize.assert_awaited_once()


@pytest.mark.asyncio
async def test_missing_model_reports_unready_without_cloud_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """欠損時にサーバーを管理可能に保ち、準備成功と誤認しない。"""
    monkeypatch.setattr(local_warmup, "broker", VRAMBroker(10000))
    asr = Mock(prepare=AsyncMock(side_effect=FileNotFoundError("model")))
    monkeypatch.setattr(local_warmup, "LocalMultimodalStage", Mock(return_value=asr))
    assert await local_warmup.prepare_local_pipeline(_local()) is False
