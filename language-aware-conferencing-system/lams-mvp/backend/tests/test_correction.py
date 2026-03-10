"""
LLM 補正（Correction）単体テスト

対象: app.ai_pipeline.providers.correction
方針:
    - DB・ネットワーク非依存。Gemini SDK はダミークライアントを注入して検証する。
    - pytest-asyncio 非導入のため、非同期メソッドは asyncio.run で実行する。
    - registry は settings を monkeypatch し、OFF / 鍵未設定 / 有効 を検証する。
"""

import asyncio

from app.ai_pipeline.providers.correction import (
    CorrectionRequest,
    GeminiCorrectionProvider,
    build_correction_prompt,
    get_correction_provider,
    reset_correction_provider,
)
from app.config import settings


class _FakeResp:
    """genai generate_content の戻り値ダミー"""

    def __init__(self, text: str) -> None:
        self.text = text


class _FakeModels:
    """client.models のダミー（呼び出し引数を記録）"""

    def __init__(self, text: str) -> None:
        self._text = text
        self.calls: list[tuple[str, str]] = []

    def generate_content(self, model: str, contents: str) -> _FakeResp:
        self.calls.append((model, contents))
        return _FakeResp(self._text)


class _FakeClient:
    """genai.Client のダミー"""

    def __init__(self, text: str) -> None:
        self.models = _FakeModels(text)


def _req(translated: str = "暫定訳") -> CorrectionRequest:
    return CorrectionRequest(
        source_text="原文",
        translated_text=translated,
        source_language="ja",
        target_language="zh",
    )


def test_build_correction_prompt_contains_constraints() -> None:
    """校正プロンプトは改善.md 11.3 の必須制約を含む"""
    prompt = build_correction_prompt(_req())
    assert "数字" in prompt
    assert "用語集" in prompt
    assert "Chinese" in prompt  # 出力言語が target_language で明示される


def test_build_correction_prompt_includes_glossary_and_context() -> None:
    """用語ヒントと文脈が与えられればプロンプトへ反映される"""
    req = CorrectionRequest(
        source_text="原文",
        translated_text="訳",
        source_language="ja",
        target_language="zh",
        glossary_hint="GLOSSARY_MARK",
        context="CONTEXT_MARK",
    )
    prompt = build_correction_prompt(req)
    assert "GLOSSARY_MARK" in prompt
    assert "CONTEXT_MARK" in prompt


def test_get_correction_provider_off_returns_none(monkeypatch) -> None:
    """既定（off）では補正プロバイダーは無効（None）"""
    reset_correction_provider()
    monkeypatch.setattr(settings, "llm_correction_provider", "off")
    assert get_correction_provider() is None


def test_get_correction_provider_gemini_without_key_returns_none(monkeypatch) -> None:
    """gemini 指定でも GEMINI_API_KEY 未設定なら無効（None）"""
    reset_correction_provider()
    monkeypatch.setattr(settings, "llm_correction_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", None)
    assert get_correction_provider() is None


def test_get_correction_provider_gemini_with_key(monkeypatch) -> None:
    """gemini 指定かつ鍵ありなら GeminiCorrectionProvider を返す"""
    reset_correction_provider()
    monkeypatch.setattr(settings, "llm_correction_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", "dummy-key")
    provider = get_correction_provider()
    assert isinstance(provider, GeminiCorrectionProvider)
    reset_correction_provider()


def test_gemini_correct_translation_with_fake_client() -> None:
    """ダミークライアントの応答が校正結果として返り、変更検知される"""
    provider = GeminiCorrectionProvider(client=_FakeClient("改善後の訳"), model="m")
    result = asyncio.run(provider.correct_translation(_req("暫定訳")))
    assert result.corrected_text == "改善後の訳"
    assert result.changed is True
    assert result.provider == "gemini"


def test_gemini_correct_translation_empty_input_returns_original() -> None:
    """暫定訳が空なら API を呼ばず原値を返す"""
    fake = _FakeClient("無視される")
    provider = GeminiCorrectionProvider(client=fake, model="m")
    result = asyncio.run(provider.correct_translation(_req("")))
    assert result.corrected_text == ""
    assert result.changed is False
    assert fake.models.calls == []  # API 未呼び出し


def test_gemini_correct_translation_empty_response_returns_original() -> None:
    """API 応答が空なら暫定訳をそのまま返す（非破壊）"""
    provider = GeminiCorrectionProvider(client=_FakeClient(""), model="m")
    result = asyncio.run(provider.correct_translation(_req("暫定訳")))
    assert result.corrected_text == "暫定訳"
    assert result.changed is False
