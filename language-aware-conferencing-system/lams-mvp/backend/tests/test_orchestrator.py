"""
HybridOrchestrator（Phase 3 ハイブリッド 2 主線同時オーケストレーション）の単体テスト。

聞く主線（S2S）/読む主線（ASR+MT）を注入したフェイクで差し替え、I/O 非依存で
「フォーク→2 主線同時投入→Output Manager 収束（混ぜない）」の各分岐を検証する。
配信観測は RecordingTransportAdapter（TransportAdapter）のみ。
"""

from __future__ import annotations

import time
from collections.abc import Sequence

import pytest

from app.ai_pipeline.orchestrator import HearingOutput, HybridOrchestrator, Listener
from app.ai_pipeline.output_manager import (
    TOPIC_EVENT,
    TOPIC_SUBTITLE,
    DefaultOutputManager,
    FinalSubtitleCommand,
    ListenerRef,
    RecordingTransportAdapter,
)
from app.ai_pipeline.qos import READING_P95_TARGET_MS, HybridQoSMonitor

_FakeProcessed = HearingOutput


class _FakeSink(RecordingTransportAdapter):
    """TransportAdapter 観測用。旧 deliver_* フェイク相当の便利ビューを提供する。"""

    @property
    def audio_by_user(self) -> list[tuple[str, bytes]]:
        """受信者単位に展開した翻訳音声一覧。"""
        out: list[tuple[str, bytes]] = []
        for _spk, _lang, audio, recipients, _gen in self.audio:
            for uid in recipients:
                out.append((uid, audio))
        return out

    @property
    def subtitles(self) -> list[tuple[str, dict]]:
        """確定/partial 字幕イベント。"""
        return [
            (uid, ev)
            for uid, topic, ev in self.data
            if topic == TOPIC_SUBTITLE and ev.get("type") == "subtitle"
        ]

    @property
    def interim(self) -> list[tuple[str, dict]]:
        """暫定字幕イベント。"""
        return [
            (uid, ev)
            for uid, topic, ev in self.data
            if topic == TOPIC_SUBTITLE and ev.get("type") == "subtitle_interim"
        ]

    @property
    def events(self) -> list[tuple[str, dict]]:
        """QoS / QoE 等のイベント。"""
        return [(uid, ev) for uid, topic, ev in self.data if topic == TOPIC_EVENT]


def _make_orchestrator() -> tuple[HybridOrchestrator, dict]:
    """聞く/読む主線を記録するフェイクで差し替えたオーケストレーターを作る。"""
    calls: dict[str, int] = {"hearing": 0, "reading": 0}

    async def hearing(
        _audio: bytes, _src: str, tgt: str, _speaker: str, _original_text: str | None
    ) -> _FakeProcessed:
        calls["hearing"] += 1
        return _FakeProcessed(audio_data=b"AUDIO", translated_text=f"H:{tgt}")

    async def reading(_text: str, _src: str, tgt: str) -> str:
        calls["reading"] += 1
        return f"R:{tgt}"

    return HybridOrchestrator(hearing_fn=hearing, reading_fn=reading), calls


@pytest.mark.asyncio
async def test_hybrid_forks_both_mainlines_and_converges() -> None:
    """hybrid: 同一受信者が翻訳音声(聞く)と字幕(読む)を独立主線から受け取る。"""
    orch, calls = _make_orchestrator()
    sink = _FakeSink()
    listener = Listener("u1", "en", wants_audio=True, subtitle_enabled=True)

    res = await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="こんにちは",
        listeners=[listener],
        sink=sink,
        mode="hybrid",
        speaker_id="spk",
    )

    assert calls == {"hearing": 1, "reading": 1}
    assert sink.audio_by_user == [("u1", b"AUDIO")]
    assert len(sink.subtitles) == 1
    _, msg = sink.subtitles[0]
    assert msg["original_text"] == "こんにちは"
    assert msg["translated_text"] == "R:en"
    assert msg["mainline"] == "reading"
    assert msg["provider"] == "asr_mt"
    assert res.translations == {"en": "R:en"}


