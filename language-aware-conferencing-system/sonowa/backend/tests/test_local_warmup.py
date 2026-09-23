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


@pytest.mark.asyncio
async def test_insufficient_joint_budget_does_not_thrash_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """2モデルの合計を収容できない予算で、ロードと退避を繰り返さない。"""
    monkeypatch.setattr(local_warmup, "broker", VRAMBroker(7500))
    factory = Mock()
    monkeypatch.setattr(local_warmup, "LocalMultimodalStage", factory)
    values = replace(
        env_pipeline_defaults(),
        asr_provider="local",
        mt_provider="local",
        tts_provider="local",
    )
    assert await local_warmup.prepare_local_pipeline(values) is False
    factory.assert_not_called()


@pytest.mark.asyncio
async def test_preparation_loads_two_models_then_primes_inference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP受付前にモデル読込と初回推論を終え、音声を配信しない。"""
    monkeypatch.setattr(local_warmup, "broker", VRAMBroker(10000))
    asr = Mock(prepare=AsyncMock(), transcribe_audio=AsyncMock(return_value=""))
    tts = Mock(prepare=AsyncMock(), synthesize=AsyncMock(return_value=b"warmup-wave"))
    monkeypatch.setattr(local_warmup, "LocalMultimodalStage", Mock(return_value=asr))
    monkeypatch.setattr(local_warmup, "create_stage", Mock(return_value=tts))
    values = replace(
        env_pipeline_defaults(),
        asr_provider="local",
        mt_provider="local",
        tts_provider="local",
    )
    assert await local_warmup.prepare_local_pipeline(values) is True
    asr.prepare.assert_awaited_once()
    tts.prepare.assert_awaited_once()
    asr.transcribe_audio.assert_awaited_once()
    tts.synthesize.assert_awaited_once()


@pytest.mark.asyncio
async def test_missing_model_reports_unready_without_cloud_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """欠損時にサーバーを管理可能に保ち、準備成功と誤認しない。"""
    monkeypatch.setattr(local_warmup, "broker", VRAMBroker(10000))
    asr = Mock(prepare=AsyncMock(side_effect=FileNotFoundError("model")))
    tts_factory = Mock()
    monkeypatch.setattr(local_warmup, "LocalMultimodalStage", Mock(return_value=asr))
    monkeypatch.setattr(local_warmup, "create_stage", tts_factory)
    values = replace(
        env_pipeline_defaults(),
        asr_provider="local",
        mt_provider="local",
        tts_provider="local",
    )
    assert await local_warmup.prepare_local_pipeline(values) is False
    tts_factory.assert_not_called()
