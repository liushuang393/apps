"""取り込み主線の Ingress pipeline。

PCM frame から partial/final の処理要求までを LiveKit / DB 非依存で所有する。
公開面は frame／end／cancel／snapshot と型付き downstream 注入に限定し、
QoE 縮退判定は行わず overload 事実の報告だけを行う。
VAD／SpeechSegmenter の既定構築も本 module が所有し、LiveKitAgent は
frame／end／cancel の adapter に留める。
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.webrtc.ingress import IngressAction, IngressSnapshot, SegmentIngress
from app.webrtc.segmenter import SegmentEvent, SpeechSegmenter

logger = logging.getLogger(__name__)

# AI 主線の入力サンプルレート（AudioStream 内部リサンプル後の想定値）。
_DEFAULT_SAMPLE_RATE = 16000

FinalHandler = Callable[[bytes], Awaitable[None]]
PartialHandler = Callable[[bytes], Awaitable[None]]
OverloadObserver = Callable[[bool], None]
FinalAcceptedHook = Callable[[], None]
Clock = Callable[[], float]


@dataclass(frozen=True)
class _QueuedSegment:
    """滞留時間を測定できるキュー要素。"""

    event: SegmentEvent
    enqueued_at: float
    tracked_by_ingress: bool


def build_default_segmenter(
    *, sample_rate: int = _DEFAULT_SAMPLE_RATE
) -> SpeechSegmenter:
    """設定に従い VAD 付き SpeechSegmenter を構築する（pipeline 所有）。

    Silero は RNN 状態を持つため話者トラック毎に独立インスタンスを返す。
    silero 有効時はフレーム長を窓長へ整合し確率希釈を防ぐ。
    """
    from app.audio.vad import SILERO_FRAME_MS, build_vad, resolve_backend
    from app.config import settings

    seg_kwargs: dict[str, object] = {"sample_rate": sample_rate}
    if resolve_backend() == "silero":
        seg_kwargs["frame_ms"] = SILERO_FRAME_MS
    # partial 有効時のみ暫定字幕を切り出す（既定 0＝final のみ）。
    if settings.enable_partial_subtitles:
        seg_kwargs["partial_ms"] = settings.partial_ms
    return SpeechSegmenter(
        is_speech=build_vad(sample_rate=sample_rate),
        **seg_kwargs,
    )


class IngressPipeline:
    """frame／end／cancel／snapshot を公開する話者単位の取り込み主線。"""

    def __init__(
        self,
        *,
        on_final: FinalHandler,
        on_partial: PartialHandler,
        segmenter: SpeechSegmenter | object,
        soft_limit: int = 8,
        hard_limit: int = 64,
        max_age_ms: int = 30_000,
        on_overload: OverloadObserver | None = None,
        on_final_accepted: FinalAcceptedHook | None = None,
        clock: Clock | None = None,
        ingress: SegmentIngress | None = None,
        autostart_worker: bool = True,
    ) -> None:
        if soft_limit <= 0 or hard_limit <= soft_limit:
            raise ValueError("soft_limit < hard_limit の正数で指定してください")
        if max_age_ms <= 0:
            raise ValueError("max_age_ms は正数で指定してください")
        self._on_final = on_final
        self._on_partial = on_partial
        self._on_overload = on_overload
        self._on_final_accepted = on_final_accepted
        self._segmenter = segmenter
        self._clock: Clock = clock or time.monotonic
        self._ingress = ingress or SegmentIngress(
            soft_limit=soft_limit,
            hard_limit=hard_limit,
            max_age_ms=max_age_ms,
        )
        self._autostart_worker = autostart_worker
        self._queue: asyncio.Queue[_QueuedSegment | None] = asyncio.Queue(
            maxsize=hard_limit
        )
        self._worker: asyncio.Task[None] | None = None
        self._closed = False
        self._ended = False
        self._end_lock = asyncio.Lock()
        if autostart_worker:
            self._ensure_worker()

    @classmethod
    def create_default(
        cls,
        *,
        on_final: FinalHandler,
        on_partial: PartialHandler,
        on_overload: OverloadObserver | None = None,
        on_final_accepted: FinalAcceptedHook | None = None,
        sample_rate: int = _DEFAULT_SAMPLE_RATE,
        segmenter: SpeechSegmenter | object | None = None,
        clock: Clock | None = None,
        soft_limit: int | None = None,
        hard_limit: int | None = None,
        max_age_ms: int | None = None,
    ) -> IngressPipeline:
        """settings から VAD／limit を読み取り、本番用 pipeline を構築する。

        segmenter を省略した場合は build_default_segmenter で所有構築する。
        テストでは segmenter／limit を明示注入して LiveKit 非依存に検証できる。
        """
        from app.config import settings

        return cls(
            on_final=on_final,
            on_partial=on_partial,
            on_overload=on_overload,
            on_final_accepted=on_final_accepted,
            segmenter=segmenter
            if segmenter is not None
            else build_default_segmenter(sample_rate=sample_rate),
            soft_limit=settings.ingress_soft_limit
            if soft_limit is None
            else soft_limit,
            hard_limit=settings.ingress_hard_limit
            if hard_limit is None
            else hard_limit,
            max_age_ms=settings.ingress_max_age_ms
            if max_age_ms is None
            else max_age_ms,
            clock=clock,
        )

    def push_frame(self, pcm: bytes) -> None:
        """PCM frame を取り込み、生じた partial/final を政策に従い enqueue する。"""
        if self._closed:
            return
        if self._autostart_worker:
            self._ensure_worker()
        for event in self._segmenter.push_events(pcm):
            self._enqueue(event)

    def snapshot(self) -> IngressSnapshot:
        """Queue 深度・破棄数・overload 事実を返す（QoE decision は含まない）。"""
        return self._ingress.snapshot()

    async def end(self) -> None:
        """tail flush → 終端 signal → worker 回収を行い閉じる（冪等）。"""
        async with self._end_lock:
            if self._ended:
                return
            self._ended = True
            self._closed = True
            with contextlib.suppress(Exception):
                tail = self._segmenter.flush()
                if tail:
                    self._enqueue(SegmentEvent(tail, False))
            self._ensure_worker()
            await self._queue.put(None)
            if self._worker is not None:
                with contextlib.suppress(asyncio.CancelledError):
                    await self._worker
                self._worker = None

    async def cancel(self) -> None:
        """worker を速やかに中断し Queue を空にして閉じる（冪等）。"""
        async with self._end_lock:
            self._closed = True
            self._ended = True
            worker = self._worker
            self._worker = None
            if worker is not None and not worker.done():
                worker.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await worker
            self._drain_queue()
            self._ingress.observe(depth=0, oldest_age_ms=None)

    def _ensure_worker(self) -> None:
        """未起動なら話者ワーカーを起動する。"""
        if self._worker is not None and not self._worker.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # ループ外構築時は end／明示起動まで遅延する
            return
        self._worker = loop.create_task(self._run_worker())

    def _enqueue(self, event: SegmentEvent) -> None:
        """partial は容量非奪取、確定発話は soft/hard/max-age 政策で投入する。"""
        now = self._clock()
        if event.is_partial:
            with contextlib.suppress(asyncio.QueueFull):
                self._queue.put_nowait(_QueuedSegment(event, now, False))
            return

        oldest_age_ms = self._ingress.oldest_age_ms(now)
        decision = self._ingress.decide_enqueue(
            depth=self._queue.qsize(), oldest_age_ms=oldest_age_ms
        )
        self._report_overload(decision.action is IngressAction.ACCEPT_DEGRADED)
        if decision.action in (IngressAction.DROP_AGED, IngressAction.DROP_HARD):
            dropped: _QueuedSegment | None = None
            with contextlib.suppress(asyncio.QueueEmpty):
                dropped = self._queue.get_nowait()
            if dropped is not None and dropped.tracked_by_ingress:
                self._ingress.record_dequeued()
                self._ingress.record_drop(decision.reason)
                logger.error(
                    "[IngressPipeline] 確定発話を明示破棄: reason=%s",
                    decision.reason,
                )
        self._queue.put_nowait(_QueuedSegment(event, now, True))
        self._ingress.record_enqueued(now)
        if self._on_final_accepted is not None:
            self._on_final_accepted()

    async def _run_worker(self) -> None:
        """確定／暫定を順序どおり処理し、例外後も次 item を継続する。"""
        while True:
            item = await self._queue.get()
            if item is None:
                return
            if item.tracked_by_ingress:
                self._ingress.record_dequeued()
            oldest_age_ms = self._ingress.oldest_age_ms(self._clock())
            self._ingress.observe(
                depth=self._queue.qsize(), oldest_age_ms=oldest_age_ms
            )
            self._report_overload(self._ingress.snapshot().overload)
            try:
                if item.event.is_partial:
                    await self._on_partial(item.event.pcm)
                else:
                    await self._on_final(item.event.pcm)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.error("[IngressPipeline] セグメント処理エラー: err=%s", e)

    def _report_overload(self, overloaded: bool) -> None:
        """overload 事実だけを観測者へ渡す（縮退 decision は行わない）。"""
        if self._on_overload is not None:
            self._on_overload(overloaded)

    def _drain_queue(self) -> None:
        """cancel 時に残キューを捨て Ingress 追跡を整合させる。"""
        while True:
            try:
                item = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if item is not None and item.tracked_by_ingress:
                self._ingress.record_dequeued()