@pytest.mark.asyncio
async def test_mode_a_audio_only_subtitle_falls_back_to_hearing_delta() -> None:
    """mode A: 読む主線は走らず、字幕は聞く主線 delta で代替される。"""
    orch, calls = _make_orchestrator()
    sink = _FakeSink()
    listener = Listener("u1", "en", wants_audio=True, subtitle_enabled=True)

    await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[listener],
        sink=sink,
        mode="a",
        speaker_id="spk",
    )

    assert calls == {"hearing": 1, "reading": 0}
    assert sink.audio_by_user == [("u1", b"AUDIO")]
    _, msg = sink.subtitles[0]
    assert msg["original_text"] == "text"
    assert msg["translated_text"] == "H:en"
    assert msg["mainline"] == "hearing"


@pytest.mark.asyncio
async def test_mode_b_subtitle_only_no_audio() -> None:
    """mode B: 聞く主線は走らず、音声配信は発生しない。"""
    orch, calls = _make_orchestrator()
    sink = _FakeSink()
    listener = Listener("u1", "en", wants_audio=True, subtitle_enabled=True)

    await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[listener],
        sink=sink,
        mode="b",
        speaker_id="spk",
    )

    assert calls == {"hearing": 0, "reading": 1}
    assert sink.audio_by_user == []
    _, msg = sink.subtitles[0]
    assert msg["mainline"] == "reading"


@pytest.mark.asyncio
async def test_speaker_gets_subtitle_but_not_audio_echo() -> None:
    """話者自身は字幕のみ受信し、翻訳音声（エコー）は受信しない。"""
    orch, _ = _make_orchestrator()
    sink = _FakeSink()
    speaker = Listener("spk", "en", wants_audio=True, subtitle_enabled=True)

    await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[speaker],
        sink=sink,
        mode="hybrid",
        speaker_id="spk",
    )

    assert sink.audio_by_user == []
    assert len(sink.subtitles) == 1


@pytest.mark.asyncio
async def test_mode_a_emits_revisioned_interim_before_final() -> None:
    """Mode A の hearing text を interim 契約で配信し、final へ収束する。"""
    orch, _ = _make_orchestrator()
    sink = _FakeSink()

    await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=sink,
        mode="a",
        room_id="room-1",
        subtitle_id="utt-1",
        seq=1,
        speaker_id="spk",
    )

    assert sink.interim[0][1]["type"] == "subtitle_interim"
    assert sink.interim[0][1]["revision"] == 1
    assert sink.subtitles[0][1]["schema_version"] == 1


def test_interim_revision_increases_for_same_utterance() -> None:
    """同一発話・言語の暫定字幕 revision は単調増加する。"""
    from app.ai_pipeline.revision_authority import RevisionAuthority

    orch, _ = _make_orchestrator()
    # 注入権威で隔離（プロセス共有権威の残留 finalize を避ける）
    orch._revision_authority = RevisionAuthority()  # noqa: SLF001
    common = {
        "subtitle_id": "utt-1",
        "target_language": "en",
        "seq": 1,
        "room_id": "room-1",
        "speaker_id": "spk",
        "generation_id": 0,
    }
    first = orch._interim_message(text="hel", **common)
    second = orch._interim_message(text="hello", **common)
    assert first["revision"] == 1
    assert second["revision"] == 2
    assert second["revision"] > first["revision"]


@pytest.mark.asyncio
async def test_runtime_fallback_hearing_failure_to_reading() -> None:
    """§10: mode A で聞く主線が失敗すると、字幕のため読む主線へ縮退する。"""
    calls: dict[str, int] = {"hearing": 0, "reading": 0}

    async def hearing(
        _a: bytes, _s: str, _t: str, _spk: str, _original_text: str | None
    ) -> HearingOutput:
        calls["hearing"] += 1
        raise RuntimeError("s2s down")

    async def reading(_text: str, _src: str, tgt: str) -> str:
        calls["reading"] += 1
        return f"R:{tgt}"

    orch = HybridOrchestrator(hearing_fn=hearing, reading_fn=reading)
    sink = _FakeSink()
    listener = Listener("u1", "en", wants_audio=True, subtitle_enabled=True)

    res = await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[listener],
        sink=sink,
        mode="a",
        speaker_id="spk",
    )

    assert calls == {"hearing": 1, "reading": 1}
    assert sink.audio_by_user == []
    _, msg = sink.subtitles[0]
    assert msg["original_text"] == "text"
    assert msg["translated_text"] == "R:en"
    assert msg["mainline"] == "reading"
    assert res.tags[0]["reason"] == "hearing_failed_runtime_fallback_reading"


