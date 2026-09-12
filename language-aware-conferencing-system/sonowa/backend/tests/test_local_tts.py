"""
ローカル TTS ステージ（VoxCPM2 単一多言語）の単体テスト

対象: app.ai_pipeline.providers.local_tts
方針:
    - GPU / voxcpm 非依存。fake engine を注入して合成経路を検証する。
    - ja/en/zh/vi を同一エンジンで合成し、失敗時は字幕継続のため None を返す。
"""

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
