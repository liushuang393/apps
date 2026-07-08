"""
Lite 本地 MT ステージ（app.ai_pipeline.providers.local_mt）の単体テスト。

方針:
    - GPU / ctranslate2 / transformers 非依存で通ること（この環境に無い）。
    - translator + tokenizer をフェイク注入し translate_text の訳出経路を検証する。
    - source==target の原文返却、空入力の ""、例外時の "" 契約、available() の bool を確認。
"""

import pytest

from app.ai_pipeline.providers import local_mt
from app.ai_pipeline.providers.local_mt import LocalMTStage


# ----- CTranslate2 / transformers 互換フェイク -----
class _FakeTokenizer:
    """tokenize / convert_tokens_to_string を備えた最小トークナイザ。"""

    def tokenize(self, text: str) -> list[str]:
        return text.split()

    def convert_tokens_to_string(self, tokens: list[str]) -> str:
        return " ".join(tokens)


class _FakeResult:
    def __init__(self, hypothesis: list[str]) -> None:
        self.hypotheses = [hypothesis]


class _FakeTranslator:
    """translate_batch を備えた CTranslate2.Translator 互換フェイク。"""

    def __init__(self, translated: str = "hello world") -> None:
        self._translated = translated
        self.calls: list[list[str]] = []

    def translate_batch(self, batch: list[list[str]]) -> list[_FakeResult]:
        self.calls.append(batch[0])
        return [_FakeResult(self._translated.split())]


def _make_stage(translated: str = "hello world") -> tuple[LocalMTStage, _FakeTranslator]:
    translator = _FakeTranslator(translated=translated)
    stage = LocalMTStage(translator=translator, tokenizer=_FakeTokenizer())
    return stage, translator


# ============================================================
# import 可能性（パッケージ未導入でも成功すること）
# ============================================================
def test_module_imports() -> None:
    assert hasattr(local_mt, "LocalMTStage")
    assert local_mt.LocalMTStage.name == "local"


# ============================================================
# translate_text 正常系（フェイク注入）
# ============================================================
@pytest.mark.asyncio
async def test_translate_returns_text() -> None:
    stage, translator = _make_stage(translated="你好 世界")
    out = await stage.translate_text("こんにちは 世界", "ja", "zh")
    assert out == "你好 世界"
    assert translator.calls  # translate_batch が呼ばれた


@pytest.mark.asyncio
async def test_translate_tokenizes_input() -> None:
    stage, translator = _make_stage()
    await stage.translate_text("good morning everyone", "en", "ja")
    # tokenizer.tokenize（空白分割）の結果が translate_batch に渡る。
    assert translator.calls[0] == ["good", "morning", "everyone"]


# ============================================================
# source == target は原文返却
# ============================================================
@pytest.mark.asyncio
async def test_same_language_returns_original() -> None:
    stage, translator = _make_stage()
    out = await stage.translate_text("そのまま返す", "ja", "ja")
    assert out == "そのまま返す"
    assert translator.calls == []  # 翻訳エンジンは呼ばれない


# ============================================================
# 空入力は ""
# ============================================================
@pytest.mark.asyncio
async def test_empty_input_returns_empty() -> None:
    stage, translator = _make_stage()
    assert await stage.translate_text("", "ja", "en") == ""
    assert await stage.translate_text("   ", "ja", "en") == ""
    assert translator.calls == []


# ============================================================
# 例外時は "" 契約（雲へ縮退可能に）
# ============================================================
class _BrokenTranslator:
    def translate_batch(self, batch: list[list[str]]) -> list[_FakeResult]:  # noqa: ARG002
        raise RuntimeError("推論失敗")


@pytest.mark.asyncio
async def test_exception_returns_empty() -> None:
    stage = LocalMTStage(translator=_BrokenTranslator(), tokenizer=_FakeTokenizer())
    out = await stage.translate_text("これは失敗する", "ja", "en")
    assert out == ""


# ============================================================
# available() は bool（この環境では False）
# ============================================================
def test_available_returns_bool() -> None:
    result = local_mt.available()
    assert isinstance(result, bool)


def test_available_false_without_model_dir(monkeypatch) -> None:
    monkeypatch.setattr(local_mt.settings, "local_mt_model_dir", None)
    assert local_mt.available() is False


# ============================================================
# 言語対ディレクトリ名の導出
# ============================================================
def test_pair_dir_name() -> None:
    assert local_mt._pair_dir_name("ja", "en") == "opus-mt-ja-en"
    assert local_mt._pair_dir_name("zh", "vi") == "opus-mt-zh-vi"
