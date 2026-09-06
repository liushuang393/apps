"""
LiveKitOutputSink（app.webrtc.sink）の単体テスト。

方針: 実 rtc.Room 非依存。音声 capture と data 送信はフェイクのコールバックで
記録し、リサンプル・(話者, 言語) 単位の重複排除・data トピックを検証する
（フレーム分割は publisher 側の責務のため sink では検証しない）。
末尾では実 HybridOrchestrator を本 sink で駆動し、プロトコル整合も確認する。
公開契約は TransportAdapter（publish_audio / send_data）のみ。
"""

import json

import numpy as np
import pytest

from app.ai_pipeline.orchestrator import HearingOutput, HybridOrchestrator, Listener
from app.webrtc.sink import (
    OUTPUT_FRAME_SAMPLES,
    TOPIC_EVENT,
    TOPIC_SUBTITLE,
    LiveKitOutputSink,
)


class _Recorder:
    """capture_audio / send_data の記録用フェイク。"""

    def __init__(self) -> None:
        self.audio: list[tuple[str, str, int]] = []
        self.data: list[tuple[bytes, list[str], str]] = []

    async def capture_audio(
        self,
        speaker_id: str,
        lang: str,
        frame: bytes,
        *,
        generation_id: int | None = None,
    ) -> None:
        del generation_id
        self.audio.append((speaker_id, lang, len(frame)))

    async def send_data(self, payload: bytes, ids: list[str], topic: str) -> None:
        self.data.append((payload, ids, topic))


def _pcm(n: int) -> bytes:
    """n 標本のモノ int16 PCM（無音）を作る。"""
    return np.zeros(n, dtype=np.int16).tobytes()


def _sink(rec: _Recorder, **kw: object) -> LiveKitOutputSink:
    kw.setdefault("speaker_id", "sp")
    return LiveKitOutputSink(
        user_language={"u1": "en", "u2": "en", "u3": "ja"},
        capture_audio=rec.capture_audio,
        send_data=rec.send_data,
        **kw,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_publish_audio_resamples() -> None:
    """24k 100ms 入力は 48k pcm48 として 1 回で capture される（分割は publisher 側）。"""
    rec = _Recorder()
    sink = _sink(rec)
    await sink.publish_audio(
        speaker_id="sp",
        language="en",
        audio=_pcm(2400),
        recipient_ids=["u1"],
        generation_id=None,
    )
    assert len(rec.audio) == 1
    speaker_id, lang, size = rec.audio[0]
    assert speaker_id == "sp" and lang == "en"
    assert size == OUTPUT_FRAME_SAMPLES * 10 * 2  # 100ms@48kHz = 4800標本=9600バイト


@pytest.mark.asyncio
async def test_publish_audio_dedups_same_payload_per_language() -> None:
    """同一オブジェクトを同一言語へ再配信しても capture は 1 回だけ。"""
    rec = _Recorder()
    sink = _sink(rec)
    payload = _pcm(480 * 2)
    await sink.publish_audio(
        speaker_id="sp",
        language="en",
        audio=payload,
        recipient_ids=["u1"],
        generation_id=None,
    )
    first = len(rec.audio)
    await sink.publish_audio(
        speaker_id="sp",
        language="en",
        audio=payload,
        recipient_ids=["u2"],
        generation_id=None,
    )
    assert len(rec.audio) == first


@pytest.mark.asyncio
async def test_publish_audio_ignores_empty_recipients_and_audio() -> None:
    """空受信者 / 空音声は無視。"""
    rec = _Recorder()
    sink = _sink(rec)
    await sink.publish_audio(
        speaker_id="sp",
        language="en",
        audio=_pcm(2400),
        recipient_ids=[],
        generation_id=None,
    )
    await sink.publish_audio(
        speaker_id="sp",
        language="en",
        audio=b"",
        recipient_ids=["u1"],
        generation_id=None,
    )
    assert rec.audio == []


@pytest.mark.asyncio
async def test_send_data_topics() -> None:
    """字幕/イベントは受信者 identity 宛て・正しいトピックで配信。"""
    rec = _Recorder()
    sink = _sink(rec)
    await sink.send_data(
        user_id="u1",
        topic=TOPIC_SUBTITLE,
        payload=json.dumps({"type": "subtitle", "text": "こんにちは"}).encode("utf-8"),
    )
    await sink.send_data(
        user_id="u3",
        topic=TOPIC_EVENT,
        payload=json.dumps({"type": "qos_warning", "metric": "latency_p95"}).encode(
            "utf-8"
        ),
    )
    sub_payload, sub_ids, sub_topic = rec.data[0]
    assert sub_ids == ["u1"] and sub_topic == TOPIC_SUBTITLE
    assert json.loads(sub_payload)["text"] == "こんにちは"
    _, ev_ids, ev_topic = rec.data[1]
    assert ev_ids == ["u3"] and ev_topic == TOPIC_EVENT


@pytest.mark.asyncio
async def test_send_data_failure_propagates() -> None:
    """data 送信例外は伝播する（隔離は Output Manager 側）。"""

    async def boom(_p: bytes, _ids: list[str], _t: str) -> None:
        raise RuntimeError("channel closed")

    sink = LiveKitOutputSink(
        user_language={"u1": "en"},
        capture_audio=_Recorder().capture_audio,
        send_data=boom,
        speaker_id="sp",
    )
    with pytest.raises(RuntimeError, match="channel closed"):
        await sink.send_data(
            user_id="u1",
            topic=TOPIC_SUBTITLE,
            payload=b'{"text":"x"}',
        )


@pytest.mark.asyncio
async def test_orchestrator_drives_livekit_sink() -> None:
    """実 HybridOrchestrator を本 sink で駆動し音声 track と字幕 data を確認。"""
    rec = _Recorder()
    sink = _sink(rec)

    async def hearing(
        _a: bytes, _s: str, _t: str, _spk: str, _original_text: str | None
    ) -> HearingOutput:
        return HearingOutput(audio_data=_pcm(2400), translated_text="H:en")

    async def reading(_text: str, _src: str, tgt: str) -> str:
        return f"R:{tgt}"

    orch = HybridOrchestrator(hearing_fn=hearing, reading_fn=reading)
    listener = Listener("u1", "en", wants_audio=True, subtitle_enabled=True)
    await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[listener],
        sink=sink,
        mode="hybrid",
        speaker_id="spk",
    )
    assert len(rec.audio) == 1  # 翻訳音声が 48k pcm として 1 回で capture
    assert rec.audio[0][2] == OUTPUT_FRAME_SAMPLES * 10 * 2
    assert any(topic == TOPIC_SUBTITLE for _, _, topic in rec.data)


