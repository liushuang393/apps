"""既存 OutputSink を Output Manager の transport 境界へ接続する adapter。"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from typing import Protocol

from app.ai_pipeline.output_manager.adapter import TOPIC_EVENT, TOPIC_SUBTITLE


class OutputSinkAdapterPort(Protocol):
    """段階移行中の既存 OutputSink が提供する配信契約。"""

    async def deliver_audio(
        self,
        user_id: str,
        audio: bytes,
        *,
        generation_id: int | None = None,
    ) -> None: ...

    async def deliver_subtitle(self, user_id: str, message: dict) -> None: ...

    async def deliver_interim(self, user_id: str, message: dict) -> None: ...

    async def deliver_event(self, user_id: str, message: dict) -> None: ...


class OutputSinkTransportAdapter:
    """既存 Sink の transport 処理だけを Output Manager から呼び出す。"""

    def __init__(self, sink: OutputSinkAdapterPort) -> None:
        self._sink = sink

    async def publish_audio(
        self,
        *,
        speaker_id: str,
        language: str,
        audio: bytes,
        recipient_ids: Sequence[str],
        generation_id: int | None,
    ) -> None:
        """翻訳音声を既存 Sink へ渡し、全受信者の処理完了を待つ。"""
        del speaker_id, language
        results = await asyncio.gather(
            *(
                self._sink.deliver_audio(
                    user_id,
                    audio,
                    generation_id=generation_id,
                )
                for user_id in recipient_ids
            ),
            return_exceptions=True,
        )
        failure = next(
            (result for result in results if isinstance(result, BaseException)),
            None,
        )
        if failure is not None:
            raise failure

    async def send_data(
        self,
        *,
        user_id: str,
        topic: str,
        payload: bytes,
    ) -> None:
        """canonical payload を既存 Sink の対応チャネルへ渡す。"""
        message = json.loads(payload.decode("utf-8"))
        if topic == TOPIC_SUBTITLE:
            if message.get("type") == "subtitle_interim":
                await self._sink.deliver_interim(user_id, message)
                return
            await self._sink.deliver_subtitle(user_id, message)
            return
        if topic == TOPIC_EVENT:
            await self._sink.deliver_event(user_id, message)
            return
        raise ValueError(f"未対応の Output Manager topic です: {topic}")
