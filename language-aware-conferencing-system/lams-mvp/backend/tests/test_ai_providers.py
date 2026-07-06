"""
AI プロバイダー接続テスト

Gemini API と OpenAI Realtime API の接続確認用テスト。
環境変数から API キーを読み込んでテストを実行する。

実行方法:
    docker exec lams-mvp-backend-1 python -m pytest tests/test_ai_providers.py -v
    または
    docker exec lams-mvp-backend-1 python tests/test_ai_providers.py
"""

import asyncio
import os
import sys
from types import SimpleNamespace

import pytest

from app.ai_pipeline.providers.base import TranslationResult
from app.ai_pipeline.providers.gemini_live import (
    GeminiLiveProvider,
    normalize_lang,
    parse_live_messages,
    pcm16_to_wav,
    to_gemini_target,
)

# テスト結果の色付け出力
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"


def print_result(name: str, success: bool, message: str = "") -> None:
    """テスト結果を色付きで出力"""
    status = f"{GREEN}✓ PASS{RESET}" if success else f"{RED}✗ FAIL{RESET}"
    print(f"{status} {name}")
    if message:
        print(f"       {message}")


async def test_gemini_api() -> bool:
    """
    Gemini API 接続テスト
    シンプルなテキスト生成でAPIが動作するか確認
    """
    api_key = os.getenv("GEMINI_API_KEY", "")
    base_url = os.getenv("GEMINI_BASE_URL", "")
    model = os.getenv("GEMINI_MODEL", "models/gemini-2.5-flash")

    if not api_key or api_key == "your_gemini_api_key":
        print_result("Gemini API", False, "GEMINI_API_KEY が設定されていません")
        return False

    try:
        from google import genai
        from google.genai import types as genai_types

        # base_url が空でなければ設定
        http_options = None
        if base_url and base_url != "https://gemini.googleapis.com":
            http_options = genai_types.HttpOptions(base_url=base_url)

        client = genai.Client(api_key=api_key, http_options=http_options)

        # シンプルなテキスト生成テスト
        response = client.models.generate_content(
            model=model,
            contents="Say 'Hello, LAMS!' in one short sentence.",
        )

        if response.text:
            print_result("Gemini API", True, f"応答: {response.text[:50]}...")
            return True
        else:
            print_result("Gemini API", False, "応答が空です")
            return False

    except Exception as e:
        print_result("Gemini API", False, f"エラー: {e}")
        return False


async def test_openai_api() -> bool:
    """
    OpenAI API 接続テスト
    通常の Chat Completions でAPIが動作するか確認
    （Realtime API は WebSocket なので簡易テストは Chat で代用）
    """
    api_key = os.getenv("OPENAI_API_KEY", "")
    base_url = os.getenv("OPENAI_BASE_URL", "")

    if not api_key or api_key == "your_openai_api_key":
        print_result("OpenAI API", False, "OPENAI_API_KEY が設定されていません")
        return False

    try:
        from openai import AsyncOpenAI

        # base_url が空の場合は None を渡す
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url or None,
        )

        # シンプルな Chat Completions テスト
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": "Say 'Hello, LAMS!' in one short sentence."}
            ],
            max_tokens=50,
        )

        if response.choices and response.choices[0].message.content:
            text = response.choices[0].message.content
            print_result("OpenAI API", True, f"応答: {text[:50]}...")
            return True
        else:
            print_result("OpenAI API", False, "応答が空です")
            return False

    except Exception as e:
        print_result("OpenAI API", False, f"エラー: {e}")
        return False


async def main() -> int:
    """メイン関数：両APIをテスト"""
    print(f"\n{YELLOW}=== AI プロバイダー接続テスト ==={RESET}\n")

    # 環境変数の確認
    print(f"AI_PROVIDER: {os.getenv('AI_PROVIDER', '未設定')}")
    print(f"GEMINI_MODEL: {os.getenv('GEMINI_MODEL', '未設定')}")
    print(f"OPENAI_REALTIME_MODEL: {os.getenv('OPENAI_REALTIME_MODEL', '未設定')}")
    print()

    results = []

    # Gemini テスト
    results.append(await test_gemini_api())

    # OpenAI テスト
    results.append(await test_openai_api())

    # 結果サマリー
    print(f"\n{YELLOW}=== 結果サマリー ==={RESET}")
    passed = sum(results)
    total = len(results)
    print(f"合格: {passed}/{total}")

    return 0 if all(results) else 1


