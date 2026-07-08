"""
ステージ実装（OpenAI MT/TTS）とスロット解決ロジックの単体テスト

対象: app.ai_pipeline.providers.stages / app.ai_pipeline.registry
方針:
    - API キー非依存。OpenAI SDK 互換のダミークライアントを注入して検証する。
    - スロット既定名マッピングと composite 有効判定を純粋関数として検証する。
"""

import asyncio

from app.ai_pipeline.providers.base import dynamic_max_tokens
from app.ai_pipeline.providers.stages import OpenAIMTStage, OpenAITTSStage
from app.ai_pipeline.registry import composite_enabled, default_slot_names
from app.config import settings


# ----- OpenAI Chat 互換ダミー（MT 用） -----
class _Msg:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Msg(content)


class _ChatResp:
    def __init__(self, content: str) -> None:
        self.choices = [_Choice(content)]


class _Completions:
    def __init__(self, content: str) -> None:
        self._content = content
        self.calls: list[dict] = []

    async def create(self, **kwargs: object) -> _ChatResp:
        self.calls.append(kwargs)
        return _ChatResp(self._content)


class _Chat:
    def __init__(self, content: str) -> None:
        self.completions = _Completions(content)


# ----- OpenAI Speech 互換ダミー（TTS 用） -----
class _SpeechResp:
    content = b"WAVDATA"


class _Speech:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def create(self, **kwargs: object) -> _SpeechResp:
        self.calls.append(kwargs)
        return _SpeechResp()


class _AudioNS:
    def __init__(self) -> None:
        self.speech = _Speech()


class _FakeOpenAIClient:
    """chat.completions / audio.speech を備えた AsyncOpenAI 互換ダミー"""

    def __init__(self, chat_content: str = "訳文") -> None:
        self.chat = _Chat(chat_content)
        self.audio = _AudioNS()


# ============================================================
# OpenAIMTStage
# ============================================================
def test_openai_mt_translate_returns_text() -> None:
    client = _FakeOpenAIClient(chat_content="你好")
    stage = OpenAIMTStage(client=client, model="m")
    out = asyncio.run(stage.translate_text("こんにちは", "ja", "zh"))
    assert out == "你好"
    assert client.chat.completions.calls  # API 呼び出しあり


def test_openai_mt_empty_input_skips_api() -> None:
    client = _FakeOpenAIClient(chat_content="無視")
    stage = OpenAIMTStage(client=client, model="m")
    out = asyncio.run(stage.translate_text("   ", "ja", "zh"))
    assert out == ""
    assert client.chat.completions.calls == []


# ============================================================
# 動的 max_tokens（改善点 Q3）
# ============================================================
def test_dynamic_max_tokens_floor_and_ceil() -> None:
    """短文は下限、長文は上限で飽和し、中間は入力長に比例する。"""
    assert dynamic_max_tokens("") == 256  # 下限
    assert dynamic_max_tokens("あ" * 5) == 256  # 短文 → 下限
    assert dynamic_max_tokens("あ" * 2000) == 4000  # 長文 → 上限
    mid = dynamic_max_tokens("あ" * 200)  # 200*4=800（下限と上限の間）
    assert mid == 800


def test_openai_mt_uses_dynamic_max_tokens() -> None:
    """長文翻訳では max_tokens が固定 500 でなく動的値で呼ばれる（切れ防止）。"""
    client = _FakeOpenAIClient(chat_content="訳文")
    stage = OpenAIMTStage(client=client, model="m")
    long_text = "これは非常に長い複文の発話です。" * 30
    asyncio.run(stage.translate_text(long_text, "ja", "en"))
    sent = client.chat.completions.calls[0]["max_tokens"]
    assert sent == dynamic_max_tokens(long_text)
    assert sent > 500  # 固定 500 を超えている


# ============================================================
# OpenAITTSStage
# ============================================================
def test_openai_tts_synthesize_returns_audio() -> None:
    client = _FakeOpenAIClient()
    stage = OpenAITTSStage(client=client, model="tts", voice="alloy")
    audio = asyncio.run(stage.synthesize("hello", "en"))
    assert audio == b"WAVDATA"
    assert client.audio.speech.calls


def test_openai_tts_empty_input_returns_none() -> None:
    client = _FakeOpenAIClient()
    stage = OpenAITTSStage(client=client, model="tts", voice="alloy")
    assert asyncio.run(stage.synthesize("", "en")) is None
    assert client.audio.speech.calls == []


# ============================================================
# スロット解決ロジック（純粋関数）
# ============================================================
def test_default_slot_names_for_google_preset() -> None:
    names = default_slot_names("google")
    assert names["asr"] == "google"
    assert names["mt"] == "google"
    assert names["tts"] == "none"  # Mode B は字幕主役、TTS なし


def test_default_slot_names_for_gpt4o_preset() -> None:
    names = default_slot_names("gpt4o_transcribe")
    assert names["asr"] == "gpt4o"
    assert names["mt"] == "openai"
    assert names["tts"] == "openai"


def test_composite_enabled_false_when_all_auto(monkeypatch) -> None:
    monkeypatch.setattr(settings, "asr_provider", "auto")
    monkeypatch.setattr(settings, "mt_provider", "auto")
    monkeypatch.setattr(settings, "tts_provider", "auto")
    assert composite_enabled() is False


def test_composite_enabled_true_when_any_slot_set(monkeypatch) -> None:
    monkeypatch.setattr(settings, "asr_provider", "auto")
    monkeypatch.setattr(settings, "mt_provider", "google")
    monkeypatch.setattr(settings, "tts_provider", "auto")
    assert composite_enabled() is True
