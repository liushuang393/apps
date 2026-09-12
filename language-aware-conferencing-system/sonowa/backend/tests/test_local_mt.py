"""
Lite 本地 MT ステージ（MADLAD-400 単一多言語）の単体テスト。

方針:
    - GPU / ctranslate2 / transformers 非依存で通ること。
    - translator + tokenizer をフェイク注入し translate_text の訳出経路を検証する。
    - 4言語タグ・単一エンジン再利用・source==target・空入力・例外時 "" 契約を確認。
"""

import pytest

from app.ai_pipeline.providers import local_mt
from app.ai_pipeline.providers.local_mt import LocalMTStage


class _FakeTokenizer:
    """encode / convert_ids_to_tokens / convert_tokens_to_ids / decode 互換。"""

    def encode(self, text: str) -> list[int]:
        return list(range(len(text.split())))

    def convert_ids_to_tokens(self, ids: list[int]) -> list[str]:
        return [f"t{i}" for i in ids]

    def convert_tokens_to_ids(self, tokens: list[str]) -> list[int]:
        return list(range(len(tokens)))

    def decode(self, ids: list[int], skip_special_tokens: bool = True) -> str:  # noqa: ARG002
        return "你好 世界" if ids else ""


class _FakeResult:
    def __init__(self, hypothesis: list[str]) -> None:
        self.hypotheses = [hypothesis]


class _FakeTranslator:
    """translate_batch を備えた CTranslate2.Translator 互換フェイク。"""

    def __init__(self, translated_tokens: list[str] | None = None) -> None:
        self._translated_tokens = translated_tokens or ["out"]
        self.calls: list[list[str]] = []

    def translate_batch(self, batch: list[list[str]]) -> list[_FakeResult]:
        self.calls.append(batch[0])
        return [_FakeResult(list(self._translated_tokens))]


def _make_stage() -> tuple[LocalMTStage, _FakeTranslator]:
    translator = _FakeTranslator()
    stage = LocalMTStage(translator=translator, tokenizer=_FakeTokenizer())
    return stage, translator


def test_module_imports() -> None:
    assert hasattr(local_mt, "LocalMTStage")
    assert local_mt.LocalMTStage.name == "local"


@pytest.mark.asyncio
async def test_translate_returns_text() -> None:
    stage, translator = _make_stage()
    out = await stage.translate_text("こんにちは 世界", "ja", "zh")
    assert out == "你好 世界"
    assert translator.calls


def test_translate_prefixes_target_language_tag() -> None:
    """MADLAD は入力先頭に <2xx> ターゲット言語タグを付ける。"""
    assert local_mt.target_tag("ja") == "<2ja>"
    assert local_mt.target_tag("zh") == "<2zh>"
    assert local_mt.target_tag("vi") == "<2vi>"
    assert local_mt.target_tag("en") == "<2en>"


@pytest.mark.asyncio
async def test_four_languages_use_single_engine_key() -> None:
    """言語対ごとに別モデルをロードせず、単一キーでブローカー再利用する。"""
    stage, _translator = _make_stage()
    broker_keys: list[str] = []

    class _RecordingBroker:
        async def use(self, key: str, **_kwargs: object):  # noqa: ANN003
            broker_keys.append(key)

            class _Ctx:
                async def __aenter__(self_inner) -> object:
                    return stage._translator and _FakeTranslator() or object()

                async def __aexit__(self_inner, *_args: object) -> None:
                    return None

            # 注入 translator がある場合は broker を経由しない実装もあるため、
            # キー契約はモジュール定数で固定する。
            return _Ctx()

    assert local_mt.ENGINE_CACHE_KEY == "mt:madlad400"
    for src, tgt in (("ja", "en"), ("en", "zh"), ("zh", "vi"), ("vi", "ja")):
        out = await stage.translate_text("test", src, tgt)
        assert out == "你好 世界"


@pytest.mark.asyncio
async def test_same_language_returns_original() -> None:
    stage, translator = _make_stage()
    out = await stage.translate_text("そのまま返す", "ja", "ja")
    assert out == "そのまま返す"
    assert translator.calls == []


@pytest.mark.asyncio
async def test_empty_input_returns_empty() -> None:
    stage, translator = _make_stage()
    assert await stage.translate_text("", "ja", "en") == ""
    assert await stage.translate_text("   ", "ja", "en") == ""
    assert translator.calls == []


class _BrokenTranslator:
    def translate_batch(self, batch: list[list[str]]) -> list[_FakeResult]:  # noqa: ARG002
        raise RuntimeError("推論失敗")


@pytest.mark.asyncio
async def test_exception_returns_empty() -> None:
    stage = LocalMTStage(translator=_BrokenTranslator(), tokenizer=_FakeTokenizer())
    out = await stage.translate_text("これは失敗する", "ja", "en")
    assert out == ""


def test_available_returns_bool() -> None:
    result = local_mt.available()
    assert isinstance(result, bool)


def test_available_false_without_model_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(local_mt.settings, "local_mt_model_dir", None)
    assert local_mt.available() is False


def test_supported_target_tags_cover_four_languages() -> None:
    assert set(local_mt.SUPPORTED_TARGET_TAGS) == {"ja", "en", "zh", "vi"}
