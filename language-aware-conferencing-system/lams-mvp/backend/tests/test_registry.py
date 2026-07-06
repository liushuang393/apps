"""
Provider 集中管理（Registry + ステージ分離 + Composite）単体テスト

対象: app.ai_pipeline.registry / app.ai_pipeline.providers.stages
方針:
    - DB・ネットワーク・API キー非依存。OpenAI SDK はダミークライアントを注入する。
    - pytest-asyncio 非導入のため、非同期メソッドは asyncio.run で実行する。
    - registry はテスト専用 ProviderRegistry を生成し、可用性 / フォールバックを検証する。
"""

import asyncio

from app.ai_pipeline.registry import (
    STAGE_ASR,
    STAGE_MT,
    STAGE_TTS,
    CompositeAIProvider,
    ProviderRegistry,
    ProviderSpec,
)


class _FakeASR:
    name = "fakeasr"

    async def transcribe_audio(self, _audio_data: bytes, _language: str) -> str:
        return "hello"

    async def transcribe_with_detection(
        self, _audio_data: bytes, _hint_language: str = "multi"
    ) -> tuple[str, str]:
        return "hello", "en"


class _FakeMT:
    name = "fakemt"

    async def translate_text(self, text: str, _src: str, tgt: str) -> str:
        return f"[{tgt}]{text}"


class _FakeTTS:
    name = "faketts"

    async def synthesize(self, _text: str, _language: str) -> bytes | None:
        return b"AUDIO"


# ============================================================
# ProviderRegistry（可用性 / フォールバック / 未知名）
# ============================================================
def test_registry_resolve_available() -> None:
    reg = ProviderRegistry()
    reg.register(ProviderSpec(name="a", stage=STAGE_ASR, factory=_FakeASR))
    assert isinstance(reg.resolve(STAGE_ASR, "a"), _FakeASR)


def test_registry_fallback_when_unavailable() -> None:
    reg = ProviderRegistry()

    def _boom() -> object:
        raise AssertionError("利用不可スロットの factory は呼ばれてはならない")

    reg.register(
        ProviderSpec(
            name="primary",
            stage=STAGE_MT,
            factory=_boom,
            available=lambda: False,
            fallback="backup",
        )
    )
    reg.register(ProviderSpec(name="backup", stage=STAGE_MT, factory=_FakeMT))
    assert isinstance(reg.resolve(STAGE_MT, "primary"), _FakeMT)


def test_registry_unavailable_no_fallback_returns_none() -> None:
    reg = ProviderRegistry()
    reg.register(
        ProviderSpec(
            name="x", stage=STAGE_TTS, factory=_FakeTTS, available=lambda: False
        )
    )
    assert reg.resolve(STAGE_TTS, "x") is None


def test_registry_unknown_name_raises() -> None:
    reg = ProviderRegistry()
    try:
        reg.resolve(STAGE_ASR, "nope")
        raise AssertionError("未知名は KeyError を送出するべき")
    except KeyError:
        pass


# ============================================================
# CompositeAIProvider（ASR→MT→TTS / 同一言語 / TTS なし / 委譲）
# ============================================================
def test_composite_translate_runs_all_stages() -> None:
    comp = CompositeAIProvider(_FakeASR(), _FakeMT(), _FakeTTS())
    res = asyncio.run(comp.translate_audio(b"x" * 60000, "en", "ja"))
    assert res.original_text == "hello"
    assert res.translated_text == "[ja]hello"
    assert res.audio_data == b"AUDIO"


def test_composite_same_language_asr_only() -> None:
    comp = CompositeAIProvider(_FakeASR(), _FakeMT(), _FakeTTS())
    res = asyncio.run(comp.translate_audio(b"x", "en", "en"))
    assert res.original_text == "hello"
    assert res.translated_text == "hello"
    assert res.audio_data is None


def test_composite_without_tts_stage() -> None:
    comp = CompositeAIProvider(_FakeASR(), _FakeMT(), None)
    res = asyncio.run(comp.translate_audio(b"x", "en", "ja"))
    assert res.translated_text == "[ja]hello"
    assert res.audio_data is None


def test_composite_transcribe_delegates_to_asr() -> None:
    comp = CompositeAIProvider(_FakeASR(), _FakeMT(), None)
    assert asyncio.run(comp.transcribe_audio(b"x", "en")) == "hello"
    assert asyncio.run(comp.transcribe_with_detection(b"x")) == ("hello", "en")


# ============================================================
# build_composite_provider（フェイルファスト）
# ============================================================
def test_build_composite_raises_when_asr_unresolvable(monkeypatch):
    """ASR スロット解決不能時は起動時に APIKeyError（実行時 AttributeError 禁止）。"""
    import pytest

    from app.ai_pipeline import registry as reg
    from app.ai_pipeline.providers.base import APIKeyError
    from app.config import settings

    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "deepgram_api_key", "", raising=False)
    monkeypatch.setattr(settings, "asr_provider", "gpt4o")
    monkeypatch.setattr(settings, "mt_provider", "auto")
    monkeypatch.setattr(settings, "tts_provider", "auto")

    with pytest.raises(APIKeyError):
        reg.build_composite_provider()