@pytest.mark.asyncio
async def test_hearing_empty_string_triggers_reading_fallback() -> None:
    """欠陥 #8: hearing が空文字列を返せば hearing_failed 縮退が発動する。"""
    calls: dict[str, int] = {"hearing": 0, "reading": 0}

    async def hearing(
        _a: bytes, _s: str, _t: str, _spk: str, _original_text: str | None
    ) -> HearingOutput:
        calls["hearing"] += 1
        return _FakeProcessed(audio_data=None, translated_text="")

    async def reading(_text: str, _src: str, tgt: str) -> str:
        calls["reading"] += 1
        return f"R:{tgt}"

    orch = HybridOrchestrator(hearing_fn=hearing, reading_fn=reading)
    sink = _FakeSink()
    listener = Listener("u1", "en", wants_audio=True, subtitle_enabled=True)

    res = await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[listener],
        sink=sink,
        mode="a",
        speaker_id="spk",
    )

    assert calls == {"hearing": 1, "reading": 1}
    assert sink.audio_by_user == []
    _, msg = sink.subtitles[0]
    assert msg["translated_text"] == "R:en"
    assert msg["mainline"] == "reading"
    assert res.tags[0]["reason"] == "hearing_failed_runtime_fallback_reading"


@pytest.mark.asyncio
async def test_all_mainlines_fail_delivers_original_placeholder() -> None:
    """改善点 M4: 翻訳必要かつ全主線失敗でも原文プレースホルダを配信する。"""

    async def reading(_text: str, _src: str, _tgt: str) -> str:
        return ""

    orch = HybridOrchestrator(reading_fn=reading)
    sink = _FakeSink()
    listener = Listener("u1", "en", wants_audio=False, subtitle_enabled=True)

    res = await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="重要な数字は42です",
        listeners=[listener],
        sink=sink,
        mode="b",
        speaker_id="spk",
    )

    assert len(sink.subtitles) == 1
    _, msg = sink.subtitles[0]
    assert msg["original_text"] == "重要な数字は42です"
    assert msg["degraded"] is True
    assert msg["is_translated"] is False
    assert msg["translated_text"] is None
    assert msg["mainline"] == "degraded"
    assert res.translations == {}


@pytest.mark.asyncio
async def test_partial_success_does_not_emit_placeholder() -> None:
    """M4 は正常/部分成功時には発火しない（回帰防止）。"""

    async def reading(_text: str, _src: str, tgt: str) -> str:
        return f"R:{tgt}"

    orch = HybridOrchestrator(reading_fn=reading)
    sink = _FakeSink()
    listener = Listener("u1", "en", wants_audio=False, subtitle_enabled=True)

    await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[listener],
        sink=sink,
        mode="b",
        speaker_id="spk",
    )

    assert len(sink.subtitles) == 1
    _, msg = sink.subtitles[0]
    assert msg["degraded"] is False
    assert msg["translated_text"] == "R:en"


