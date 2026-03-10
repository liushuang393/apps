"""
Google プロバイダー（Mode B：Chirp 3 ASR + Cloud Translation）単体テスト

対象: app.ai_pipeline.providers.google
方針:
    - Google/OpenAI SDK・ネットワーク・認証に非依存。純粋ロジックを中心に検証する。
    - pytest-asyncio 非導入のため、非同期メソッドは asyncio.run で実行する。
    - speech_client / openai_client を注入し、SDK 呼び出しをスタブ化する。
"""

import asyncio
from types import SimpleNamespace

from app.ai_pipeline.providers.base import TranslationResult
from app.ai_pipeline.providers.google import (
    GoogleProvider,
    extract_transcript,
    from_bcp47,
    google_runtime_available,
    to_bcp47,
)
from app.config import settings


def _make_result(transcript: str, language_code: str = "") -> SimpleNamespace:
    """Speech V2 result 風のスタブ（alternatives[0].transcript + language_code）"""
    alt = SimpleNamespace(transcript=transcript)
    return SimpleNamespace(alternatives=[alt], language_code=language_code)


# ============================================================
# 言語コード変換（BCP-47）
# ============================================================
def test_to_bcp47_known_languages() -> None:
    assert to_bcp47("ja") == "ja-JP"
    assert to_bcp47("en") == "en-US"
    assert to_bcp47("zh") == "zh-CN"
    assert to_bcp47("vi") == "vi-VN"


def test_to_bcp47_unknown_passthrough() -> None:
    # 未知コードはそのまま返す（multi 等）
    assert to_bcp47("multi") == "multi"


def test_from_bcp47_normalizes_to_internal() -> None:
    assert from_bcp47("ja-JP") == "ja"
    assert from_bcp47("zh-CN") == "zh"
    assert from_bcp47("en") == "en"
    assert from_bcp47("") == ""


# ============================================================
# transcript 抽出（純粋関数）
# ============================================================
def test_extract_transcript_joins_and_detects() -> None:
    results = [_make_result("こんにちは", "ja-JP"), _make_result(" 世界 ")]
    text, lang = extract_transcript(results)
    assert text == "こんにちは 世界"
    assert lang == "ja-JP"


def test_extract_transcript_empty() -> None:
    assert extract_transcript([]) == ("", "")
    assert extract_transcript(None) == ("", "")


# ============================================================
# 起動可否判定（env ゲート）
# ============================================================
def test_runtime_unavailable_without_project(monkeypatch) -> None:
    # speech lib は導入済でも、project_id も認証 env も無ければ無効
    monkeypatch.setattr(settings, "google_project_id", None)
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    assert google_runtime_available() is False


def test_runtime_available_with_project(monkeypatch) -> None:
    monkeypatch.setattr(settings, "google_project_id", "demo-project")
    # speech lib が導入済の環境では True（未導入環境では False になり得る）
    import importlib.util

    has_speech = importlib.util.find_spec("google.cloud.speech") is not None
    assert google_runtime_available() is has_speech


# ============================================================
# ASR（speech_client 注入でスタブ化）
# ============================================================
class _FakeSpeechClient:
    """client.recognize の戻り値をスタブ化"""

    def __init__(self, results: list) -> None:
        self._results = results

    def recognize(self, request) -> SimpleNamespace:  # noqa: ARG002
        return SimpleNamespace(results=self._results)


def test_transcribe_with_detection_uses_chirp(monkeypatch) -> None:
    monkeypatch.setattr(settings, "google_project_id", "demo-project")
    client = _FakeSpeechClient([_make_result("テスト発話です", "ja-JP")])
    provider = GoogleProvider(speech_client=client)
    audio = b"\x00" * (44 + 8000)
    text, lang = asyncio.run(provider.transcribe_with_detection(audio, "ja"))
    assert text == "テスト発話です"
    assert lang == "ja"


def test_transcribe_short_audio_skipped() -> None:
    provider = GoogleProvider(speech_client=_FakeSpeechClient([]))
    text, lang = asyncio.run(provider.transcribe_with_detection(b"\x00" * 10, "ja"))
    assert text == ""
    assert lang == "ja"


# ============================================================
# 翻訳フォールバック（Google 不可 → OpenAI）
# ============================================================
class _FakeOpenAIClient:
    """chat.completions.create をスタブ化した OpenAI 互換クライアント"""

    def __init__(self, text: str) -> None:
        msg = SimpleNamespace(content=text)
        choice = SimpleNamespace(message=msg)
        completion = SimpleNamespace(choices=[choice])

        async def _create(**_kwargs: object):
            return completion

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=_create))


def test_translate_audio_falls_back_to_openai() -> None:
    # google-cloud-translate 未導入環境では Cloud Translation が ImportError となり
    # OpenAI フォールバックで翻訳されることを検証する。
    provider = GoogleProvider(
        speech_client=_FakeSpeechClient([_make_result("おはよう", "ja-JP")]),
        openai_client=_FakeOpenAIClient("Good morning"),
    )
    audio = b"\x00" * (44 + 8000)
    result = asyncio.run(provider.translate_audio(audio, "ja", "en"))
    assert isinstance(result, TranslationResult)
    assert result.original_text == "おはよう"
    assert result.translated_text == "Good morning"
    assert result.audio_data is None