# ============================================================
# Gemini Live S2S プロバイダー 単体テスト
# 方針:
#   - google-genai SDK・ネットワーク・認証に非依存。純粋ロジックを中心に検証する。
#   - pytest-asyncio 非導入のため、非同期メソッドは asyncio.run で実行する。
#   - client を注入し、aio.live.connect セッションをスタブ化する。
# ============================================================
MIN_VALID_AUDIO = b"\x00" * (44 + 8000)


def _live_msg(
    input_text: str | None = None,
    input_lang: str | None = None,
    output_text: str | None = None,
    audio: bytes | None = None,
    turn_complete: bool = False,
) -> SimpleNamespace:
    """LiveServerMessage 風スタブ（server_content の各フィールドを再現）"""
    it = None
    if input_text is not None or input_lang is not None:
        it = SimpleNamespace(text=input_text, language_code=input_lang)
    ot = SimpleNamespace(text=output_text) if output_text is not None else None
    mt = None
    if audio is not None:
        part = SimpleNamespace(inline_data=SimpleNamespace(data=audio))
        mt = SimpleNamespace(parts=[part])
    sc = SimpleNamespace(
        input_transcription=it,
        output_transcription=ot,
        model_turn=mt,
        turn_complete=turn_complete,
    )
    return SimpleNamespace(server_content=sc)


class _FakeLiveSession:
    """aio.live.connect が返すセッションのスタブ"""

    def __init__(self, messages: list) -> None:
        self._messages = messages
        self.sent: list = []

    async def send_realtime_input(self, **kwargs: object) -> None:
        self.sent.append(kwargs)

    async def receive(self):
        for msg in self._messages:
            yield msg


class _FakeConnect:
    """async context manager を満たす connect() 戻り値スタブ"""

    def __init__(self, session: _FakeLiveSession) -> None:
        self._session = session

    async def __aenter__(self) -> _FakeLiveSession:
        return self._session

    async def __aexit__(self, *_exc: object) -> bool:
        return False


class _FakeGeminiClient:
    """client.aio.live.connect(model, config) をスタブ化したクライアント"""

    def __init__(self, messages: list) -> None:
        session = _FakeLiveSession(messages)
        self.session = session
        connect = SimpleNamespace(
            connect=lambda model, config: _FakeConnect(session)  # noqa: ARG005
        )
        self.aio = SimpleNamespace(live=connect)


# ------------------------------------------------------------
# 言語コード変換（BCP-47）
# ------------------------------------------------------------
def test_to_gemini_target_known_and_passthrough() -> None:
    assert to_gemini_target("ja") == "ja"
    assert to_gemini_target("zh") == "zh"
    # 未知コードはそのまま返す
    assert to_gemini_target("multi") == "multi"


def test_normalize_lang() -> None:
    assert normalize_lang("ja-JP") == "ja"
    assert normalize_lang("EN-US") == "en"
    assert normalize_lang("") == ""


# ------------------------------------------------------------
# WAV ヘッダー付与（純粋関数）
# ------------------------------------------------------------
def test_pcm16_to_wav_header() -> None:
    pcm = b"\x01\x02" * 100
    wav = pcm16_to_wav(pcm)
    assert wav[:4] == b"RIFF"
    assert wav[8:12] == b"WAVE"
    # data チャンクは PCM 本体を保持する
    assert wav[44:] == pcm
    # 24kHz サンプルレートが little-endian で埋め込まれている
    assert int.from_bytes(wav[24:28], "little") == 24000