@pytest.mark.asyncio
async def test_qos_warnings_emitted_to_result_and_event_sink() -> None:
    """§9: 目標逸脱時に qos_warning が result と OM→TransportAdapter へ反映される。"""

    async def hearing_ok(
        _a: bytes, _s: str, _t: str, _spk: str, _original_text: str | None
    ) -> HearingOutput:
        return _FakeProcessed(audio_data=b"A", translated_text="H")

    async def reading(_text: str, _src: str, tgt: str) -> str:
        return f"R:{tgt}"

    monitor = HybridQoSMonitor()
    monitor.record_latency("reading", READING_P95_TARGET_MS + 1000.0)
    monitor.record_glossary(1, 10)  # 0.1 < 0.95
    orch = HybridOrchestrator(
        hearing_fn=hearing_ok, reading_fn=reading, monitor=monitor
    )
    sink = _FakeSink()
    listener = Listener("u1", "en", wants_audio=False, subtitle_enabled=True)

    res = await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[listener],
        sink=sink,
        mode="b",
        speaker_id="spk",
    )

    metrics = {w["metric"] for w in res.qos_warnings}
    assert metrics == {"latency_p95", "glossary_hit_rate"}
    assert {m["metric"] for _, m in sink.events} == {
        "latency_p95",
        "glossary_hit_rate",
    }
    assert all(uid == "u1" for uid, _ in sink.events)


@pytest.mark.asyncio
async def test_no_monitor_means_no_qos_warnings() -> None:
    """monitor 未注入なら QoS 計測・警告は一切発生しない（純動作）。"""
    orch, _ = _make_orchestrator()
    sink = _FakeSink()
    listener = Listener("u1", "en", wants_audio=True, subtitle_enabled=True)

    res = await orch.orchestrate(
        audio_bytes=b"x",
        source_language="ja",
        original_text="text",
        listeners=[listener],
        sink=sink,
        mode="hybrid",
        speaker_id="spk",
    )

    assert res.qos_warnings == []
    assert sink.events == []


@pytest.mark.asyncio
async def test_hearing_receives_original_text() -> None:
    """orchestrator は検出済み原文を hearing 主線へ引き渡す（欠陥 #1）。"""
    received: dict = {}

    async def hearing_fn(_audio, _src, _tgt, _speaker, original_text):
        received["text"] = original_text
        return HearingOutput(audio_data=b"wav", translated_text="hello")

    async def reading_fn(_text, _src, _tgt):
        return "hello"

    orch = HybridOrchestrator(hearing_fn=hearing_fn, reading_fn=reading_fn)
    await orch.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=_FakeSink(),
        mode="hybrid",
        speaker_id="sp",
    )
    assert received["text"] == "こんにちは"


@pytest.mark.asyncio
async def test_subtitle_not_blocked_by_slow_hearing() -> None:
    """字幕（読む主線）は聞く主線の完了を待たずに配信される（欠陥 #10）。"""
    import asyncio

    times: dict[str, float] = {}

    async def hearing_fn(_audio, _src, _tgt, _speaker, _original_text):
        await asyncio.sleep(0.5)
        return HearingOutput(audio_data=b"wav", translated_text="hello")

    async def reading_fn(_text, _src, _tgt):
        return "hello"

    class TimingSink(RecordingTransportAdapter):
        """字幕/音声の到達時刻を記録する。"""

        async def publish_audio(
            self,
            *,
            speaker_id: str,
            language: str,
            audio: bytes,
            recipient_ids: Sequence[str],
            generation_id: int | None,
        ) -> None:
            times.setdefault("audio", time.perf_counter())
            await super().publish_audio(
                speaker_id=speaker_id,
                language=language,
                audio=audio,
                recipient_ids=recipient_ids,
                generation_id=generation_id,
            )

        async def send_data(
            self,
            *,
            user_id: str,
            topic: str,
            payload: bytes,
        ) -> None:
            import json

            event = json.loads(payload.decode("utf-8"))
            if topic == TOPIC_SUBTITLE and event.get("type") == "subtitle":
                times.setdefault("subtitle", time.perf_counter())
            await super().send_data(user_id=user_id, topic=topic, payload=payload)

    orch = HybridOrchestrator(hearing_fn=hearing_fn, reading_fn=reading_fn)
    await orch.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=TimingSink(),
        mode="hybrid",
        speaker_id="sp",
    )
    assert "subtitle" in times and "audio" in times
    assert times["audio"] - times["subtitle"] > 0.3


