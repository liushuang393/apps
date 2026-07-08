"""プロバイダー・プラグイン SDK（P4-D）の単体テスト：契約検証・衝突防止・fail-safe 読込。"""

import types

import pytest

from app.ai_pipeline import plugin_sdk
from app.ai_pipeline.plugin_sdk import (
    PluginError,
    load_configured_plugins,
    load_plugin_module,
    register_plugin,
    verify_stage_contract,
)
from app.ai_pipeline.registry import STAGE_ASR, STAGE_MT, STAGE_TTS, ProviderRegistry


# ---- 契約を満たす/満たさないダミー実体 ----
class _GoodASR:
    name = "good_asr"

    async def transcribe_audio(self, _audio: bytes, _lang: str) -> str:
        return "ok"

    async def transcribe_with_detection(
        self, _audio: bytes, _hint: str = "multi"
    ) -> tuple[str, str]:
        return ("ok", "ja")


class _GoodMT:
    name = "good_mt"

    async def translate_text(self, _text: str, _s: str, _t: str) -> str:
        return "translated"


class _GoodTTS:
    name = "good_tts"

    async def synthesize(self, _text: str, _lang: str) -> bytes | None:
        return b"audio"


class _BadASR:
    """transcribe_with_detection を欠く契約違反実体。"""

    name = "bad_asr"

    async def transcribe_audio(self, _audio: bytes, _lang: str) -> str:
        return "ok"


# ---- verify_stage_contract ----


def test_verify_contract_true_for_compliant() -> None:
    assert verify_stage_contract(STAGE_ASR, _GoodASR()) is True
    assert verify_stage_contract(STAGE_MT, _GoodMT()) is True
    assert verify_stage_contract(STAGE_TTS, _GoodTTS()) is True


def test_verify_contract_false_for_missing_method() -> None:
    assert verify_stage_contract(STAGE_ASR, _BadASR()) is False


def test_verify_contract_false_for_unknown_stage() -> None:
    assert verify_stage_contract("bogus", _GoodASR()) is False


# ---- register_plugin バリデーション ----


def test_register_and_resolve() -> None:
    """登録した実体が resolve で得られる。"""
    reg = ProviderRegistry()
    register_plugin(reg, name="p_asr", stage=STAGE_ASR, factory=_GoodASR)
    inst = reg.resolve(STAGE_ASR, "p_asr")
    assert isinstance(inst, _GoodASR)


def test_register_rejects_unknown_stage() -> None:
    reg = ProviderRegistry()
    with pytest.raises(PluginError):
        register_plugin(reg, name="x", stage="bogus", factory=_GoodASR)


def test_register_rejects_empty_name() -> None:
    reg = ProviderRegistry()
    with pytest.raises(PluginError):
        register_plugin(reg, name="", stage=STAGE_ASR, factory=_GoodASR)


def test_register_rejects_non_callable_factory() -> None:
    reg = ProviderRegistry()
    with pytest.raises(PluginError):
        register_plugin(reg, name="x", stage=STAGE_ASR, factory=object())


def test_register_refuses_override_without_flag() -> None:
    """既存名の上書きは allow_override が無いと拒否。"""
    reg = ProviderRegistry()
    register_plugin(reg, name="dup", stage=STAGE_MT, factory=_GoodMT)
    with pytest.raises(PluginError):
        register_plugin(reg, name="dup", stage=STAGE_MT, factory=_GoodMT)


def test_register_allows_override_with_flag() -> None:
    reg = ProviderRegistry()
    register_plugin(reg, name="dup", stage=STAGE_MT, factory=_GoodMT)
    register_plugin(
        reg, name="dup", stage=STAGE_MT, factory=_GoodMT, allow_override=True
    )
    assert "dup" in reg.names(STAGE_MT)


# ---- 契約検証は解決時にフェイルファスト ----


def test_contract_violation_resolves_to_none_without_fallback() -> None:
    """契約違反実体は解決時に PluginError となるが、registry は例外を握り None を返す
    （破損プラグインが会議解決全体を巻き添えにしない＝フェイルソフト）。"""
    reg = ProviderRegistry()
    register_plugin(reg, name="bad", stage=STAGE_ASR, factory=_BadASR)
    assert reg.resolve(STAGE_ASR, "bad") is None


def test_contract_violation_falls_back_to_valid() -> None:
    """契約違反プラグインでも fallback 指定があれば正常な実体へ委譲する。"""
    reg = ProviderRegistry()
    register_plugin(reg, name="good", stage=STAGE_ASR, factory=_GoodASR)
    register_plugin(reg, name="bad", stage=STAGE_ASR, factory=_BadASR, fallback="good")
    assert isinstance(reg.resolve(STAGE_ASR, "bad"), _GoodASR)


def test_verify_false_skips_contract_check() -> None:
    """verify=False なら契約検証せず素の実体を返す（著者責任）。"""
    reg = ProviderRegistry()
    register_plugin(reg, name="bad", stage=STAGE_ASR, factory=_BadASR, verify=False)
    assert isinstance(reg.resolve(STAGE_ASR, "bad"), _BadASR)


# ---- available / fallback ----


