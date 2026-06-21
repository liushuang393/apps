"""
SegmentProcessor（Phase 3 C1-5）の単体テスト。

言語検出・orchestrator・save_subtitle をフェイク/monkeypatch で差し替え、rtc 非依存で
「WAV 化 → 検出 → 採番/重複排除 → 2 主線駆動 → 永続化」の各分岐を検証する。
"""

import pytest

from app.ai_pipeline.orchestrator import OrchestrationResult
from app.rooms.manager import ParticipantPreference
from app.webrtc import processor as processor_mod
from app.webrtc.persistence import MeetingConfig, SubtitleSequencer
from app.webrtc.processor import SegmentProcessor

# 16kHz・約 0.3 秒分のダミー PCM（中身は検証に無関係なので無音で良い）。
_PCM = b"\x10\x00" * 4800


class _RecordingOrchestrator:
    """orchestrate 呼び出しの kwargs を記録し、固定の翻訳結果を返すフェイク。"""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def orchestrate(self, **kwargs) -> OrchestrationResult:
        self.calls.append(kwargs)
        return OrchestrationResult(translations={kwargs["source_language"]: "x"})


def _participants() -> dict[str, ParticipantPreference]:
    """話者 1 名＋翻訳音声受聴者 1 名の最小構成。"""
    return {
        "spk": ParticipantPreference(
            user_id="spk", display_name="S", native_language="ja"
        ),
        "lis": ParticipantPreference(
            user_id="lis",
            display_name="L",
            native_language="en",
            audio_mode="translated",
        ),
    }


def _make(detect, monkeypatch) -> tuple[SegmentProcessor, _RecordingOrchestrator, list]:
    """検出関数を注入し save_subtitle を捕捉する Processor を組み立てる。"""
    saved: list[dict] = []

    async def fake_save(**kwargs) -> None:
        saved.append(kwargs)

    monkeypatch.setattr(processor_mod, "save_subtitle", fake_save)
    orch = _RecordingOrchestrator()
    proc = SegmentProcessor(
        orchestrator=orch, sequencer=SubtitleSequencer(), detect_fn=detect
    )
    return proc, orch, saved


def _sink_factory(captured: list):
    """user_language を記録するだけの sink_factory を返す。"""

    def factory(user_language: dict[str, str]) -> object:
        captured.append(user_language)
        return object()

    return factory


@pytest.mark.asyncio
async def test_empty_pcm_returns_none(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("text", "ja")

    proc, orch, saved = _make(detect, monkeypatch)
    result = await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=b"",
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert result is None
    assert orch.calls == [] and saved == []


@pytest.mark.asyncio
async def test_empty_recognition_returns_none(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("", "ja")

    proc, orch, saved = _make(detect, monkeypatch)
    result = await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert result is None and orch.calls == []


@pytest.mark.asyncio
async def test_happy_path_drives_orchestrator_and_persists(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("こんにちは", "ja")

    captured: list = []
    proc, orch, saved = _make(detect, monkeypatch)
    result = await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="ja",
        participants=_participants(),
        sink_factory=_sink_factory(captured),
        config=MeetingConfig(mode="hybrid"),
    )
    assert result is not None
    call = orch.calls[0]
    assert call["source_language"] == "ja" and call["original_text"] == "こんにちは"
    assert call["mode"] == "hybrid" and call["seq"] == 1 and call["speaker_id"] == "spk"
    assert captured[0]["lis"] == "en"  # 受聴者の目標言語が sink へ渡る
    assert saved[0]["original_language"] == "ja"


@pytest.mark.asyncio
async def test_duplicate_text_skips_second(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("同じ", "ja")

    proc, orch, _saved = _make(detect, monkeypatch)
    kwargs = {
        "room_id": "r",
        "speaker_id": "spk",
        "pcm16": _PCM,
        "speaker_lang_hint": "ja",
        "participants": _participants(),
        "sink_factory": _sink_factory([]),
        "config": MeetingConfig(),
    }
    assert await proc.process(**kwargs) is not None
    assert await proc.process(**kwargs) is None
    assert len(orch.calls) == 1


@pytest.mark.asyncio
async def test_multi_detection_falls_back_to_hint(monkeypatch) -> None:
    async def detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return ("hello", "multi")

    proc, orch, _saved = _make(detect, monkeypatch)
    await proc.process(
        room_id="r",
        speaker_id="spk",
        pcm16=_PCM,
        speaker_lang_hint="en",
        participants=_participants(),
        sink_factory=_sink_factory([]),
        config=MeetingConfig(),
    )
    assert orch.calls[0]["source_language"] == "en"
