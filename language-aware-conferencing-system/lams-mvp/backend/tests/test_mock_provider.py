"""
MockAIProvider の単体テスト（ネットワーク無し・決定論）。

目的:
    Aレーン E2E 用 Mock が外部 API 無しで ASR / MT / TTS を安定して返すことを検証する。
"""

from __future__ import annotations

import os

import pytest

from app.ai_pipeline.providers.mock_provider import (
    MockAIProvider,
    asr_text_for_audio_length,
    build_silent_tts_wav,
    e2e_mock_ai_enabled,
    translate_text_mock,
)
from app.audio.pcm import wrap_wav16


def _wav_of_pcm_bytes(pcm_byte_len: int) -> bytes:
    """指定 PCM バイト長の無音 WAV を作る（ASR 長帯域テスト用）。"""
    even = pcm_byte_len - (pcm_byte_len % 2)
    pcm = b"\x00" * max(even, 0)
    return wrap_wav16(pcm, 16_000)


def test_e2e_mock_ai_enabled_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """LAMS_E2E_MOCK_AI=1 のときのみ有効になる。"""
    monkeypatch.delenv("LAMS_E2E_MOCK_AI", raising=False)
    assert e2e_mock_ai_enabled() is False
    monkeypatch.setenv("LAMS_E2E_MOCK_AI", "1")
    assert e2e_mock_ai_enabled() is True
    monkeypatch.setenv("LAMS_E2E_MOCK_AI", "0")
    assert e2e_mock_ai_enabled() is False


def test_asr_text_for_audio_length_is_deterministic() -> None:
    """同一バイト長なら同一 ASR テキストになる。"""
    assert asr_text_for_audio_length(100) == ""
    # 1644 以上かつ 2000 未満 → こんにちは
    assert asr_text_for_audio_length(1_800) == "こんにちは"
    assert asr_text_for_audio_length(1_800) == asr_text_for_audio_length(1_800)
    # 2000 以上 8000 未満
    assert asr_text_for_audio_length(3_000) == "本日の議題を確認します"


@pytest.mark.asyncio
async def test_transcribe_audio_deterministic_no_network() -> None:
    """transcribe_audio がネットワーク無しで決定論結果を返す。"""
    provider = MockAIProvider()
    # WAV 全体長が 1800 付近になるよう PCM を調整（ヘッダー 44 + PCM）
    audio = _wav_of_pcm_bytes(1_756)
    assert len(audio) == 1_800
    t1 = await provider.transcribe_audio(audio, "ja")
    t2 = await provider.transcribe_audio(audio, "ja")
    assert t1 == t2 == "こんにちは"


@pytest.mark.asyncio
async def test_translate_audio_dictionary_and_silent_tts() -> None:
    """辞書 MT と無音 TTS（WAV）が付くこと。"""
    provider = MockAIProvider()
    result = await provider.translate_audio(
        b"",
        "ja",
        "en",
        original_text="こんにちは",
    )
    assert result.original_text == "こんにちは"
    assert result.translated_text == "Hello"
    assert result.audio_data is not None
    assert result.audio_data[:4] == b"RIFF"
    assert result.audio_data[44:] == b"\x00" * (len(result.audio_data) - 44)


def test_translate_text_mock_prefix_fallback() -> None:
    """辞書外フレーズは [mock-{lang}] プレフィックスになる。"""
    assert translate_text_mock("未知の文", "en") == "[mock-en] 未知の文"
    assert translate_text_mock("こんにちは", "zh") == "你好"
    assert translate_text_mock("こんにちは", "vi") == "Xin chào"


def test_build_silent_tts_wav_length() -> None:
    """無音 TTS は期待サンプルレート・短い固定長である。"""
    wav = build_silent_tts_wav(sample_rate=24_000, duration_sec=0.1)
    assert wav[:4] == b"RIFF"
    assert len(wav) == 44 + 4_800


@pytest.mark.asyncio
async def test_get_ai_provider_returns_mock_via_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LAMS_E2E_MOCK_AI=1 のとき factory が MockAIProvider を返す。"""
    monkeypatch.setenv("LAMS_E2E_MOCK_AI", "1")
    from app.ai_pipeline.effective_config import reset_pipeline_settings_cache_for_tests
    from app.ai_pipeline.providers import get_ai_provider, invalidate_ai_provider_cache

    reset_pipeline_settings_cache_for_tests()
    invalidate_ai_provider_cache()
    provider = get_ai_provider()
    assert isinstance(provider, MockAIProvider)

    monkeypatch.delenv("LAMS_E2E_MOCK_AI", raising=False)
    invalidate_ai_provider_cache()
    reset_pipeline_settings_cache_for_tests()
    assert os.environ.get("LAMS_E2E_MOCK_AI") in (None, "")
