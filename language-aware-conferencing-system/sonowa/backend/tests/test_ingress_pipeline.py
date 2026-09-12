"""IngressPipeline 公開 seam の振る舞いを検証する。

LiveKit / DB に依存せず、frame／end／cancel／snapshot と注入 downstream だけで
順序維持・過負荷保護・partial 優先・tail flush・資源回収を確認する。
"""

from __future__ import annotations

import asyncio

import pytest

from app.webrtc.ingress_pipeline import IngressPipeline
from app.webrtc.segmenter import SegmentEvent


class _ScriptedSegmenter:
    """PCM プレフィックスで partial/final を返すテスト用 segmenter。"""

    def __init__(self, *, flush_tail: bytes = b"") -> None:
        self._flush_tail = flush_tail

    def push_events(self, pcm: bytes) -> list[SegmentEvent]:
        if pcm.startswith(b"partial:"):
            return [SegmentEvent(pcm.removeprefix(b"partial:"), True)]
        if pcm.startswith(b"final:"):
            return [SegmentEvent(pcm.removeprefix(b"final:"), False)]
        return []

    def flush(self) -> bytes:
        return self._flush_tail


class _Clock:
    """制御可能な単調時計（max-age 検証用）。"""

    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.mark.asyncio
async def test_finals_processed_in_order() -> None:
    """確定発話は投入順どおりに downstream へ届く。"""
    finals: list[bytes] = []

    async def on_final(pcm: bytes) -> None:
        finals.append(pcm)

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    pipeline = IngressPipeline(
        on_final=on_final,
        on_partial=on_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=4,
        hard_limit=8,
    )
    for token in (b"a", b"b", b"c"):
        pipeline.push_frame(b"final:" + token)
    await pipeline.end()

    assert finals == [b"a", b"b", b"c"]


@pytest.mark.asyncio
async def test_speakers_isolated_across_pipelines() -> None:
    """話者ごとに独立 pipeline なら一方の遅延が他方を止めない。"""
    slow_done = asyncio.Event()
    fast: list[bytes] = []

    async def slow_final(pcm: bytes) -> None:  # noqa: ARG001
        await slow_done.wait()

    async def fast_final(pcm: bytes) -> None:
        fast.append(pcm)

    async def noop_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    slow = IngressPipeline(
        on_final=slow_final,
        on_partial=noop_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=4,
        hard_limit=8,
    )
    quick = IngressPipeline(
        on_final=fast_final,
        on_partial=noop_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=4,
        hard_limit=8,
    )
    slow.push_frame(b"final:slow")
    quick.push_frame(b"final:fast")
    await asyncio.wait_for(_wait_until(lambda: fast == [b"fast"]), timeout=1.0)
    slow_done.set()
    await slow.end()
    await quick.end()


@pytest.mark.asyncio
async def test_soft_limit_accepts_final_and_reports_overload() -> None:
    """soft limit 超過でも確定発話を破棄せず overload 事実だけ報告する。"""
    finals: list[bytes] = []
    overloads: list[bool] = []

    async def on_final(pcm: bytes) -> None:
        finals.append(pcm)

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    # worker 未起動のまま depth を溜め、enqueue 政策だけを検証する
    pipeline = IngressPipeline(
        on_final=on_final,
        on_partial=on_partial,
        on_overload=overloads.append,
        segmenter=_ScriptedSegmenter(),
        soft_limit=2,
        hard_limit=4,
        autostart_worker=False,
    )
    pipeline.push_frame(b"final:1")
    pipeline.push_frame(b"final:2")
    pipeline.push_frame(b"final:3")
    assert True in overloads
    assert pipeline.snapshot().final_dropped == 0
    assert pipeline.snapshot().overload is True
    await pipeline.end()
    assert finals == [b"1", b"2", b"3"]


@pytest.mark.asyncio
async def test_hard_limit_drops_oldest_with_reason() -> None:
    """hard limit 到達時は最古確定発話を理由付き破棄し新規を受理する。"""
    finals: list[bytes] = []

    async def on_final(pcm: bytes) -> None:
        finals.append(pcm)

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    pipeline = IngressPipeline(
        on_final=on_final,
        on_partial=on_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=1,
        hard_limit=2,
        autostart_worker=False,
    )
    pipeline.push_frame(b"final:1")
    pipeline.push_frame(b"final:2")
    pipeline.push_frame(b"final:3")
    snap = pipeline.snapshot()
    assert snap.final_dropped == 1
    await pipeline.end()
    assert finals == [b"2", b"3"]


@pytest.mark.asyncio
async def test_max_age_drops_with_controllable_clock() -> None:
    """制御時計で max-age 超過の確定発話だけ理由付き破棄する。"""
    finals: list[bytes] = []
    clock = _Clock(0.0)

    async def on_final(pcm: bytes) -> None:
        finals.append(pcm)

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    pipeline = IngressPipeline(
        on_final=on_final,
        on_partial=on_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=2,
        hard_limit=4,
        max_age_ms=500,
        clock=clock,
        autostart_worker=False,
    )
    pipeline.push_frame(b"final:old")
    clock.advance(0.6)  # 600ms > max_age 500ms
    pipeline.push_frame(b"final:new")
    assert pipeline.snapshot().aged_dropped == 1
    await pipeline.end()
    assert finals == [b"new"]


