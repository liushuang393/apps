"""
議事録・要約（Minutes）生成 単体テスト

対象: app.ai_pipeline.providers.minutes
方針:
    - DB・ネットワーク非依存。OpenAI / Gemini SDK はダミークライアントを注入する。
    - pytest-asyncio 非導入のため、非同期メソッドは asyncio.run で実行する。
    - registry は settings を monkeypatch し、off / 鍵未設定 / GPT / Gemini / auto を検証する。
"""

import asyncio

from app.ai_pipeline.providers.minutes import (
    GeminiMinutesProvider,
    GptMinutesProvider,
    MinutesRequest,
    build_minutes_prompt,
    get_minutes_provider,
    parse_minutes_response,
    reset_minutes_provider,
)
from app.config import settings

_VALID_JSON = (
    '{"summary": "要約本文", "decisions": ["決定1"], "action_items": ["ToDo1"]}'
)


# --- ダミー OpenAI クライアント -------------------------------------------
class _FakeMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str) -> None:
        self.message = _FakeMessage(content)


class _FakeChatResp:
    def __init__(self, content: str) -> None:
        self.choices = [_FakeChoice(content)]


class _FakeCompletions:
    def __init__(self, content: str) -> None:
        self._content = content
        self.calls: list[dict] = []

    async def create(self, **kwargs: object) -> _FakeChatResp:
        self.calls.append(kwargs)
        return _FakeChatResp(self._content)


class _FakeOpenAIClient:
    def __init__(self, content: str) -> None:
        self.chat = type("_Chat", (), {"completions": _FakeCompletions(content)})()


# --- ダミー Gemini クライアント -------------------------------------------
class _FakeGeminiResp:
    def __init__(self, text: str) -> None:
        self.text = text


class _FakeGeminiModels:
    def __init__(self, text: str) -> None:
        self._text = text
        self.calls: list[tuple[str, str]] = []

    def generate_content(self, model: str, contents: str) -> _FakeGeminiResp:
        self.calls.append((model, contents))
        return _FakeGeminiResp(self._text)


class _FakeGeminiClient:
    def __init__(self, text: str) -> None:
        self.models = _FakeGeminiModels(text)


def _req(transcript: str = "田中: 来週リリースします") -> MinutesRequest:
    return MinutesRequest(transcript=transcript, output_language="ja")


# --- プロンプト ------------------------------------------------------------
def test_build_minutes_prompt_contains_constraints() -> None:
    """議事録プロンプトは JSON キーと出力言語指定を含む"""
    prompt = build_minutes_prompt(_req())
    assert "summary" in prompt
    assert "decisions" in prompt
    assert "action_items" in prompt
    assert "Japanese" in prompt  # 出力言語が明示される


def test_build_minutes_prompt_includes_title() -> None:
    """会議名が与えられればプロンプトへ反映される"""
    req = MinutesRequest(transcript="x", output_language="en", meeting_title="MARK")
    assert "MARK" in build_minutes_prompt(req)


# --- 応答解析 --------------------------------------------------------------
def test_parse_minutes_valid_json() -> None:
    """正常な JSON は各フィールドへ正しく解析される"""
    result = parse_minutes_response(_VALID_JSON, "gpt")
    assert result.summary == "要約本文"
    assert result.decisions == ["決定1"]
    assert result.action_items == ["ToDo1"]
    assert result.provider == "gpt"


def test_parse_minutes_strips_code_fence() -> None:
    """コードフェンス付き JSON もフェンス除去後に解析される"""
    fenced = f"```json\n{_VALID_JSON}\n```"
    result = parse_minutes_response(fenced, "gemini")
    assert result.summary == "要約本文"
    assert result.decisions == ["決定1"]


def test_parse_minutes_invalid_json_falls_back_to_summary() -> None:
    """JSON 解析失敗時は応答全文を summary に格納する（非破壊）"""
    result = parse_minutes_response("これはJSONではない", "gpt")
    assert result.summary == "これはJSONではない"
    assert result.decisions == []
    assert result.action_items == []


def test_parse_minutes_empty_returns_empty() -> None:
    """空応答は空の議事録を返す"""
    result = parse_minutes_response("", "gpt")
    assert result.summary == ""
    assert result.decisions == []