def test_unavailable_plugin_falls_back() -> None:
    """プラグインが利用不可なら fallback へ委譲する。"""
    reg = ProviderRegistry()
    register_plugin(reg, name="base_mt", stage=STAGE_MT, factory=_GoodMT)
    register_plugin(
        reg,
        name="ext_mt",
        stage=STAGE_MT,
        factory=_GoodMT,
        available=lambda: False,
        fallback="base_mt",
    )
    inst = reg.resolve(STAGE_MT, "ext_mt")
    assert isinstance(inst, _GoodMT)


# ---- load_plugin_module ----


def _fake_module(**attrs) -> types.ModuleType:
    m = types.ModuleType("fake_plugin")
    for k, v in attrs.items():
        setattr(m, k, v)
    return m


def test_load_module_via_register_fn(monkeypatch) -> None:
    """register(registry) 関数を公開するモジュールを読み込む。"""

    def _register(registry):
        register_plugin(registry, name="via_fn", stage=STAGE_TTS, factory=_GoodTTS)

    monkeypatch.setattr(
        plugin_sdk.importlib,
        "import_module",
        lambda _path: _fake_module(register=_register),
    )
    reg = ProviderRegistry()
    assert load_plugin_module(reg, "any.path") == 1
    assert "via_fn" in reg.names(STAGE_TTS)


def test_load_module_via_plugins_list(monkeypatch) -> None:
    """PLUGINS(list) を公開するモジュールを読み込む。"""
    plugins = [
        {"name": "l_asr", "stage": STAGE_ASR, "factory": _GoodASR},
        {"name": "l_mt", "stage": STAGE_MT, "factory": _GoodMT},
    ]
    monkeypatch.setattr(
        plugin_sdk.importlib,
        "import_module",
        lambda _path: _fake_module(PLUGINS=plugins),
    )
    reg = ProviderRegistry()
    assert load_plugin_module(reg, "any.path") == 2


def test_load_module_import_failure_returns_zero(monkeypatch) -> None:
    """import 失敗は 0（例外を伝播しない）。"""

    def _boom(_path):
        raise ImportError("no module")

    monkeypatch.setattr(plugin_sdk.importlib, "import_module", _boom)
    reg = ProviderRegistry()
    assert load_plugin_module(reg, "missing") == 0


def test_load_module_neither_contract_returns_zero(monkeypatch) -> None:
    """register も PLUGINS も無いモジュールは 0。"""
    monkeypatch.setattr(
        plugin_sdk.importlib, "import_module", lambda _path: _fake_module(foo=1)
    )
    reg = ProviderRegistry()
    assert load_plugin_module(reg, "any") == 0


def test_load_module_register_fn_error_returns_zero(monkeypatch) -> None:
    """register() が例外でもコアを壊さず 0。"""

    def _register(_registry):
        raise RuntimeError("plugin boom")

    monkeypatch.setattr(
        plugin_sdk.importlib,
        "import_module",
        lambda _path: _fake_module(register=_register),
    )
    reg = ProviderRegistry()
    assert load_plugin_module(reg, "any") == 0


def test_load_module_skips_invalid_plugins_entry(monkeypatch) -> None:
    """PLUGINS の不正エントリはスキップし、正しいものは登録する。"""
    plugins = [
        {"name": "ok", "stage": STAGE_MT, "factory": _GoodMT},
        {"name": "bad", "stage": "BOGUS", "factory": _GoodMT},  # stage 不正
        {"stage": STAGE_MT, "factory": _GoodMT},  # name 欠落（KeyError）
    ]
    monkeypatch.setattr(
        plugin_sdk.importlib,
        "import_module",
        lambda _path: _fake_module(PLUGINS=plugins),
    )
    reg = ProviderRegistry()
    assert load_plugin_module(reg, "any") == 1
    assert "ok" in reg.names(STAGE_MT)


# ---- load_configured_plugins（設定駆動） ----


def test_load_configured_disabled(monkeypatch) -> None:
    """enable_provider_plugins=False なら 0。"""
    monkeypatch.setattr(plugin_sdk.settings, "enable_provider_plugins", False)
    assert load_configured_plugins(ProviderRegistry()) == 0


def test_load_configured_empty_paths(monkeypatch) -> None:
    """パス未設定なら 0。"""
    monkeypatch.setattr(plugin_sdk.settings, "enable_provider_plugins", True)
    monkeypatch.setattr(plugin_sdk.settings, "provider_plugins", "  ")
    assert load_configured_plugins(ProviderRegistry()) == 0


def test_load_configured_multiple_paths(monkeypatch) -> None:
    """カンマ区切りの複数モジュールを読み込み合計件数を返す。"""

    def _register(registry):
        register_plugin(registry, name="c_tts", stage=STAGE_TTS, factory=_GoodTTS)

    monkeypatch.setattr(plugin_sdk.settings, "enable_provider_plugins", True)
    monkeypatch.setattr(
        plugin_sdk.settings, "provider_plugins", "mod.a, mod.b"
    )
    monkeypatch.setattr(
        plugin_sdk.importlib,
        "import_module",
        lambda _path: _fake_module(register=_register),
    )
    # 2 モジュール × 各 1 登録。ただし 2 個目は同名 c_tts の上書きになり PluginError→
    # register_fn 内で送出され当該モジュールは 0 になる。よって合計 1。
    assert load_configured_plugins(ProviderRegistry()) == 1
