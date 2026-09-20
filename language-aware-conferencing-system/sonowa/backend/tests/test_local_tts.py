"""
ローカル TTS ステージ（VoxCPM2 単一多言語）の単体テスト

対象: app.ai_pipeline.providers.local_tts
方針:
    - GPU / voxcpm 非依存。fake engine を注入して合成経路を検証する。
    - ja/en/zh/vi を同一エンジンで合成し、失敗時は字幕継続のため None を返す。
"""

import asyncio
import sys
import time
from types import ModuleType
from unittest.mock import Mock

import numpy as np
import pytest
from app.ai_pipeline.providers.local_tts import (
    VOXCPM_SAMPLE_RATE,
    LocalTTSStage,
    available,
)
from app.ai_pipeline.vram_broker import VRAMBroker


def _fresh_broker() -> VRAMBroker:
    """テストごとに独立した Broker（既定共有 broker のキャッシュ汚染を避ける）。"""
    return VRAMBroker(budget_mb=8000)


class _FakeEngine:
    """VoxCPM 互換ダミー: float32[-1,1] の 1 次元波形を返す。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def generate(self, text: str, **_kwargs: object) -> np.ndarray:
        self.calls.append({"text": text})
        return np.linspace(-0.5, 0.5, num=VOXCPM_SAMPLE_RATE // 10, dtype=np.float32)


class _RaisingEngine:
    """合成時に例外を送出するダミー（None 契約の検証用）。"""

    def generate(self, text: str, **_kwargs: object) -> np.ndarray:  # noqa: ARG002
        raise RuntimeError("合成失敗（テスト）")


def test_import_module_succeeds() -> None:
    import app.ai_pipeline.providers.local_tts as mod

    assert mod.LocalTTSStage.name == "local"


def test_available_returns_bool() -> None:
    assert isinstance(available(), bool)


@pytest.mark.asyncio
async def test_synthesize_returns_wav_bytes() -> None:
    engine = _FakeEngine()
    stage = LocalTTSStage(engine=engine, broker=_fresh_broker())
    audio = await stage.synthesize("こんにちは", "ja")
    assert isinstance(audio, bytes)
    assert audio[:4] == b"RIFF"
    assert engine.calls[0]["text"] == "こんにちは"


@pytest.mark.asyncio
@pytest.mark.parametrize("language", ["ja", "en", "zh", "vi"])
async def test_synthesize_supports_four_languages(language: str) -> None:
    """4言語を同一エンジンで合成できる（言語別 voice 切替不要）。"""
    engine = _FakeEngine()
    stage = LocalTTSStage(engine=engine, broker=_fresh_broker())
    audio = await stage.synthesize(f"hello-{language}", language)
    assert audio is not None
    assert audio[:4] == b"RIFF"
    assert engine.calls[-1]["text"] == f"hello-{language}"


@pytest.mark.asyncio
async def test_synthesize_empty_text_returns_none() -> None:
    stage = LocalTTSStage(engine=_FakeEngine(), broker=_fresh_broker())
    assert await stage.synthesize("", "en") is None
    assert await stage.synthesize("   ", "en") is None


@pytest.mark.asyncio
async def test_synthesize_swallows_exception_returns_none() -> None:
    stage = LocalTTSStage(engine=_RaisingEngine(), broker=_fresh_broker())
    assert await stage.synthesize("hello", "en") is None


@pytest.mark.asyncio
async def test_vram_capacity_error_returns_none_for_subtitle_fallback() -> None:
    """VRAM 逼迫時は音声のみ落とし、呼び出し側が字幕継続できるよう None を返す。"""
    # local_tts_size_mb（既定 7500）より小さい予算で VRAMCapacityError を起こす。
    stage = LocalTTSStage(engine=_FakeEngine(), broker=VRAMBroker(budget_mb=100))
    assert await stage.synthesize("hello", "ja") is None


def test_loader_uses_configured_device_without_compile_workers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """少容量 GPU のロードは追加コンパイルと意図しない device 選択を避ける。"""
    from app.ai_pipeline.providers import local_tts

    factory = Mock(return_value=_FakeEngine())
    module = ModuleType("voxcpm")
    module.VoxCPM = Mock(from_pretrained=factory)
    monkeypatch.setitem(sys.modules, "voxcpm", module)
    hub = ModuleType("huggingface_hub")
    hub.snapshot_download = Mock(return_value="/cached/voxcpm2")
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setattr(local_tts.settings, "local_tts_device", "cuda")
    LocalTTSStage()._load_engine()
    factory.assert_called_once_with(
        "/cached/voxcpm2",
        load_denoiser=False,
        optimize=False,
        device="cuda",
    )
    hub.snapshot_download.assert_called_once_with(
        local_tts.settings.local_tts_model, local_files_only=True
    )


@pytest.mark.asyncio
async def test_shared_tts_model_does_not_generate_concurrently() -> None:
    """複数ステージが共有する VoxCPM の内部状態を並行推論で競合させない。"""

    class Engine(_FakeEngine):
        active = 0
        peak = 0

        def generate(self, text: str, **kwargs: object) -> np.ndarray:
            self.active += 1
            self.peak = max(self.peak, self.active)
            time.sleep(0.02)
            result = super().generate(text, **kwargs)
            self.active -= 1
            return result

    engine = Engine()
    broker = _fresh_broker()
    stages = [LocalTTSStage(engine=engine, broker=broker) for _ in range(3)]
    results = await asyncio.gather(
        *(stage.synthesize("hello", "en") for stage in stages)
    )
    assert all(results)
    assert engine.peak == 1
