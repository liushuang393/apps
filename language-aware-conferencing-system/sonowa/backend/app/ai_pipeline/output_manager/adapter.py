"""
Output Manager 向け transport adapter 境界。

目的:
    LiveKit 等の transport 固有処理を adapter に閉じ、
    Output Manager 本体を transport 非依存に保つ。
入力 / 出力:
    publish_audio / send_data は非同期。失敗は例外で上位へ伝え、
    Manager 側で受信者単位に隔離する。
注意:
    send_data の payload は canonical encoder 済み bytes のみを受け取る。
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

# 移行期間中は既存 LiveKit DataChannel topic を維持する。
TOPIC_SUBTITLE = "subtitle"
TOPIC_EVENT = "qos"


class TransportAdapter(Protocol):
    """クライアント出力の transport 境界（LiveKit 等の実装点）。"""

    async def publish_audio(
        self,
        *,
        speaker_id: str,
        language: str,
        audio: bytes,
        recipient_ids: Sequence[str],
        generation_id: int | None,
    ) -> None:
        """翻訳音声を言語トラック単位で publish する。"""

    async def send_data(
        self,
        *,
        user_id: str,
        topic: str,
        payload: bytes,
    ) -> None:
        """encoder 済みイベントを受信者宛てに送る。"""


@dataclass
class RecordingTransportAdapter:
    """配信結果を記録する fake adapter（実 LiveKit なしの回帰用）。"""

    audio: list[tuple[str, str, bytes, list[str], int | None]] = field(
        default_factory=list
    )
    data: list[tuple[str, str, dict]] = field(default_factory=list)
    raw_payloads: list[bytes] = field(default_factory=list)
    fail_users: set[str] = field(default_factory=set)

    async def publish_audio(
        self,
        *,
        speaker_id: str,
        language: str,
        audio: bytes,
        recipient_ids: Sequence[str],
        generation_id: int | None,
    ) -> None:
        """翻訳音声の publish を記録する。"""
        self.audio.append(
            (speaker_id, language, audio, list(recipient_ids), generation_id)
        )

    async def send_data(
        self,
        *,
        user_id: str,
        topic: str,
        payload: bytes,
    ) -> None:
        """encoder 済み payload を記録し、失敗注入を適用する。"""
        if user_id in self.fail_users:
            raise RuntimeError(f"injected delivery failure: {user_id}")
        self.raw_payloads.append(payload)
        event = json.loads(payload.decode("utf-8"))
        self.data.append((user_id, topic, event))
