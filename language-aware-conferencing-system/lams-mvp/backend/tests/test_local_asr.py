"""
Lite ローカル ASR ステージ（faster-whisper）の単体テスト

方針:
    - GPU / faster_whisper 非導入環境で緑になること（遅延 import の検証込み）。
    - fake model / fake broker を注入し、実 import・実 GPU に依存せず契約を検証する。
    - fake model は faster-whisper の transcribe 返り値 (segments, info) を模す。
      segments は .text を持つ要素の反復子、info は .language を持つ。
"""

import pytest

# import 自体が faster_whisper 非導入でも成功すること（遅延 import の確認）。
import app.ai_pipeline.providers.local_asr as local_asr  # noqa: E402
from app.ai_pipeline.providers.local_asr import (  # noqa: E402
    FasterWhisperASRStage,
    available,
)
from app.ai_pipeline.vram_broker import VRAMBroker
from app.audio.pcm import wrap_wav16

_SAMPLE_RATE = 16000


# ----- faster-whisper transcribe 返り値の fake -----
class _Seg:
    """1 セグメント（.text を持つ）。"""

    def __init__(self, text: str) -> None:
        self.text = text


class _Info:
    """transcribe の info（.language を検出言語として使う）。"""

    def __init__(self, language: str) -> None:
        self.language = language


class FakeModel:
    """faster-whisper WhisperModel 互換の fake（transcribe を提供）。"""

    def __init__(self, texts: list[str], language: str) -> None:
        self._texts = texts
        self._language = language
        self.calls: list[dict] = []

    def transcribe(self, audio: object, language: str | None = None):
        self.calls.append({"language": language, "n": len(audio)})  # type: ignore[arg-type]
        return (iter([_Seg(t) for t in self._texts]), _Info(self._language))


class ExplodingModel:
    """transcribe が例外を投げる fake（例外→"" 縮退の検証用）。"""

    def transcribe(self, *args: object, **kwargs: object):  # noqa: ARG002
        raise RuntimeError("推論失敗（模擬）")


def _wav(samples: int = 1600) -> bytes:
    """16kHz モノ int16 の非空 WAV バイト列（内容は無音でよい）。"""
    return wrap_wav16(b"\x00\x01" * samples, _SAMPLE_RATE)


def _fresh_broker() -> VRAMBroker:
    """テスト分離のための独立ブローカー（予算十分）。"""
    return VRAMBroker(budget_mb=4000)


def test_module_import_without_faster_whisper() -> None:
    """モジュール import が faster_whisper 非導入でも成功する（遅延 import）。"""
    assert local_asr is not None


def test_available_returns_bool() -> None:
    """available() は bool を返す（この環境では False 想定）。"""
    result = available()
    assert isinstance(result, bool)
    assert result is False


@pytest.mark.asyncio
async def test_transcribe_audio_joins_segments() -> None:
    """注入 fake model でセグメント結合テキストを返す。"""
    model = FakeModel(["こんにち", "は世界"], language="ja")
    stage = FasterWhisperASRStage(model=model, broker=_fresh_broker())
    text = await stage.transcribe_audio(_wav(), "ja")
    assert text == "こんにちは世界"
    # 対応言語は強制指定される。
    assert model.calls[0]["language"] == "ja"


@pytest.mark.asyncio
async def test_transcribe_audio_unknown_language_auto() -> None:
    """未対応/multi 指定は language=None（自動検出）で呼ばれる。"""
    model = FakeModel(["hello"], language="en")
    stage = FasterWhisperASRStage(model=model, broker=_fresh_broker())
    text = await stage.transcribe_audio(_wav(), "multi")
    assert text == "hello"
    assert model.calls[0]["language"] is None


@pytest.mark.asyncio
async def test_transcribe_with_detection_returns_detected_language() -> None:
    """検出言語（info.language）を返す。"""
    model = FakeModel(["xin chao"], language="vi")
    stage = FasterWhisperASRStage(model=model, broker=_fresh_broker())
    text, lang = await stage.transcribe_with_detection(_wav(), hint_language="en")
    assert text == "xin chao"
    assert lang == "vi"
    # detection は auto 検出優先のため language 指定なしで呼ぶ。
    assert model.calls[0]["language"] is None


@pytest.mark.asyncio
async def test_detection_falls_back_to_hint_when_undetected() -> None:
    """検出言語が空なら hint を採用する。"""
    model = FakeModel(["text"], language="")
    stage = FasterWhisperASRStage(model=model, broker=_fresh_broker())
    _, lang = await stage.transcribe_with_detection(_wav(), hint_language="ja")
    assert lang == "ja"


@pytest.mark.asyncio
async def test_empty_wav_returns_empty_string() -> None:
    """空音声（data 無し WAV）は "" を返す。"""
    empty = wrap_wav16(b"", _SAMPLE_RATE)
    stage = FasterWhisperASRStage(model=FakeModel(["x"], "ja"), broker=_fresh_broker())
    assert await stage.transcribe_audio(empty, "ja") == ""


@pytest.mark.asyncio
async def test_empty_wav_detection_returns_hint() -> None:
    """空音声の detection は ("", hint) を返す。"""
    empty = wrap_wav16(b"", _SAMPLE_RATE)
    stage = FasterWhisperASRStage(model=FakeModel(["x"], "ja"), broker=_fresh_broker())
    text, lang = await stage.transcribe_with_detection(empty, hint_language="zh")
    assert text == ""
    assert lang == "zh"


@pytest.mark.asyncio
async def test_empty_bytes_returns_empty_string() -> None:
    """空バイト列も "" を返す（不正入力の縮退）。"""
    stage = FasterWhisperASRStage(model=FakeModel(["x"], "ja"), broker=_fresh_broker())
    assert await stage.transcribe_audio(b"", "ja") == ""


@pytest.mark.asyncio
async def test_inference_exception_returns_empty_string() -> None:
    """推論例外は握り潰して "" を返す（雲へ縮退可能に）。"""
    stage = FasterWhisperASRStage(model=ExplodingModel(), broker=_fresh_broker())
    assert await stage.transcribe_audio(_wav(), "ja") == ""


@pytest.mark.asyncio
async def test_default_broker_use_context_with_injected_model() -> None:
    """broker 未注入（既定 broker）でも use コンテキストが動く。

    注入 model があるため loader は実 import せず注入実体を返す。faster_whisper
    非導入環境で正しいテキストが返る事実が、実 import 未発生の証左になる。
    """
    model = FakeModel(["ok"], language="en")
    stage = FasterWhisperASRStage(model=model)  # broker=None → 既定 broker
    assert await stage.transcribe_audio(_wav(), "en") == "ok"
    assert available() is False  # 実 import 経路は使われていない


def test_load_model_returns_injected_without_import() -> None:
    """注入 model があれば _load_model は実 import せず注入実体を返す。"""
    model = FakeModel(["x"], "ja")
    stage = FasterWhisperASRStage(model=model)
    assert stage._load_model() is model
