"""ローカル TTS 差し替え口の契約（未結線・注入モデルの合成・字幕縮退・直列化）を検証する。"""

import asyncio
import io
import threading
import time
import wave
from unittest.mock import Mock

import numpy as np
import pytest

from app.ai_pipeline.providers import local_tts
from app.ai_pipeline.registry import _make_local_tts
from app.ai_pipeline.vram_broker import VRAMBroker


def _model(waveform: object) -> Mock:
    """`synthesize(text, language)` だけを持つダミーモデル。"""
    model = Mock()
    model.synthesize.return_value = waveform
    return model


def test_unwired_slot_is_unavailable_and_factory_still_builds() -> None:
    """モデル未結線の間は利用不可を返し、差し替え口のステージは生成できる。"""
    assert local_tts.MODEL_ID is None
    assert local_tts.available() is False
    assert isinstance(_make_local_tts(), local_tts.LocalTTSStage)


@pytest.mark.asyncio
async def test_unwired_model_degrades_to_subtitles() -> None:
    """未結線のまま呼ばれても例外を出さず None（字幕のみ）を返す。"""
    stage = local_tts.LocalTTSStage(broker=VRAMBroker(3000))
    assert await stage.synthesize("Hello", "en") is None


@pytest.mark.asyncio
async def test_injected_model_returns_mono_int16_wav() -> None:
    """結線モデルの波形を 24kHz mono int16 WAV に変換し、言語を渡す。"""
    model = _model(np.ones(2400, dtype=np.float32) * 0.1)
    stage = local_tts.LocalTTSStage(engine=model, broker=VRAMBroker(3000))
    data = await stage.synthesize("会議は10時です。", "ja")
    assert data is not None
    with wave.open(io.BytesIO(data)) as audio:
        assert audio.getframerate() == local_tts.SAMPLE_RATE
        assert audio.getnchannels() == 1
        assert audio.getsampwidth() == 2
    model.synthesize.assert_called_once_with("会議は10時です。", "ja")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad", [np.array([]), np.zeros(2400), np.array([np.nan]), np.ones((2, 2))]
)
async def test_invalid_audio_degrades_to_subtitles(bad: object) -> None:
    """空・無音・非有限・多次元の波形を成功 WAV へ変換しない。"""
    stage = local_tts.LocalTTSStage(engine=_model(bad), broker=VRAMBroker(3000))
    assert await stage.synthesize("Hello", "en") is None


@pytest.mark.asyncio
async def test_unknown_language_empty_text_and_failure_return_none() -> None:
    """未対応言語・空文は生成せず、合成例外は字幕継続のため None を返す。"""
    model = _model(np.ones(10))
    stage = local_tts.LocalTTSStage(engine=model, broker=VRAMBroker(3000))
    assert await stage.synthesize("Bonjour", "fr") is None
    assert await stage.synthesize("  ", "en") is None
    model.synthesize.assert_not_called()
    model.synthesize.side_effect = RuntimeError("合成失敗（テスト）")
    assert await stage.synthesize("Hello", "en") is None


@pytest.mark.asyncio
async def test_concurrent_requests_share_one_serial_engine() -> None:
    """複数部屋からの呼び出しでも同一 GPU モデルの生成を重ねない。"""
    active = 0
    peak = 0
    lock = threading.Lock()

    def synthesize(_text: str, _language: str) -> np.ndarray:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.02)
        with lock:
            active -= 1
        return np.ones(2400, dtype=np.float32) * 0.1

    model = Mock()
    model.synthesize.side_effect = synthesize
    broker = VRAMBroker(3000)
    stage = local_tts.LocalTTSStage(engine=model, broker=broker)
    results = await asyncio.gather(
        stage.synthesize("Hello", "en"), stage.synthesize("こんにちは", "ja")
    )
    assert all(results)
    assert peak == 1
    assert broker.resident_keys() == [local_tts.ENGINE_CACHE_KEY]


def test_catalog_lists_no_unwired_local_tts() -> None:
    """未結線のローカル TTS をモデルカタログに載せない。"""
    from app.ai_pipeline.model_registry import _build_default_catalog

    catalog = _build_default_catalog()
    assert catalog.get("asr-gemma4-e2b") and catalog.get("t2t-gemma4-e2b")
    assert catalog.get("tts-omnivoice") is None