def test_parse_minutes_missing_keys_defaults_to_empty() -> None:
    """キー欠落・型不一致は安全側（空文字 / 空配列）へフォールバックする"""
    result = parse_minutes_response('{"summary": 123, "decisions": "x"}', "gpt")
    assert result.summary == ""
    assert result.decisions == []
    assert result.action_items == []


# --- GPT プロバイダー ------------------------------------------------------
def test_gpt_generate_minutes_with_fake_client() -> None:
    """ダミー OpenAI 応答が議事録として解析される"""
    provider = GptMinutesProvider(client=_FakeOpenAIClient(_VALID_JSON), model="m")
    result = asyncio.run(provider.generate_minutes(_req()))
    assert result.summary == "要約本文"
    assert result.provider == "gpt"


def test_gpt_generate_minutes_empty_transcript_skips_api() -> None:
    """transcript が空なら API を呼ばず空の議事録を返す"""
    fake = _FakeOpenAIClient(_VALID_JSON)
    provider = GptMinutesProvider(client=fake, model="m")
    result = asyncio.run(provider.generate_minutes(_req("")))
    assert result.summary == ""
    assert fake.chat.completions.calls == []  # API 未呼び出し


# --- Gemini プロバイダー ---------------------------------------------------
def test_gemini_generate_minutes_with_fake_client() -> None:
    """ダミー Gemini 応答が議事録として解析される"""
    provider = GeminiMinutesProvider(client=_FakeGeminiClient(_VALID_JSON), model="m")
    result = asyncio.run(provider.generate_minutes(_req()))
    assert result.summary == "要約本文"
    assert result.action_items == ["ToDo1"]
    assert result.provider == "gemini"


def test_gemini_generate_minutes_empty_transcript_skips_api() -> None:
    """transcript が空なら Gemini API を呼ばず空の議事録を返す"""
    fake = _FakeGeminiClient(_VALID_JSON)
    provider = GeminiMinutesProvider(client=fake, model="m")
    result = asyncio.run(provider.generate_minutes(_req("")))
    assert result.summary == ""
    assert fake.models.calls == []


# --- registry --------------------------------------------------------------
def test_get_minutes_provider_off_returns_none(monkeypatch) -> None:
    """off では議事録プロバイダーは無効（None）"""
    reset_minutes_provider()
    monkeypatch.setattr(settings, "llm_minutes_provider", "off")
    assert get_minutes_provider() is None
    reset_minutes_provider()


def test_get_minutes_provider_auto_prefers_gpt(monkeypatch) -> None:
    """auto かつ OPENAI_API_KEY ありなら GPT を優先する"""
    reset_minutes_provider()
    monkeypatch.setattr(settings, "llm_minutes_provider", "auto")
    monkeypatch.setattr(settings, "openai_api_key", "dummy")
    monkeypatch.setattr(settings, "gemini_api_key", "dummy")
    assert isinstance(get_minutes_provider(), GptMinutesProvider)
    reset_minutes_provider()


def test_get_minutes_provider_auto_fallback_gemini(monkeypatch) -> None:
    """auto かつ OPENAI 鍵なし・GEMINI 鍵ありなら Gemini へ fallback する"""
    reset_minutes_provider()
    monkeypatch.setattr(settings, "llm_minutes_provider", "auto")
    monkeypatch.setattr(settings, "openai_api_key", None)
    monkeypatch.setattr(settings, "gemini_api_key", "dummy")
    assert isinstance(get_minutes_provider(), GeminiMinutesProvider)
    reset_minutes_provider()


def test_get_minutes_provider_auto_no_keys_returns_none(monkeypatch) -> None:
    """auto でどちらの鍵も無ければ None（API は 503）"""
    reset_minutes_provider()
    monkeypatch.setattr(settings, "llm_minutes_provider", "auto")
    monkeypatch.setattr(settings, "openai_api_key", None)
    monkeypatch.setattr(settings, "gemini_api_key", None)
    assert get_minutes_provider() is None
    reset_minutes_provider()


def test_get_minutes_provider_gpt_without_key_returns_none(monkeypatch) -> None:
    """gpt 固定でも鍵が無ければ None"""
    reset_minutes_provider()
    monkeypatch.setattr(settings, "llm_minutes_provider", "gpt")
    monkeypatch.setattr(settings, "openai_api_key", None)
    assert get_minutes_provider() is None
    reset_minutes_provider()