@pytest.mark.asyncio
async def test_publish_audio_strips_wav_header() -> None:
    """WAV ヘッダ付き音声はヘッダを除去し実レートで 48kHz 化する。"""
    from app.audio.pcm import wrap_wav16

    captured: list[tuple[str, bytes]] = []

    async def capture(
        _speaker_id: str,
        lang: str,
        frame: bytes,
        *,
        generation_id: int | None = None,
    ) -> None:
        del generation_id
        captured.append((lang, frame))

    async def send(payload: bytes, ids: list[str], topic: str) -> None:
        del payload, ids, topic

    sink = LiveKitOutputSink(
        user_language={"u1": "en"},
        capture_audio=capture,
        send_data=send,
        speaker_id="sp",
    )
    pcm24k = b"\x01\x00" * 2400  # 24kHz で 100ms
    await sink.publish_audio(
        speaker_id="sp",
        language="en",
        audio=wrap_wav16(pcm24k, 24000),
        recipient_ids=["u1"],
        generation_id=None,
    )
    total = sum(len(f) for _, f in captured)
    # 100ms @48kHz int16 = 4800 標本 = 9600 バイト（フレーム 480 標本単位）
    assert total == (4800 // OUTPUT_FRAME_SAMPLES) * OUTPUT_FRAME_SAMPLES * 2


@pytest.mark.asyncio
async def test_publish_audio_passes_speaker_and_language() -> None:
    """翻訳音声は (話者, 言語) 単位で capture される（欠陥 #3/#6）。"""
    from app.audio.pcm import wrap_wav16

    captured: list[tuple[str, str]] = []

    async def capture(
        speaker_id: str,
        lang: str,
        _pcm48: bytes,
        *,
        generation_id: int | None = None,
    ) -> None:
        del generation_id
        captured.append((speaker_id, lang))

    async def send(payload: bytes, ids: list[str], topic: str) -> None:
        del payload, ids, topic

    sink = LiveKitOutputSink(
        user_language={"u1": "en"},
        capture_audio=capture,
        send_data=send,
        speaker_id="alice",
    )
    await sink.publish_audio(
        speaker_id="alice",
        language="en",
        audio=wrap_wav16(b"\x01\x00" * 480, 24000),
        recipient_ids=["u1"],
        generation_id=None,
    )
    assert captured == [("alice", "en")]
