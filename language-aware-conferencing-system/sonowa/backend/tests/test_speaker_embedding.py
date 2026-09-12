"""
speaker_embedding（P4-A diarization：声紋 embedding 抽出）の単体テスト

resemblyzer 未導入環境でも成立するよう、実 WAV デコード ＋ 注入フェイク
encoder で検証する。実推論ライブラリには依存しない。
"""

import numpy as np
import pytest

from app.audio import speaker_embedding
from app.audio.pcm import wrap_wav16
from app.audio.speaker_embedding import (
    ResemblyzerEmbedder,
    build_speaker_embedder,
    resemblyzer_available,
)

# 16kHz モノ 16bit の実 WAV（振幅 0x0010 の定常 PCM を 4800 標本 = 0.3 秒）。
_SAMPLE_RATE = 16000
_VALID_WAV = wrap_wav16(b"\x10\x00" * 4800, _SAMPLE_RATE)


class _FakeEncoder:
    """embed_utterance を模した注入用フェイク（呼び出し引数を記録する）。"""

    def __init__(self) -> None:
        self.calls: list[np.ndarray] = []

    def embed_utterance(self, wav: np.ndarray) -> np.ndarray:
        self.calls.append(wav)
        return np.array([0.1, 0.2, 0.3], dtype=np.float32)


class _RaisingEncoder:
    """embed_utterance が例外を送出するフェイク（縮退検証用）。"""

    def embed_utterance(self, _wav: np.ndarray) -> np.ndarray:
        raise RuntimeError("推論失敗（テスト）")


@pytest.mark.asyncio
async def test_embed_valid_wav_returns_vector() -> None:
    """有効な WAV → [0.1, 0.2, 0.3] を list[float] で返し、[-1,1] の float 配列で呼ぶ。"""
    fake = _FakeEncoder()
    embedder = ResemblyzerEmbedder(encoder=fake)

    result = await embedder.embed(_VALID_WAV)

    assert result == pytest.approx([0.1, 0.2, 0.3])
    assert isinstance(result, list)
    assert all(isinstance(v, float) for v in result)
    assert len(fake.calls) == 1
    passed = fake.calls[0]
    assert passed.dtype == np.float32
    assert float(passed.min()) >= -1.0
    assert float(passed.max()) <= 1.0


@pytest.mark.asyncio
async def test_embed_empty_bytes_returns_none() -> None:
    """空バイト列 → None（encoder は呼ばれない）。"""
    fake = _FakeEncoder()
    embedder = ResemblyzerEmbedder(encoder=fake)

    result = await embedder.embed(b"")

    assert result is None
    assert fake.calls == []


@pytest.mark.asyncio
async def test_embed_garbage_bytes_returns_none() -> None:
    """非 WAV のゴミバイト列 → デコード失敗で例外を出さず None を返す。"""
    fake = _FakeEncoder()
    embedder = ResemblyzerEmbedder(encoder=fake)

    result = await embedder.embed(b"notawav")

    assert result is None
    assert fake.calls == []


@pytest.mark.asyncio
async def test_embed_encoder_exception_returns_none() -> None:
    """encoder が推論中に例外 → 握り潰して None（raise しない）。"""
    embedder = ResemblyzerEmbedder(encoder=_RaisingEncoder())

    result = await embedder.embed(_VALID_WAV)

    assert result is None


def test_available_true_when_encoder_injected() -> None:
    """encoder 注入時は依存未導入でも available() は True。"""
    embedder = ResemblyzerEmbedder(encoder=_FakeEncoder())

    assert embedder.available() is True


def test_resemblyzer_available_is_false_in_this_env() -> None:
    """この環境では resemblyzer 未導入のため False（戻り値は bool）。"""
    result = resemblyzer_available()

    assert isinstance(result, bool)
    assert result is False


def test_build_speaker_embedder_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """backend=="none" は None、backend=="resemblyzer" でも未導入なら None。"""
    monkeypatch.setattr(speaker_embedding.settings, "speaker_embed_backend", "none")
    assert build_speaker_embedder() is None

    monkeypatch.setattr(
        speaker_embedding.settings, "speaker_embed_backend", "resemblyzer"
    )
    # この環境は resemblyzer 未導入のため、resemblyzer 指定でも None へ縮退する。
    assert build_speaker_embedder() is None
