"""
Realtime Session Runtime（Phase 1）

聞く主線（S2S）を Provider SDK から切り離す Port と、発話単位 / 持続接続の実装、
generation 管理を提供する。
"""

from app.ai_pipeline.runtime.factory import RuntimeRegistry, create_realtime_runtime
from app.ai_pipeline.runtime.generation import GenerationTracker
from app.ai_pipeline.runtime.native_persistent import NativePersistentRuntime
from app.ai_pipeline.runtime.per_utterance import PerUtteranceRuntime
from app.ai_pipeline.runtime.port import RealtimeRuntimePort
from app.ai_pipeline.runtime.types import RuntimeEvent, SessionContext, make_session_key

__all__ = [
    "GenerationTracker",
    "NativePersistentRuntime",
    "PerUtteranceRuntime",
    "RealtimeRuntimePort",
    "RuntimeEvent",
    "RuntimeRegistry",
    "SessionContext",
    "create_realtime_runtime",
    "make_session_key",
]