@pytest.mark.asyncio
async def test_qoe_decision_suppresses_hearing_keeps_reading() -> None:
    """QoE decision 注入で聞く主線が止まり、読む主線と確定発話は継続する。"""
    monitor = HybridQoSMonitor(window=10)
    for _ in range(10):
        monitor.record_latency("hearing", 9000.0)

    hearing_called = {"n": 0}

    async def hearing_fn(_audio, _src, _tgt, _speaker, _original_text):
        hearing_called["n"] += 1
        return HearingOutput(audio_data=b"wav", translated_text="x")

    async def reading_fn(_text, _src, _tgt):
        return "hello"

    sink = _FakeSink()
    orch = HybridOrchestrator(
        hearing_fn=hearing_fn, reading_fn=reading_fn, monitor=monitor
    )
    result = await orch.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=sink,
        mode="hybrid",
        speaker_id="sp",
        hearing_available=False,
        qoe_state="hearing_degraded",
        qoe_changed=True,
        qoe_reason="ai_hearing_degraded",
        qoe_ui_reason="degraded",
    )
    assert hearing_called["n"] == 0
    assert result.translations["en"] == "hello"
    qoe_events = [e for _, e in sink.events if e.get("type") == "qoe_degraded"]
    assert qoe_events
    assert qoe_events[0]["should_fallback_to_subtitle"] is True
    assert qoe_events[0]["reason_code"] == "ai_hearing_degraded"
    assert qoe_events[0]["ui_reason"] == "degraded"


@pytest.mark.asyncio
async def test_monitor_p95_alone_does_not_suppress_hearing() -> None:
    """monitor の P95 超過だけでは聞く主線を止めない（測定と制御の分離）。"""
    monitor = HybridQoSMonitor(window=10)
    for _ in range(10):
        monitor.record_latency("hearing", 9000.0)

    hearing_called = {"n": 0}

    async def hearing_fn(_audio, _src, _tgt, _speaker, _original_text):
        hearing_called["n"] += 1
        return HearingOutput(audio_data=b"wav", translated_text="x")

    async def reading_fn(_text, _src, _tgt):
        return "hello"

    orch = HybridOrchestrator(
        hearing_fn=hearing_fn, reading_fn=reading_fn, monitor=monitor
    )
    await orch.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=_FakeSink(),
        mode="hybrid",
        speaker_id="sp",
        hearing_available=True,
    )
    assert hearing_called["n"] == 1


@pytest.mark.asyncio
async def test_final_subtitle_event_includes_speaker_label() -> None:
    """DefaultOutputManager 確定字幕は speaker_label を payload に載せる（P4-A）。"""
    adapter = RecordingTransportAdapter()
    manager = DefaultOutputManager(adapter=adapter)
    await manager.handle(
        FinalSubtitleCommand(
            room_id="r",
            speaker_id="spk",
            subtitle_id="s1",
            seq=1,
            original_text="こんにちは",
            source_language="ja",
            target_language="en",
            translated_text="hello",
            mainline="reading",
            listeners=(
                ListenerRef("u1", "en", wants_audio=False, subtitle_enabled=True),
            ),
            speaker_label="Speaker 1",
        )
    )
    assert len(adapter.data) == 1
    msg = adapter.data[0][2]
    assert msg["speaker_label"] == "Speaker 1"
    assert msg["speaker_id"] == "spk"


@pytest.mark.asyncio
async def test_final_subtitle_event_speaker_label_defaults_none() -> None:
    """speaker_label 未指定なら None（後方互換・未有効時）。"""
    adapter = RecordingTransportAdapter()
    manager = DefaultOutputManager(adapter=adapter)
    await manager.handle(
        FinalSubtitleCommand(
            room_id="r",
            speaker_id="spk",
            subtitle_id="s1",
            seq=1,
            original_text="hi",
            source_language="ja",
            target_language="en",
            translated_text="hi",
            mainline="reading",
            listeners=(
                ListenerRef("u1", "en", wants_audio=False, subtitle_enabled=True),
            ),
        )
    )
    assert adapter.data[0][2]["speaker_label"] is None
