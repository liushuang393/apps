"""OmniVoiceのオフラインロード・言語指定・字幕縮退・共有推論を検証する。"""

import asyncio
import io
import sys
import threading
import time
import wave
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

import numpy as np
import pytest

from app.ai_pipeline.providers import local_omnivoice
from app.ai_pipeline.registry import _make_local_tts
from app.ai_pipeline.vram_broker import VRAMBroker
from app.config import settings


@pytest.mark.asyncio
async def test_fixed_offline_model_has_no_auxiliary_asr(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """固定キャッシュだけを読み、補助ASRなしで言語指定して24kHz WAVを返す。"""
    (tmp_path / "audio_tokenizer").mkdir()
    download = Mock(return_value=str(tmp_path))
    hub = ModuleType("huggingface_hub")
    hub.snapshot_download = download
    model = Mock()
    model._asr_pipe = None
    model.generate.return_value = [np.ones(2400, dtype=np.float32) * 0.1]
    factory = Mock(return_value=model)
    module = ModuleType("omnivoice")
    module.OmniVoice = Mock(from_pretrained=factory)
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setitem(sys.modules, "omnivoice", module)
    torch_module = ModuleType("torch")
    torch_module.float16 = "float16"
    monkeypatch.setitem(sys.modules, "torch", torch_module)
    stage = local_omnivoice.LocalOmniVoiceTTSStage(broker=VRAMBroker(3000))

    data = await stage.synthesize("会議は10時です。", "ja")

    assert data is not None
    with wave.open(io.BytesIO(data)) as audio:
        assert audio.getframerate() == 24000
        assert audio.getnchannels() == 1
        assert audio.getsampwidth() == 2
    download.assert_called_once_with(
        local_omnivoice.MODEL_ID,
        revision=local_omnivoice.MODEL_REVISION,
        local_files_only=True,
    )
    assert factory.call_args.kwargs["load_asr"] is False
    assert factory.call_args.kwargs["local_files_only"] is True
    model.generate.assert_called_once_with(text="会議は10時です。", language="ja")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad", [[], [np.array([])], [np.zeros(2400)], [np.array([np.nan])]]
)
async def test_invalid_audio_degrades_to_subtitles(bad: object) -> None:
    """空・無音・非有限音声を成功WAVへ変換しない。"""
    model = Mock()
    model._asr_pipe = None
    model.generate.return_value = bad
    stage = local_omnivoice.LocalOmniVoiceTTSStage(
        engine=model, broker=VRAMBroker(3000)
    )
    assert await stage.synthesize("Hello", "en") is None


@pytest.mark.asyncio
async def test_unknown_language_does_not_generate() -> None:
    """未対応言語を別言語の音声に置換しない。"""
    model = Mock()
    stage = local_omnivoice.LocalOmniVoiceTTSStage(
        engine=model, broker=VRAMBroker(3000)
    )
    assert await stage.synthesize("Bonjour", "fr") is None
    model.generate.assert_not_called()


@pytest.mark.asyncio
async def test_concurrent_requests_share_one_serial_engine() -> None:
    """複数部屋からの呼び出しでも同一GPUモデルの生成を重ねない。"""
    active = 0
    peak = 0
    lock = threading.Lock()

    def generate(**_kwargs: object) -> list[np.ndarray]:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.02)
        with lock:
            active -= 1
        return [np.ones(2400, dtype=np.float32) * 0.1]

    model = Mock()
    model._asr_pipe = None
    model.generate.side_effect = generate
    broker = VRAMBroker(3000)
    stage = local_omnivoice.LocalOmniVoiceTTSStage(engine=model, broker=broker)
    results = await asyncio.gather(
        stage.synthesize("Hello", "en"), stage.synthesize("こんにちは", "ja")
    )
    assert all(results)
    assert peak == 1
    assert broker.resident_keys() == [local_omnivoice.ENGINE_CACHE_KEY]


def test_local_factory_selects_configured_omnivoice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """localの設定を維持したまま、選択した音声モデルの実体を返す。"""
    monkeypatch.setattr(settings, "local_tts_model", local_omnivoice.MODEL_ID)
    assert isinstance(_make_local_tts(), local_omnivoice.LocalOmniVoiceTTSStage)


@pytest.mark.asyncio
async def test_missing_bundled_codec_cannot_select_another_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """付属コーデック欠損時にOmniVoiceの別モデル取得経路へ入らない。"""
    hub = ModuleType("huggingface_hub")
    hub.snapshot_download = Mock(return_value=str(tmp_path))
    module = ModuleType("omnivoice")
    module.OmniVoice = Mock()
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setitem(sys.modules, "omnivoice", module)
    torch_module = ModuleType("torch")
    torch_module.float16 = "float16"
    monkeypatch.setitem(sys.modules, "torch", torch_module)
    stage = local_omnivoice.LocalOmniVoiceTTSStage(broker=VRAMBroker(3000))
    assert await stage.synthesize("Hello", "en") is None
    module.OmniVoice.from_pretrained.assert_not_called()


def test_catalog_matches_runtime_and_marks_noncommercial(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """選択モデルと異なる名称・ライセンス・架空の測定値を表示しない。"""
    from app.ai_pipeline.model_registry import _build_default_catalog
    from app.ai_pipeline.providers.local_multimodal import MODEL_ID as GEMMA_ID

    monkeypatch.setattr(settings, "local_tts_model", local_omnivoice.MODEL_ID)
    catalog = _build_default_catalog()
    asr = catalog.get("asr-gemma4-e2b")
    mt = catalog.get("t2t-gemma4-e2b")
    tts = catalog.get("tts-omnivoice")
    assert asr and mt and tts
    assert asr.base_model == mt.base_model == GEMMA_ID
    assert tts.base_model == local_omnivoice.MODEL_ID
    assert tts.runtime == "transformers"
    assert tts.metrics == {}
    assert catalog.is_commercial_allowed(tts) is False
