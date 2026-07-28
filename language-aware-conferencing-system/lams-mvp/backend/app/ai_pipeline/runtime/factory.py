"""
Realtime Runtime の生成と session_key 単位の再利用レジストリ。

目的:
    composition root で mode を解決し、同一 session_key の Runtime を会議中に所有する。
注意:
    orchestrator は本モジュールの具象 class / mode を直接参照しない。
    接続再利用などの実装差は Runtime 内部 capability に閉じる。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Literal

from app.ai_pipeline.runtime.generation import GenerationTracker
from app.ai_pipeline.runtime.native_persistent import NativePersistentRuntime
from app.ai_pipeline.runtime.per_utterance import PerUtteranceRuntime
from app.ai_pipeline.runtime.types import SessionContext, make_session_key
from app.config import settings

logger = logging.getLogger(__name__)

RuntimeMode = Literal["per_utterance", "native_persistent"]
RuntimeImpl = PerUtteranceRuntime | NativePersistentRuntime
RuntimeFactory = Callable[..., RuntimeImpl]


def create_realtime_runtime(
    mode: RuntimeMode | None = None,
    *,
    generation_tracker: GenerationTracker | None = None,
) -> RuntimeImpl:
    """
    設定（または明示 mode）に応じた Runtime を生成する。

    Args:
        mode: 省略時は settings.realtime_runtime（composition root 用）
        generation_tracker: 共有 GenerationTracker（実装内部・テスト用）
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
    session_key 単位で Runtime を所有するレジストリ。

    mode はコンストラクタ（composition root）または settings で解決する。
    短命・持続とも instance を保持し、tracker / interrupt / release を一箇所で担う。
    """

    def __init__(
        self,
        *,
        max_sessions: int = 32,
        mode: RuntimeMode | None = None,
        runtime_factory: RuntimeFactory | None = None,
    ) -> None:
        self._sessions: dict[str, RuntimeImpl] = {}
        self._contexts: dict[str, SessionContext] = {}
        self._max_sessions = max_sessions
        self._mode = mode
        self._runtime_factory = runtime_factory or create_realtime_runtime

    def _resolve_mode(self) -> RuntimeMode:
        """注入 mode が無ければ settings を読む（composition root）。"""
        return self._mode or settings.realtime_runtime

    def get_or_create(self, context: SessionContext) -> RuntimeImpl:
        """
        同一 session_key の Runtime を返す（無ければ生成して所有する）。

        Raises:
            RuntimeError: 同時セッション上限超過時
        """
        key = make_session_key(context)
        existing = self._sessions.get(key)
        if existing is not None:
            return existing
        if len(self._sessions) >= self._max_sessions:
            raise RuntimeError(
                f"持続セッション上限超過({self._max_sessions}): key={key}"
            )
        selected = self._resolve_mode()
        runtime = self._runtime_factory(selected)
        self._sessions[key] = runtime
        self._contexts[key] = context
        logger.debug("[RuntimeRegistry] 作成: key=%s mode=%s", key, selected)
        return runtime

    async def release_speaker(self, room_id: str, speaker_id: str) -> None:
        """退室した話者に属するセッションだけを閉じる。"""
        keys = [
            key
            for key, context in self._contexts.items()
            if context.room_id == room_id and context.speaker_id == speaker_id
        ]
        for key in keys:
            try:
                await self._sessions[key].close_session()
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "[RuntimeRegistry] release_speaker close 失敗 key=%s: %s", key, e
                )
            self._sessions.pop(key, None)
            self._contexts.pop(key, None)

    async def release_room(self, room_id: str) -> None:
        """終了した会議室のセッションを閉じる。"""
        speakers = {
            context.speaker_id
            for context in self._contexts.values()
            if context.room_id == room_id
        }
        for speaker_id in speakers:
            await self.release_speaker(room_id, speaker_id)

    def interrupt_speaker(
        self, room_id: str, speaker_id: str, generation_id: int | None = None
    ) -> None:
        """
        同じ会議・話者に属する全目標言語の旧生成を停止する。

        generation_id 省略時は各 Runtime の現行世代を interrupt する。
        """
        for key, context in self._contexts.items():
            if context.room_id == room_id and context.speaker_id == speaker_id:
                runtime = self._sessions[key]
                target = (
                    generation_id
                    if generation_id is not None
                    else runtime.generation_tracker.current
                )
                if target > 0:
                    runtime.interrupt(target)

    async def close_all(self) -> None:
        """保持中の全セッションを閉じる（冪等。途中失敗後も残りを解放する）。"""
        for key, runtime in list(self._sessions.items()):
            try:
                await runtime.close_session()
            except Exception as e:  # noqa: BLE001
                logger.warning("[RuntimeRegistry] close 失敗 key=%s: %s", key, e)
            finally:
                self._sessions.pop(key, None)
                self._contexts.pop(key, None)


# モジュール唯一の既定レジストリ（会議 Agent から共有してよい）
runtime_registry = RuntimeRegistry()