# ------------------------------------------------------------
# メッセージ解析（純粋関数）
# ------------------------------------------------------------
def test_parse_live_messages_collects_all_fields() -> None:
    messages = [
        _live_msg(input_text="おはよう", input_lang="ja-JP"),
        _live_msg(output_text="Good "),
        _live_msg(output_text="morning", audio=b"\xaa\xbb"),
        _live_msg(turn_complete=True),
    ]
    result = parse_live_messages(messages)
    assert result.original == "おはよう"
    assert result.translated == "Good morning"
    assert result.detected_language == "ja-JP"
    assert result.audio == b"\xaa\xbb"


def test_parse_live_messages_empty() -> None:
    result = parse_live_messages(None)
    assert result.original == ""
    assert result.translated == ""
    assert result.audio == b""


# ------------------------------------------------------------
# translate_audio / transcribe_with_detection（client 注入でスタブ化）
# ------------------------------------------------------------
def test_translate_audio_s2s() -> None:
    messages = [
        _live_msg(input_text="おはよう", input_lang="ja-JP"),
        _live_msg(output_text="Good morning", audio=b"\x10\x20" * 50),
        _live_msg(turn_complete=True),
    ]
    provider = GeminiLiveProvider(client=_FakeGeminiClient(messages))
    result = asyncio.run(provider.translate_audio(MIN_VALID_AUDIO, "ja", "en"))
    assert isinstance(result, TranslationResult)
    assert result.original_text == "おはよう"
    assert result.translated_text == "Good morning"
    # 翻訳音声は WAV 化されて返る
    assert result.audio_data is not None
    assert result.audio_data[:4] == b"RIFF"
    # audio_stream_end が送信されている
    assert any("audio_stream_end" in s for s in provider._client.session.sent)


def test_translate_audio_short_skipped() -> None:
    provider = GeminiLiveProvider(client=_FakeGeminiClient([]))
    result = asyncio.run(provider.translate_audio(b"\x00" * 10, "ja", "en"))
    assert result.translated_text == ""
    assert result.audio_data is None


def test_translate_audio_same_language_transcribes() -> None:
    messages = [
        _live_msg(input_text="こんにちは", input_lang="ja-JP"),
        _live_msg(turn_complete=True),
    ]
    provider = GeminiLiveProvider(client=_FakeGeminiClient(messages))
    result = asyncio.run(provider.translate_audio(MIN_VALID_AUDIO, "ja", "ja"))
    assert result.original_text == "こんにちは"
    assert result.translated_text == "こんにちは"
    assert result.audio_data is None


def test_transcribe_with_detection() -> None:
    messages = [
        _live_msg(input_text="テスト発話です", input_lang="ja-JP"),
        _live_msg(turn_complete=True),
    ]
    provider = GeminiLiveProvider(client=_FakeGeminiClient(messages))
    text, lang = asyncio.run(provider.transcribe_with_detection(MIN_VALID_AUDIO, "ja"))
    assert text == "テスト発話です"
    assert lang == "ja"


# ------------------------------------------------------------
# 失敗 = 空文字列プロトコル（欠陥 #8: センチネル文字列の全廃）
# ------------------------------------------------------------
@pytest.mark.asyncio
async def test_transcribe_error_returns_empty(monkeypatch):
    """ASR 例外時はセンチネル文字列ではなく空文字列を返す（欠陥 #8）。"""
    from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider

    provider = GPT4oTranscribeProvider.__new__(GPT4oTranscribeProvider)
    provider._client = None

    async def boom():
        raise RuntimeError("api down")

    monkeypatch.setattr(provider, "_get_client", boom)
    text = await provider.transcribe_audio(b"\x00" * 9000, "ja")
    assert text == ""


@pytest.mark.asyncio
async def test_translate_audio_error_returns_empty_result(monkeypatch):
    """translate_audio 例外時は両テキスト空の結果を返す（TTS 読み上げ禁止）。"""
    from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider

    provider = GPT4oTranscribeProvider.__new__(GPT4oTranscribeProvider)
    provider._client = None

    async def boom():
        raise RuntimeError("api down")

    monkeypatch.setattr(provider, "_get_client", boom)
    result = await provider.translate_audio(b"\x00" * 9000, "ja", "en")
    assert result.original_text == ""
    assert result.translated_text == ""
    assert result.audio_data is None


