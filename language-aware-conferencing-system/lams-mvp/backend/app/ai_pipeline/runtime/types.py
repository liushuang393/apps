"""
Realtime Runtime の共有型。

目的:
    session / turn / event 契約を定義し、Port 実装間で同一の意味を共有する。
入力 / 出力:
    make_session_key(context) -> str（空要素時は ValueError）
    is_terminal_event(event) -> bool
注意:
    session_key 構成は設計書どおり room_id + speaker_id + target_language + provider。
    RuntimeEvent.type は既知 variant（RuntimeEventType）の文字列値を用いる。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class RuntimeEventType(str, Enum):
    """Runtime が返す既知イベント variant。"""

    TRANSCRIPT_DELTA = "transcript_delta"
    AUDIO = "audio"
    TURN_DONE = "turn_done"
    INTERRUPTED = "interrupted"
    RUNTIME_DEGRADED = "runtime_degraded"
    TURN_FAILED = "turn_failed"


# 一 turn を閉じる終端イベント（必須でちょうど一つ）
TERMINAL_EVENT_TYPES: frozenset[str] = frozenset(
    {
        RuntimeEventType.TURN_DONE.value,
        RuntimeEventType.TURN_FAILED.value,
    }
)


@dataclass(frozen=True)
class SessionContext:
    """持続 / 短命ランタイム共通のセッション識別情報。"""

    room_id: str
    speaker_id: str
    source_language: str
    target_language: str
    provider: str


@dataclass(frozen=True)
class RuntimeEvent:
    """ランタイムが呼出側へ返すイベント（音声・字幕 delta・状態）。"""

    type: str
    generation_id: int
    utterance_id: str = ""
    audio_data: bytes | None = None
    text: str = ""
    payload: dict = field(default_factory=dict)


@dataclass(frozen=True)
class RuntimeTranslationOutput:
    """短命 Runtime adapter が provider 結果から確定する厳密な中間出力。"""

    translated_text: str
    audio_data: bytes | None


@dataclass(frozen=True)
class TurnInput:
    """
    一発話 turn の型付き入力。

    generation_id 省略時は Port 側 GenerationTracker が新規発行する。
    外部で begin 済みの場合のみ明示して二重発行を避ける。
    """

    utterance_id: str
    audio: bytes = b""
    original_text: str | None = None
    generation_id: int | None = None


@dataclass(frozen=True)
class TurnResult:
    """一 turn の結果（発行世代とイベント列）。"""

    generation_id: int
    events: tuple[RuntimeEvent, ...]

    def terminal_event(self) -> RuntimeEvent | None:
        """終端イベントを返す（無ければ None）。"""
        for event in reversed(self.events):
            if is_terminal_event(event):
                return event
        return None


def is_terminal_event(event: RuntimeEvent) -> bool:
    """イベントが turn 終端かどうかを返す。"""
    return event.type in TERMINAL_EVENT_TYPES


def make_session_key(context: SessionContext) -> str:
    """
    セッションキーを組み立てる。

    Args:
        context: 会議室・話者・目標言語・provider を含む文脈
    Returns:
        "room:speaker:lang:provider" 形式のキー
    Raises:
        ValueError: いずれかの構成要素が空のとき
    """
    parts = (
        context.room_id,
        context.speaker_id,
        context.target_language,
        context.provider,
    )
    if any(not p for p in parts):
        raise ValueError("session_key の構成要素はいずれも非空である必要がある")
    return ":".join(parts)


def interrupted_turn_events(
    generation_id: int, utterance_id: str
) -> list[RuntimeEvent]:
    """割込み済みターンの共通終端イベント列を返す。"""
    return [
        RuntimeEvent(
            type=RuntimeEventType.INTERRUPTED.value,
            generation_id=generation_id,
            utterance_id=utterance_id,
        ),
        RuntimeEvent(
            type=RuntimeEventType.TURN_DONE.value,
            generation_id=generation_id,
            utterance_id=utterance_id,
        ),
    ]


def turn_failed_event(
    generation_id: int,
    utterance_id: str,
    *,
    reason_code: str,
    message: str = "",
) -> RuntimeEvent:
    """
    型付き失敗イベントを組み立てる。

    Args:
        generation_id: 対象世代
        utterance_id: 発話識別子
        reason_code: 機械可読な失敗理由（秘密情報を含めない）
        message: 人間可読な要約（Token / API Key を含めない）
    """
    return RuntimeEvent(
        type=RuntimeEventType.TURN_FAILED.value,
        generation_id=generation_id,
        utterance_id=utterance_id,
        payload={"reason_code": reason_code, "message": message},
    )
