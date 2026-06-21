"""
LiveKitOutputSink（app.webrtc.sink）の単体テスト。

方針: 実 rtc.Room 非依存。音声 capture と data 送信はフェイクのコールバックで
記録し、リサンプル/フレーム分割・言語単位の重複排除・data トピックを検証する。
末尾では実 HybridOrchestrator を本 sink で駆動し、プロトコル整合も確認する。
"""

import json

import numpy as np
import pytest

from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener
from app.webrtc.sink import (
    OUTPUT_FRAME_SAMPLES,
    TOPIC_EVENT,
    TOPIC_SUBTITLE,
    LiveKitOutputSink,
)


class _Recorder:
    """capture_audio / send_data の記録用フェイク。"""

    def __init__(self) -> None:
        self.audio: list[tuple[str, int]] = []
        self.data: list[tuple[bytes, list[str], str]] = []

    async def capture_audio(self, lang: str, frame: bytes) -> None:
        self.audio.append((lang, len(frame)))

    async def send_data(self, payload: bytes, ids: list[str], topic: str) -> None:
        self.data.append((payload, ids, topic))


def _pcm(n: int) -> bytes:
    """n 標本のモノ int16 PCM（無音）を作る。"""
    return np.zeros(n, dtype=np.int16).tobytes()


def _sink(rec: _Recorder, **kw: object) -> LiveKitOutputSink:
    return LiveKitOutputSink(
        user_language={"u1": "en", "u2": "en", "u3": "ja"},
        capture_audio=rec.capture_audio,
        send_data=rec.send_data,
        **kw,
    )


@pytest.mark.asyncio
async def test_deliver_audio_resamples_and_frames() -> None:
    """24k 100ms 入力は 48k 10ms フレーム×10 として capture される。"""
    rec = _Recorder()
    sink = _sink(rec)
    await sink.deliver_audio("u1", _pcm(2400))  # 100ms @ 24k
    assert len(rec.audio) == 10
    assert all(lang == "en" for lang, _ in rec.audio)
    assert all(size == OUTPUT_FRAME_SAMPLES * 2 for _, size in rec.audio)


@pytest.mark.asyncio
async def test_deliver_audio_dedups_same_payload_per_language() -> None:
    """同一オブジェクトを同一言語へ再配信しても capture は 1 回だけ。"""
    rec = _Recorder()
    sink = _sink(rec)
    payload = _pcm(480 * 2)  # 48k 2フレーム相当の元データ（24k→48kで4フレーム）
    await sink.deliver_audio("u1", payload)
    first = len(rec.audio)
    await sink.deliver_audio("u2", payload)  # 同一 payload・同一言語 → skip
    assert len(rec.audio) == first


@pytest.mark.asyncio
async def test_deliver_audio_ignores_unknown_user_and_empty() -> None:
    """未知 user / 空音声は無視。"""
    rec = _Recorder()
    sink = _sink(rec)
    await sink.deliver_audio("ghost", _pcm(2400))
    await sink.deliver_audio("u1", b"")
    assert rec.audio == []


@pytest.mark.asyncio
async def test_deliver_subtitle_and_event_topics() -> None:
    """字幕/イベントは受信者 identity 宛て・正しいトピックで JSON 配信。"""
    rec = _Recorder()
    sink = _sink(rec)
    await sink.deliver_subtitle("u1", {"type": "subtitle", "text": "こんにちは"})
    await sink.deliver_event("u3", {"type": "qos_warning", "metric": "latency_p95"})
    sub_payload, sub_ids, sub_topic = rec.data[0]
    assert sub_ids == ["u1"] and sub_topic == TOPIC_SUBTITLE
    assert json.loads(sub_payload)["text"] == "こんにちは"
    _, ev_ids, ev_topic = rec.data[1]
    assert ev_ids == ["u3"] and ev_topic == TOPIC_EVENT


@pytest.mark.asyncio
async def test_send_data_failure_is_swallowed() -> None:
    """data 送信例外は伝播させない（配信失敗で収束を止めない）。"""

    async def boom(_p: bytes, _ids: list[str], _t: str) -> None:
        raise RuntimeError("channel closed")

    sink = LiveKitOutputSink(
        user_language={"u1": "en"},
        capture_audio=_Recorder().capture_audio,
        send_data=boom,
    )
    await sink.deliver_subtitle("u1", {"text": "x"})  # 例外にならなければ合格


@pytest.mark.asyncio
async def test_orchestrator_drives_livekit_sink() -> None:
    """実 HybridOrchestrator を本 sink で駆動し音声 track と字幕 data を確認。"""
    rec = _Recorder()
    sink = _sink(rec)

    async def hearing(_a: bytes, _s: str, _t: str, _spk: str) -> object:
        from dataclasses import make_dataclass

        proc = make_dataclass("P", ["audio_data", "translated_text"])
        return proc(audio_data=_pcm(2400), translated_text="H:en")

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
    assert len(rec.audio) == 10  # 翻訳音声が 48k フレームで capture
    assert any(topic == TOPIC_SUBTITLE for _, _, topic in rec.data)
