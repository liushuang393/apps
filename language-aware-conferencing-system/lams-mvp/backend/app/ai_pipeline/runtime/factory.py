"""
Realtime Runtime の生成と session_key 単位の再利用レジストリ。

目的:
    Settings.realtime_runtime に応じて PerUtterance / NativePersistent を選択し、
    同一 session_key の Runtime を会議中に再利用する。
"""

from __future__ import annotations

import logging
from typing import Literal

from app.ai_pipeline.runtime.generation import GenerationTracker
from app.ai_pipeline.runtime.native_persistent import NativePersistentRuntime
from app.ai_pipeline.runtime.per_utterance import PerUtteranceRuntime
from app.ai_pipeline.runtime.types import SessionContext, make_session_key
from app.config import settings

logger = logging.getLogger(__name__)

RuntimeMode = Literal["per_utterance", "native_persistent"]
RuntimeImpl = PerUtteranceRuntime | NativePersistentRuntime


def create_realtime_runtime(
    mode: RuntimeMode | None = None,
    *,
    generation_tracker: GenerationTracker | None = None,
) -> RuntimeImpl:
    """
    設定（または明示 mode）に応じた Runtime を生成する。

    Args:
        mode: 省略時は settings.realtime_runtime
        generation_tracker: 共有 GenerationTracker（barge-in 用）
    Returns:
        PerUtteranceRuntime または NativePersistentRuntime
    """
    selected: RuntimeMode = mode or settings.realtime_runtime
    if selected == "native_persistent":
        return NativePersistentRuntime(
            reconnect_max=settings.realtime_reconnect_max,
            generation_tracker=generation_tracker,
        )
    return PerUtteranceRuntime(generation_tracker=generation_tracker)


class RuntimeRegistry:
    """
    session_key 単位で Runtime を保持するレジストリ。

    持続モードでは同一キーで接続を再利用し、短命モードでも tracker を共有できる。
    """

    def __init__(self, *, max_sessions: int = 32) -> None:
        self._sessions: dict[str, RuntimeImpl] = {}
        self._contexts: dict[str, SessionContext] = {}
        self._max_sessions = max_sessions

    def get_or_create(
        self,
        context: SessionContext,
        *,
        mode: RuntimeMode | None = None,
        generation_tracker: GenerationTracker | None = None,
    ) -> RuntimeImpl:
        """
        同一 session_key の Runtime を返す（無ければ生成）。

        Raises:
            RuntimeError: 同時セッション上限超過時
        """
        key = make_session_key(context)
        selected = mode or settings.realtime_runtime
        if selected == "per_utterance":
            return create_realtime_runtime(
                selected, generation_tracker=generation_tracker
            )
        existing = self._sessions.get(key)
        if existing is not None:
            return existing
        if len(self._sessions) >= self._max_sessions:
            raise RuntimeError(
                f"持続セッション上限超過({self._max_sessions}): key={key}"
            )
        runtime = create_realtime_runtime(mode, generation_tracker=generation_tracker)
        self._sessions[key] = runtime
        self._contexts[key] = context
        logger.debug("[RuntimeRegistry] 作成: key=%s mode=%s", key, mode or "default")
        return runtime

    async def release_speaker(self, room_id: str, speaker_id: str) -> None:
        """退室した話者に属する持続セッションだけを閉じる。"""
        keys = [
            key
            for key, context in self._contexts.items()
            if context.room_id == room_id and context.speaker_id == speaker_id
        ]
        for key in keys:
            await self._sessions[key].close_session()
            self._sessions.pop(key, None)
            self._contexts.pop(key, None)

    async def release_room(self, room_id: str) -> None:
        """終了した会議室の持続セッションを閉じる。"""
        speakers = {
            context.speaker_id
            for context in self._contexts.values()
            if context.room_id == room_id
        }
        for speaker_id in speakers:
            await self.release_speaker(room_id, speaker_id)

    def interrupt_speaker(
        self, room_id: str, speaker_id: str, generation_id: int
    ) -> None:
        """同じ会議・話者に属する全目標言語の旧生成を停止する。"""
        for key, context in self._contexts.items():
            if context.room_id == room_id and context.speaker_id == speaker_id:
                self._sessions[key].interrupt(generation_id)

    async def close_all(self) -> None:
        """保持中の全セッションを閉じる。"""
        for key, runtime in list(self._sessions.items()):
            try:
                await runtime.close_session()
            except Exception as e:  # noqa: BLE001
                logger.warning("[RuntimeRegistry] close 失敗 key=%s: %s", key, e)
        self._sessions.clear()
        self._contexts.clear()


# モジュール唯一の既定レジストリ（会議 Agent から共有してよい）
runtime_registry = RuntimeRegistry()
