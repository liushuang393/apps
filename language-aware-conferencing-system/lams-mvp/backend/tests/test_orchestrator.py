"""
HybridOrchestrator（Phase 3 ハイブリッド 2 主線同時オーケストレーション）の単体テスト。

聞く主線（S2S）/読む主線（ASR+MT）を注入したフェイクで差し替え、I/O 非依存で
「フォーク→2 主線同時投入→Output Manager 収束（混ぜない）」の各分岐を検証する。
"""

from dataclasses import dataclass

import pytest

from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener
from app.ai_pipeline.qos import READING_P95_TARGET_MS, HybridQoSMonitor


@dataclass
class _FakeProcessed:
    """ai_pipeline.process_audio 戻り値の最小スタブ。"""

    audio_data: bytes | None
    translated_text: str


class _FakeSink:
    """OutputSink のフェイク。配信先と内容を記録する。"""

    def __init__(self) -> None:
        self.audio: list[tuple[str, bytes]] = []
        self.subtitles: list[tuple[str, dict]] = []

    async def deliver_audio(self, user_id: str, audio: bytes) -> None:
        self.audio.append((user_id, audio))

    async def deliver_subtitle(self, user_id: str, message: dict) -> None:
        self.subtitles.append((user_id, message))


def _make_orchestrator() -> tuple[HybridOrchestrator, dict]:
    """聞く/読む主線を記録するフェイクで差し替えたオーケストレーターを作る。"""
    calls: dict[str, int] = {"hearing": 0, "reading": 0}

    async def hearing(
        _audio: bytes, _src: str, tgt: str, _speaker: str
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
    # 聞く主線の音声が配信される
    assert sink.audio == [("u1", b"AUDIO")]
    # 字幕は読む主線が権威（混ぜない）
    assert len(sink.subtitles) == 1
    _, msg = sink.subtitles[0]
    assert msg["original_text"] == "R:en"
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
    assert sink.audio == [("u1", b"AUDIO")]
    _, msg = sink.subtitles[0]
    assert msg["original_text"] == "H:en"
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
    assert sink.audio == []
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

    assert sink.audio == []  # エコー防止
    assert len(sink.subtitles) == 1


class _EventSink(_FakeSink):
    """deliver_event を備えた OutputSink フェイク（qos_warning 配信検証用）。"""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[tuple[str, dict]] = []

    async def deliver_event(self, user_id: str, message: dict) -> None:
        self.events.append((user_id, message))


@pytest.mark.asyncio
async def test_runtime_fallback_hearing_failure_to_reading() -> None:
    """§10: mode A で聞く主線が失敗すると、字幕のため読む主線へ縮退する。"""
    calls: dict[str, int] = {"hearing": 0, "reading": 0}

    async def hearing(_a: bytes, _s: str, _t: str, _spk: str) -> object:
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

    # mode A では読む主線は未駆動だが、聞く失敗で縮退起動される
    assert calls == {"hearing": 1, "reading": 1}
    assert sink.audio == []  # 翻訳音声は生成されない
    _, msg = sink.subtitles[0]
    assert msg["original_text"] == "R:en"
    assert msg["mainline"] == "reading"
    assert res.tags[0]["reason"] == "hearing_failed_runtime_fallback_reading"


@pytest.mark.asyncio
async def test_qos_warnings_emitted_to_result_and_event_sink() -> None:
    """§9: 目標逸脱時に qos_warning が result と deliver_event へ反映される。"""

    async def hearing(_a: bytes, _s: str, _t: str, _spk: str) -> object:
        return _FakeProcessed(audio_data=b"A", translated_text="H")

    async def reading(_text: str, _src: str, tgt: str) -> str:
        return f"R:{tgt}"

    monitor = HybridQoSMonitor()
    monitor.record_latency("reading", READING_P95_TARGET_MS + 1000.0)
    monitor.record_glossary(1, 10)  # 0.1 < 0.95
    orch = HybridOrchestrator(hearing_fn=hearing, reading_fn=reading, monitor=monitor)
    sink = _EventSink()
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
    # deliver_event を持つ sink には各受信者へ警告が配信される
    assert {m["metric"] for _, m in sink.events} == {
        "latency_p95",
        "glossary_hit_rate",
    }
    assert all(uid == "u1" for uid, _ in sink.events)


@pytest.mark.asyncio
async def test_no_monitor_means_no_qos_warnings() -> None:
    """monitor 未注入なら QoS 計測・警告は一切発生しない（純動作）。"""
    orch, _ = _make_orchestrator()
    sink = _EventSink()
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