@pytest.mark.asyncio
async def test_process_audio_no_cache():
    """同一音声でも毎回プロバイダーを呼ぶ（音声ハッシュキャッシュ廃止、欠陥 #4）。"""
    from app.ai_pipeline.pipeline import AIPipeline
    from app.ai_pipeline.providers.base import TranslationResult

    class FakeProvider:
        def __init__(self) -> None:
            self.calls = 0

        async def translate_audio(self, _audio: bytes, src: str, tgt: str):
            self.calls += 1
            return TranslationResult(src, tgt, "こんにちは", "hello", b"WAVDATA")

        async def transcribe_audio(self, _audio: bytes, _lang: str):
            return "こんにちは"

    pipeline = AIPipeline.__new__(AIPipeline)
    from app.ai_pipeline.qos import QoSController

    pipeline._qos = QoSController()
    fake = FakeProvider()
    pipeline._provider = fake

    r1 = await pipeline.process_audio(b"\x01" * 100, "ja", "en")
    r2 = await pipeline.process_audio(b"\x01" * 100, "ja", "en")
    assert fake.calls == 2  # キャッシュで 2 回目が飛ばされない
    assert r1.audio_data == b"WAVDATA"
    assert r2.audio_data == b"WAVDATA"  # 音声がキャッシュヒットで消えない


# ------------------------------------------------------------
# S2S タイムアウトの例外化（欠陥 #4: フォールバック発動）
# ------------------------------------------------------------
class _FakeWs:
    """スクリプト化されたイベントを返す WebSocket スタブ。"""

    def __init__(self, events: list[dict], hang_after: bool = False) -> None:
        self._events = list(events)
        self._hang_after = hang_after

    async def recv(self) -> str:
        import asyncio
        import json

        if self._events:
            return json.dumps(self._events.pop(0))
        if self._hang_after:
            await asyncio.sleep(10)  # タイムアウトさせる
        raise AssertionError("イベント枯渇")


def _realtime_provider():
    from app.ai_pipeline.providers.gpt_realtime import GPTRealtimeProvider

    provider = GPTRealtimeProvider.__new__(GPTRealtimeProvider)
    provider._client = None
    return provider


@pytest.mark.asyncio
async def test_collect_response_timeout_raises():
    """応答ゼロのタイムアウトは TimeoutError（フォールバック発動条件、欠陥 #4）。"""
    provider = _realtime_provider()
    ws = _FakeWs([], hang_after=True)
    with pytest.raises(TimeoutError):
        await provider._collect_response(ws, timeout=0.3)


@pytest.mark.asyncio
async def test_collect_response_happy_path():
    """delta を蓄積し response.done で完了する。"""
    import base64

    provider = _realtime_provider()
    ws = _FakeWs(
        [
            {"type": "response.audio.delta",
             "delta": base64.b64encode(b"\x01\x02").decode()},
            {"type": "response.audio_transcript.delta", "delta": "Hel"},
            {"type": "response.audio_transcript.delta", "delta": "lo"},
            {"type": "response.done"},
        ]
    )
    text, chunks = await provider._collect_response(ws, timeout=5.0)
    assert text == "Hello"
    assert chunks == [b"\x01\x02"]


def test_session_configs_disable_turn_detection():
    """手動 commit/response.create 運用のため server_vad を無効化する（欠陥 #5）。"""
    provider = _realtime_provider()

    asr_cfg = provider._build_transcribe_session_config("ja")
    assert asr_cfg["type"] == "session.update"
    assert asr_cfg["session"]["turn_detection"] is None
    assert asr_cfg["session"]["input_audio_transcription"]["language"] == "ja"

    s2s_cfg = provider._build_translate_session_config("ja", "en")
    assert s2s_cfg["type"] == "session.update"
    assert s2s_cfg["session"]["turn_detection"] is None
    assert "instructions" in s2s_cfg["session"]


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
