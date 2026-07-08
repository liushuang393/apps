"""
ローカル TTS ステージ（Kokoro-82M）の単体テスト

対象: app.ai_pipeline.providers.local_tts
方針:
    - GPU / kokoro 非依存。fake engine を注入して合成経路を検証する。
    - 合成失敗は字幕継続のため None を返す（例外握り潰し）契約を確認する。
    - VRAM Broker は既定共有 broker を用い、use() 経路が通ることを確認する。
"""

import numpy as np
import pytest

from app.ai_pipeline.providers.local_tts import (
    KOKORO_SAMPLE_RATE,
    LocalTTSStage,
    available,
)
from app.ai_pipeline.vram_broker import VRAMBroker


def _fresh_broker() -> VRAMBroker:
    """テストごとに独立した Broker（既定共有 broker のキャッシュ汚染を避ける）。"""
    return VRAMBroker()


class _FakeEngine:
    """Kokoro 互換ダミー: float32[-1,1] の 1 次元波形を返す。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def synthesize(self, text: str, voice: str) -> np.ndarray:
        self.calls.append({"text": text, "voice": voice})
        # 0.1 秒分の無音に近い float32 波形（int16 変換経路を通す）。
        return np.linspace(-0.5, 0.5, num=KOKORO_SAMPLE_RATE // 10, dtype=np.float32)


class _RaisingEngine:
    """合成時に例外を送出するダミー（None 契約の検証用）。"""

    def synthesize(self, text: str, voice: str) -> np.ndarray:  # noqa: ARG002
        raise RuntimeError("合成失敗（テスト）")


def test_import_module_succeeds() -> None:
    # kokoro 未導入環境でも import できることを確認（遅延 import の担保）。
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
    # 言語 ja に対応する voice が渡っていること。
    assert engine.calls[0]["voice"] == "jf_alpha"


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
async def test_unsupported_language_falls_back_to_default_voice() -> None:
    engine = _FakeEngine()
    stage = LocalTTSStage(engine=engine, broker=_fresh_broker())
    audio = await stage.synthesize("xin chao", "vi")
    assert audio[:4] == b"RIFF"
    # vi は既定で英語 voice(af_heart) に代替される。
    assert engine.calls[0]["voice"] == "af_heart"
