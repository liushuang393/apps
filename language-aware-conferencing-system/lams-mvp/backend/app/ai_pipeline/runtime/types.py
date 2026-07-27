"""
Realtime Runtime の共有型。

目的:
    session_key / SessionContext / RuntimeEvent を定義し、Port 実装間で契約を共有する。
入力 / 出力:
    make_session_key(context) -> str（空要素時は ValueError）
注意:
    session_key 構成は設計書どおり room_id + speaker_id + target_language + provider。
"""

from __future__ import annotations

from dataclasses import dataclass, field


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
            type="interrupted",
            generation_id=generation_id,
            utterance_id=utterance_id,
        ),
        RuntimeEvent(
            type="turn_done",
            generation_id=generation_id,
            utterance_id=utterance_id,
        ),
    ]
