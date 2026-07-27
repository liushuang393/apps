"""
PerUtteranceRuntime — 発話ごとに Provider 接続する現行互換実装。

目的:
    RealtimeRuntimePort 経由で聞く主線を駆動しつつ、既定挙動（短命接続）を維持する。
入力 / 出力:
    append_audio → commit_turn → events() で TranslationResult 相当をイベント化。
注意:
    translate_fn 未注入時は ai_pipeline / 既定 provider の translate_audio を遅延束縛する。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable

from app.ai_pipeline.runtime.generation import GenerationTracker
from app.ai_pipeline.runtime.types import (
    RuntimeEvent,
    SessionContext,
    interrupted_turn_events,
    make_session_key,
)

logger = logging.getLogger(__name__)

# (audio, src, tgt, original_text) → 音声付き翻訳結果
TranslateFn = Callable[
    [bytes, str, str, str | None],
    Awaitable[object],
]


class PerUtteranceRuntime:
    """発話単位で connect/disconnect する Runtime（既定・後方互換）。"""

    def __init__(
        self,
        *,
        translate_fn: TranslateFn | None = None,
        generation_tracker: GenerationTracker | None = None,
    ) -> None:
        self._translate_fn = translate_fn
        self._tracker = generation_tracker or GenerationTracker()
        self._context: SessionContext | None = None
        self._buffer = bytearray()
        self._pending_events: list[RuntimeEvent] = []
        self._active_task_gen: int | None = None
        self._original_text: str | None = None

    @property
    def generation_tracker(self) -> GenerationTracker:
        """世代管理（barge-in / capture 判定用）。"""
        return self._tracker

    def set_original_text(self, text: str | None) -> None:
        """上流 ASR 済み原文（あれば translate へ引き渡す）。"""
        self._original_text = text

    async def open_session(self, context: SessionContext) -> None:
        """セッション文脈を保持する（接続は commit 時に都度確立）。"""
        make_session_key(context)  # 空要素検証
        self._context = context
        self._buffer.clear()
        self._pending_events.clear()

    async def append_audio(self, pcm: bytes) -> None:
        """発話セグメント音声をバッファへ追加する。"""
        if pcm:
            self._buffer.extend(pcm)

    async def commit_turn(
        self, utterance_id: str, *, generation_id: int | None = None
    ) -> int:
        """
        バッファ音声で短命翻訳を実行し、イベントを準備する。

        Args:
            utterance_id: 発話識別子
            generation_id: 外部発行済み世代（省略時は tracker.begin）
        Returns:
            本ターンの generation_id
        """
        if self._context is None:
            raise RuntimeError("open_session 前に commit_turn は呼べない")
        if generation_id is None:
            generation_id = self._tracker.begin()
        self._active_task_gen = generation_id
        audio = bytes(self._buffer)
        self._buffer.clear()
        self._pending_events = []

        try:
            result = await self._translate(
                audio,
                self._context.source_language,
                self._context.target_language,
                self._original_text,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[PerUtteranceRuntime] 翻訳失敗: %s", e)
            self._pending_events = [
                RuntimeEvent(
                    type="turn_done",
                    generation_id=generation_id,
                    utterance_id=utterance_id,
                    payload={"error": str(e)},
                )
            ]
            return generation_id

        # interrupt 済みなら音声イベントを載せない
        if not self._tracker.should_capture(generation_id):
            self._pending_events = interrupted_turn_events(generation_id, utterance_id)
            return generation_id

        text = str(getattr(result, "translated_text", "") or "")
        audio_data = getattr(result, "audio_data", None)
        events: list[RuntimeEvent] = []
        if text:
            events.append(
                RuntimeEvent(
                    type="transcript_delta",
                    generation_id=generation_id,
                    utterance_id=utterance_id,
                    text=text,
                )
            )
        if audio_data:
            events.append(
                RuntimeEvent(
                    type="audio",
                    generation_id=generation_id,
                    utterance_id=utterance_id,
                    audio_data=audio_data if isinstance(audio_data, bytes) else None,
                    text=text,
                )
            )
        events.append(
            RuntimeEvent(
                type="turn_done",
                generation_id=generation_id,
                utterance_id=utterance_id,
                text=text,
            )
        )
        self._pending_events = events
        return generation_id

    def interrupt(self, generation_id: int) -> None:
        """旧 generation をキャンセルする（遅延到着音声の再生禁止）。"""
        self._tracker.interrupt(generation_id)

    async def events(self) -> AsyncIterator[RuntimeEvent]:
        """直近 commit_turn のイベントを順に返す。"""
        for event in self._pending_events:
            yield event
        self._pending_events = []

    async def close_session(self) -> None:
        """バッファと文脈を解放する（接続は都度閉じ済み）。"""
        self._buffer.clear()
        self._pending_events.clear()
        self._context = None
        self._original_text = None

    async def _translate(
        self,
        audio: bytes,
        src: str,
        tgt: str,
        original_text: str | None,
    ) -> object:
        """注入または既定 provider で翻訳する。"""
        if self._translate_fn is not None:
            return await self._translate_fn(audio, src, tgt, original_text)
        from app.ai_pipeline.pipeline import ai_pipeline

        return await ai_pipeline.process_audio(
            audio, src, tgt, speaker_id="runtime", original_text=original_text
        )
