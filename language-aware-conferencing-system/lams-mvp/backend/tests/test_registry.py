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


def test_default_registry_has_local_slots() -> None:
    """Lite 本地栈（local）が全 3 ステージに登録されている（§P1）。"""
    from app.ai_pipeline.registry import registry

    assert "local" in registry.names(STAGE_ASR)
    assert "local" in registry.names(STAGE_MT)
    assert "local" in registry.names(STAGE_TTS)


def test_local_slot_falls_back_when_runtime_absent() -> None:
    """本地ランタイム未導入時、local は雲プロバイダーへ委譲する（None ではない委譲確認）。"""
    reg = ProviderRegistry()
    reg.register(
        ProviderSpec(
            name="local",
            stage=STAGE_MT,
            factory=lambda: (_ for _ in ()).throw(
                AssertionError("未導入 local の factory は呼ばれてはならない")
            ),
            available=lambda: False,
            fallback="openai",
        )
    )
    reg.register(ProviderSpec(name="openai", stage=STAGE_MT, factory=_FakeMT))
    assert isinstance(reg.resolve(STAGE_MT, "local"), _FakeMT)


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


# ============================================================
# S2S プリセット保護（欠陥 #13）
# ============================================================
def test_s2s_preset_not_replaced_by_slots(monkeypatch):
    """S2S プリセットはスロット指定で黙って置換されない（欠陥 #13）。"""
    from app.ai_pipeline.providers import get_ai_provider
    from app.ai_pipeline.providers.gpt_realtime import GPTRealtimeProvider
    from app.config import settings

    monkeypatch.setattr(settings, "ai_provider", "gpt_realtime")
    monkeypatch.setattr(
        settings, "tts_provider", "none"
    )  # composite_enabled() を真にする
    monkeypatch.setattr(settings, "openai_api_key", "test-key")

    provider = get_ai_provider()
    assert isinstance(provider, GPTRealtimeProvider)


# ============================================================
# 治理カタログのランタイム選択（P4-wiring）
# ============================================================
def test_composite_enabled_by_model_registry_flag(monkeypatch) -> None:
    """全スロット auto でも use_model_registry_selection で Composite 有効化。"""
    from app.ai_pipeline import registry as reg_mod

    monkeypatch.setattr(reg_mod.settings, "asr_provider", "auto")
    monkeypatch.setattr(reg_mod.settings, "mt_provider", "auto")
    monkeypatch.setattr(reg_mod.settings, "tts_provider", "auto")
    monkeypatch.setattr(reg_mod.settings, "use_model_registry_selection", False)
    assert reg_mod.composite_enabled() is False
    monkeypatch.setattr(reg_mod.settings, "use_model_registry_selection", True)
    assert reg_mod.composite_enabled() is True


def test_slot_name_priority_explicit_over_catalog(monkeypatch) -> None:
    """明示スロット指定はカタログ選択より優先される。"""
    from app.ai_pipeline import registry as reg_mod

    monkeypatch.setattr(reg_mod.settings, "use_model_registry_selection", True)
    # 明示指定 "deepgram" はカタログを参照せずそのまま採用。
    assert reg_mod._slot_name(STAGE_ASR, "deepgram", {STAGE_ASR: "gpt4o"}, "ja") == (
        "deepgram"
    )


def test_slot_name_uses_catalog_when_auto(monkeypatch) -> None:
    """auto かつフラグ有効ならカタログ選択（production の provider_name）を使う。"""
    from app.ai_pipeline import registry as reg_mod

    monkeypatch.setattr(reg_mod.settings, "use_model_registry_selection", True)
    # asr の production は provider_name="gpt4o"（既定レジストリに登録済み）。
    assert reg_mod._slot_name(STAGE_ASR, "auto", {STAGE_ASR: "local"}, "ja") == "gpt4o"


def test_slot_name_falls_back_to_default_when_flag_off(monkeypatch) -> None:
    """フラグ OFF なら auto はプリセット既定へ（挙動不変）。"""
    from app.ai_pipeline import registry as reg_mod

    monkeypatch.setattr(reg_mod.settings, "use_model_registry_selection", False)
    assert reg_mod._slot_name(STAGE_ASR, "auto", {STAGE_ASR: "local"}, "ja") == "local"


def test_catalog_slot_name_ignores_unregistered(monkeypatch) -> None:
    """カタログが未登録の名を返しても採用せず None（既定へ縮退）。"""
    from app.ai_pipeline import model_registry
    from app.ai_pipeline import registry as reg_mod

    monkeypatch.setattr(reg_mod.settings, "use_model_registry_selection", True)
    monkeypatch.setattr(
        model_registry, "production_provider_name", lambda _s, _l: "nonexistent"
    )
    assert reg_mod._catalog_slot_name(STAGE_ASR, "ja") is None


# ============================================================
# CompositeAIProvider の A/B セレクタ統合（P4-wiring ②）
# ============================================================
class _RecordingSelector:
    """select で指定実体を返し、note を同期捕捉するテスト用セレクタ。"""

    def __init__(self, mt_instance) -> None:
        self._mt = mt_instance
        self.notes: list = []

    def select(self, stage: str, default):
        if stage == STAGE_MT:
            return self._mt, "exp1", "treatment"
        return default, None, None

    def note(self, **kw) -> None:
        self.notes.append(kw)


def test_composite_uses_selector_mt_and_records() -> None:
    """selector 指定時、translate_audio は variant の MT を使い指標を記録する。"""

    class _AltMT:
        name = "altmt"

        async def translate_text(self, text: str, _src: str, tgt: str) -> str:
            return f"ALT[{tgt}]{text}"

    alt = _AltMT()
    sel = _RecordingSelector(alt)
    comp = CompositeAIProvider(_FakeASR(), _FakeMT(), _FakeTTS(), selector=sel)
    r = asyncio.run(
        comp.translate_audio(b"AUDIO", "ja", "en", original_text="12 個")
    )
    # 既定 _FakeMT ではなく selector の _AltMT が使われる。
    assert r.translated_text == "ALT[en]12 個"
    # MT レイテンシと数字保持率が記録される（数字 "12" を含むため）。
    metrics = {n["metric_name"] for n in sel.notes}
    assert "latency_ms" in metrics
    assert "number_retention" in metrics


def test_composite_without_selector_unchanged() -> None:
    """selector 無しなら従来どおり固定 MT（挙動不変）。"""
    comp = CompositeAIProvider(_FakeASR(), _FakeMT(), _FakeTTS())
    r = asyncio.run(
        comp.translate_audio(b"AUDIO", "ja", "en", original_text="hello")
    )
    assert r.translated_text == "[en]hello"