@pytest.mark.asyncio
async def test_partial_does_not_evict_finals_when_full() -> None:
    """満杯時、partial は破棄され既存 final は温存される（最新優先・容量非奪取）。"""
    finals: list[bytes] = []
    partials: list[bytes] = []

    async def on_final(pcm: bytes) -> None:
        finals.append(pcm)

    async def on_partial(pcm: bytes) -> None:
        partials.append(pcm)

    pipeline = IngressPipeline(
        on_final=on_final,
        on_partial=on_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=1,
        hard_limit=2,
        autostart_worker=False,
    )
    pipeline.push_frame(b"final:1")
    pipeline.push_frame(b"final:2")
    pipeline.push_frame(b"partial:p")
    await pipeline.end()
    assert finals == [b"1", b"2"]
    assert partials == []


@pytest.mark.asyncio
async def test_routes_partial_and_final_to_typed_downstream() -> None:
    """暫定・確定は型付き downstream へ振り分けられ LiveKit 型を受け取らない。"""
    finals: list[bytes] = []
    partials: list[bytes] = []

    async def on_final(pcm: bytes) -> None:
        finals.append(pcm)
        assert isinstance(pcm, bytes)

    async def on_partial(pcm: bytes) -> None:
        partials.append(pcm)
        assert isinstance(pcm, bytes)

    pipeline = IngressPipeline(
        on_final=on_final,
        on_partial=on_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=4,
        hard_limit=8,
    )
    pipeline.push_frame(b"partial:p1")
    pipeline.push_frame(b"final:f1")
    await pipeline.end()
    assert partials == [b"p1"]
    assert finals == [b"f1"]


@pytest.mark.asyncio
async def test_worker_continues_after_downstream_error() -> None:
    """downstream 例外後も次の確定発話を処理する。"""
    finals: list[bytes] = []

    async def flaky(pcm: bytes) -> None:
        if pcm == b"boom":
            raise RuntimeError("provider down")
        finals.append(pcm)

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    pipeline = IngressPipeline(
        on_final=flaky,
        on_partial=on_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=4,
        hard_limit=8,
    )
    pipeline.push_frame(b"final:boom")
    pipeline.push_frame(b"final:ok")
    await pipeline.end()
    assert finals == [b"ok"]


@pytest.mark.asyncio
async def test_end_flushes_tail_segment() -> None:
    """end は tail flush した確定発話を downstream へ届ける。"""
    finals: list[bytes] = []

    async def on_final(pcm: bytes) -> None:
        finals.append(pcm)

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    pipeline = IngressPipeline(
        on_final=on_final,
        on_partial=on_partial,
        segmenter=_ScriptedSegmenter(flush_tail=b"tail"),
        soft_limit=4,
        hard_limit=8,
    )
    await pipeline.end()
    assert finals == [b"tail"]


@pytest.mark.asyncio
async def test_end_is_idempotent() -> None:
    """end を複数回呼んでも例外なく資源回収できる。"""

    async def on_final(pcm: bytes) -> None:  # noqa: ARG001
        return None

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    pipeline = IngressPipeline(
        on_final=on_final,
        on_partial=on_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=4,
        hard_limit=8,
    )
    await pipeline.end()
    await pipeline.end()
    assert pipeline.snapshot().depth == 0


@pytest.mark.asyncio
async def test_cancel_stops_worker_without_processing_queued() -> None:
    """cancel は worker を速やかに止め、未処理キューを回収する。"""
    finals: list[bytes] = []
    gate = asyncio.Event()

    async def gated_final(pcm: bytes) -> None:
        await gate.wait()
        finals.append(pcm)

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    pipeline = IngressPipeline(
        on_final=gated_final,
        on_partial=on_partial,
        segmenter=_ScriptedSegmenter(),
        soft_limit=4,
        hard_limit=8,
    )
    pipeline.push_frame(b"final:1")
    # worker が 1 件目でゲート待ちの間に追加投入
    await asyncio.wait_for(
        _wait_until(lambda: pipeline.snapshot().depth >= 0), timeout=1.0
    )
    pipeline.push_frame(b"final:2")
    await pipeline.cancel()
    gate.set()
    # cancel 後に追加処理されない
    await asyncio.sleep(0.05)
    assert b"2" not in finals
    assert pipeline.snapshot().depth == 0


@pytest.mark.asyncio
async def test_pipeline_does_not_evaluate_qoe() -> None:
    """pipeline は overload 事実の報告に留め、QoE decision を持たない。"""
    reports: list[bool] = []

    async def on_final(pcm: bytes) -> None:  # noqa: ARG001
        return None

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    pipeline = IngressPipeline(
        on_final=on_final,
        on_partial=on_partial,
        on_overload=reports.append,
        segmenter=_ScriptedSegmenter(),
        soft_limit=1,
        hard_limit=4,
    )
    # 属性として QoE 判定 API を持たないこと
    assert not hasattr(pipeline, "evaluate")
    assert not hasattr(pipeline, "evaluate_qoe")
    pipeline.push_frame(b"final:1")
    pipeline.push_frame(b"final:2")
    await pipeline.end()
    assert True in reports


async def _wait_until(predicate, *, interval: float = 0.01) -> None:
    """条件成立まで短周期で待つ。"""
    while not predicate():
        await asyncio.sleep(interval)
