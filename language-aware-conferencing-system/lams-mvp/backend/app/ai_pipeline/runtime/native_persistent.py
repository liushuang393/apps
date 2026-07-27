"""
NativePersistentRuntime — Provider WebSocket を会議中維持する実装。

目的:
    同一 session_key で接続を再利用し、切断時は再接続、上限超過で短命接続へ切り戻す。
入力 / 出力:
    open_session / append_audio / commit_turn / events / interrupt / close_session
注意:
    LiveKit ingest ループ内では呼ばない（既存 worker 委譲を維持）。
    実 WS 接続は connect_fn 注入でテスト可能。未注入時は gpt_realtime 相当の既定接続。
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import struct
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Protocol

from app.ai_pipeline.runtime.generation import GenerationTracker
from app.ai_pipeline.runtime.per_utterance import PerUtteranceRuntime
from app.ai_pipeline.runtime.types import (
    RuntimeEvent,
    SessionContext,
    interrupted_turn_events,
    make_session_key,
)
from app.config import settings

logger = logging.getLogger(__name__)

# 再接続バックオフ（秒）。設計書例: 0.5, 1, 2
_BACKOFF_SECONDS: tuple[float, ...] = (0.5, 1.0, 2.0)
_REALTIME_API_URL = "wss://api.openai.com/v1/realtime"
_REALTIME_INPUT_RATE = 24000


class WebSocketPort(Protocol):
    """Native Runtime が使用する WebSocket の最小契約。"""

    async def send(self, data: str) -> None: ...

    async def recv(self) -> str | bytes: ...

    async def close(self) -> None: ...


ConnectFn = Callable[[], Awaitable[WebSocketPort]]
TurnFn = Callable[
    [WebSocketPort, bytes, SessionContext, int, str],
    Awaitable[list[RuntimeEvent]],
]


class NativePersistentRuntime:
    """会議中 Provider WebSocket を維持する Runtime。"""

    def __init__(
        self,
        *,
        connect_fn: ConnectFn | None = None,
        turn_fn: TurnFn | None = None,
        reconnect_max: int | None = None,
        fallback_runtime: PerUtteranceRuntime | None = None,
        generation_tracker: GenerationTracker | None = None,
    ) -> None:
        self._connect_fn = connect_fn
        self._turn_fn = turn_fn
        self._reconnect_max = (
            settings.realtime_reconnect_max if reconnect_max is None else reconnect_max
        )
        self._fallback = fallback_runtime
        self._tracker = generation_tracker or GenerationTracker()
        self._context: SessionContext | None = None
        self._ws: WebSocketPort | None = None
        self._buffer = bytearray()
        self._pending_events: list[RuntimeEvent] = []
        self._reconnect_failures = 0
        self._fallback_mode = False
        self._connect_count = 0
        self._original_text: str | None = None
        self._closed = False

    @property
    def generation_tracker(self) -> GenerationTracker:
        """世代管理。"""
        return self._tracker

    @property
    def is_fallback(self) -> bool:
        """再接続上限超過で短命接続相当へ切り戻したか。"""
        return self._fallback_mode

    @property
    def connect_count(self) -> int:
        """確立した接続回数（テスト・観測用）。"""
        return self._connect_count

    def set_original_text(self, text: str | None) -> None:
        """上流 ASR 済み原文（フォールバック経路用）。"""
        self._original_text = text

    async def open_session(self, context: SessionContext) -> None:
        """セッションを開き、必要なら Provider 接続を確立する。"""
        make_session_key(context)
        self._context = context
        self._buffer.clear()
        self._pending_events.clear()
        self._closed = False
        if self._fallback_mode:
            await self._ensure_fallback().open_session(context)
            return
        await self._ensure_connected()

    async def append_audio(self, pcm: bytes) -> None:
        """発話セグメント音声をバッファへ追加する。"""
        if self._fallback_mode:
            await self._ensure_fallback().append_audio(pcm)
            return
        if pcm:
            self._buffer.extend(pcm)

    async def commit_turn(
        self, utterance_id: str, *, generation_id: int | None = None
    ) -> int:
        """バッファを Provider へ送り、ターン結果イベントを準備する。"""
        if self._context is None:
            raise RuntimeError("open_session 前に commit_turn は呼べない")

        if self._fallback_mode:
            fb = self._ensure_fallback()
            fb.set_original_text(self._original_text)
            gen = await fb.commit_turn(utterance_id, generation_id=generation_id)
            self._pending_events = [e async for e in fb.events()]
            return gen

        if generation_id is None:
            generation_id = self._tracker.begin()
        audio = bytes(self._buffer)
        self._buffer.clear()
        self._pending_events = []

        try:
            await self._ensure_connected()
            assert self._ws is not None
            turn = self._turn_fn or self._default_turn
            events = await turn(
                self._ws, audio, self._context, generation_id, utterance_id
            )
            self._reconnect_failures = 0
        except Exception as e:  # noqa: BLE001
            logger.warning("[NativePersistent] ターン失敗: %s", e)
            recovered = await self._reconnect_or_fallback(
                utterance_id, audio, e, generation_id=generation_id
            )
            if recovered is not None:
                return recovered
            self._pending_events = [
                RuntimeEvent(
                    type="runtime_degraded",
                    generation_id=generation_id,
                    utterance_id=utterance_id,
                    payload={"reason": str(e)},
                ),
                RuntimeEvent(
                    type="turn_done",
                    generation_id=generation_id,
                    utterance_id=utterance_id,
                ),
            ]
            return generation_id

        if not self._tracker.should_capture(generation_id):
            self._pending_events = interrupted_turn_events(generation_id, utterance_id)
            return generation_id

        self._pending_events = list(events)
        return generation_id

    def interrupt(self, generation_id: int) -> None:
        """旧 generation をキャンセルする。可能なら Provider へ response.cancel を送る。"""
        self._tracker.interrupt(generation_id)
        ws = self._ws
        if ws is None:
            return

        async def _cancel() -> None:
            try:
                await ws.send(json.dumps({"type": "response.cancel"}))
            except Exception as e:  # noqa: BLE001
                logger.debug("[NativePersistent] response.cancel 失敗: %s", e)

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_cancel())
        except RuntimeError:
            return

    async def events(self) -> AsyncIterator[RuntimeEvent]:
        """直近 commit_turn のイベントを返す。"""
        for event in self._pending_events:
            yield event
        self._pending_events = []

    async def close_session(self) -> None:
        """接続とバッファを解放する。"""
        self._closed = True
        self._buffer.clear()
        self._pending_events.clear()
        if self._fallback is not None:
            await self._fallback.close_session()
        await self._close_ws()
        self._context = None

    def _ensure_fallback(self) -> PerUtteranceRuntime:
        """切り戻し先の短命 Runtime を返す（未設定なら生成）。"""
        if self._fallback is None:
            self._fallback = PerUtteranceRuntime(generation_tracker=self._tracker)
        return self._fallback

    async def _ensure_connected(self) -> None:
        """WebSocket が無ければ接続する。"""
        if self._ws is not None:
            return
        connect = self._connect_fn or self._default_connect
        self._ws = await connect()
        self._connect_count += 1
        if self._context is not None and self._connect_fn is None:
            await self._configure_session(self._ws, self._context)

    async def _close_ws(self) -> None:
        """保持中の WS を閉じる。"""
        ws = self._ws
        self._ws = None
        if ws is None:
            return
        try:
            await ws.close()
        except Exception as e:  # noqa: BLE001
            logger.debug("[NativePersistent] WS close 失敗: %s", e)

    async def _reconnect_or_fallback(
        self,
        utterance_id: str,
        audio: bytes,
        error: Exception,
        *,
        generation_id: int | None = None,
    ) -> int | None:
        """
        再接続を試し、上限超過なら per_utterance 相当へ切り戻す。

        Returns:
            フォールバックで完了した generation_id。再接続継続不能で未完了なら None。
        """
        await self._close_ws()
        self._reconnect_failures += 1
        if generation_id is None:
            generation_id = self._tracker.current

        degraded = RuntimeEvent(
            type="runtime_degraded",
            generation_id=generation_id,
            utterance_id=utterance_id,
            payload={
                "reason": str(error),
                "reconnect_attempt": self._reconnect_failures,
            },
        )

        if self._reconnect_failures > self._reconnect_max:
            logger.warning(
                "[NativePersistent] 再接続上限超過 → per_utterance へ切り戻し"
            )
            self._fallback_mode = True
            fb = self._ensure_fallback()
            if self._context is not None:
                await fb.open_session(self._context)
            fb.set_original_text(self._original_text)
            await fb.append_audio(audio)
            # フォールバック側で新規 begin（tracker 非共有でも翻訳が走るようにする）
            gen = await fb.commit_turn(utterance_id)
            fb_events = [e async for e in fb.events()]
            self._pending_events = [degraded, *fb_events]
            return gen

        backoff_index = min(self._reconnect_failures - 1, len(_BACKOFF_SECONDS) - 1)
        await asyncio.sleep(_BACKOFF_SECONDS[backoff_index])
        try:
            await self._ensure_connected()
            assert self._ws is not None and self._context is not None
            turn = self._turn_fn or self._default_turn
            events = await turn(
                self._ws, audio, self._context, generation_id, utterance_id
            )
            self._reconnect_failures = 0
            self._pending_events = [degraded, *events]
            return generation_id
        except Exception as e2:  # noqa: BLE001
            logger.warning("[NativePersistent] 再接続後も失敗: %s", e2)
            return await self._reconnect_or_fallback(
                utterance_id, audio, e2, generation_id=generation_id
            )

    async def _default_connect(self) -> WebSocketPort:
        """OpenAI Realtime WebSocket へ接続する（本番経路）。"""
        import websockets

        model = settings.openai_realtime_model
        url = f"{_REALTIME_API_URL}?model={model}"
        headers = {
            "Authorization": f"Bearer {settings.openai_api_key}",
            "OpenAI-Beta": "realtime=v1",
        }
        ws = await websockets.connect(url, additional_headers=headers, close_timeout=15)
        # session.created 待ち
        while True:
            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            event = json.loads(msg)
            if event.get("type") in ("session.created", "session.updated"):
                break
        return ws

    async def _configure_session(
        self, ws: WebSocketPort, context: SessionContext
    ) -> None:
        """S2S セッション設定を送る。"""
        from app.ai_pipeline.providers.gpt_realtime import GPTRealtimeProvider

        provider = GPTRealtimeProvider()
        config = provider._build_translate_session_config(
            context.source_language, context.target_language
        )
        await ws.send(json.dumps(config))
        while True:
            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            event = json.loads(msg)
            if event.get("type") == "session.updated":
                return
            if event.get("type") == "error":
                error_msg = event.get("error", {}).get("message", "Unknown")
                raise RuntimeError(f"Session update error: {error_msg}")

    async def _default_turn(
        self,
        ws: WebSocketPort,
        audio: bytes,
        _context: SessionContext,
        generation_id: int,
        utterance_id: str,
    ) -> list[RuntimeEvent]:
        """
        既存 gpt_realtime と同様の append → commit → response.create → 収集。

        WAV 入力を 24kHz PCM に揃えて送信する。
        """
        from app.audio.pcm import parse_wav16, resample16

        pcm_data, src_rate = parse_wav16(audio)
        if not pcm_data:
            # 生 PCM とみなす
            pcm_data = audio
        else:
            pcm_data = resample16(pcm_data, src_rate, _REALTIME_INPUT_RATE)

        audio_b64 = base64.b64encode(pcm_data).decode("utf-8")
        await ws.send(
            json.dumps({"type": "input_audio_buffer.append", "audio": audio_b64})
        )
        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
        await ws.send(json.dumps({"type": "response.create"}))

        translated_text, audio_chunks = await self._collect_response(ws)
        if not self._tracker.should_capture(generation_id):
            return interrupted_turn_events(generation_id, utterance_id)

        events: list[RuntimeEvent] = []
        if translated_text:
            events.append(
                RuntimeEvent(
                    type="transcript_delta",
                    generation_id=generation_id,
                    utterance_id=utterance_id,
                    text=translated_text,
                )
            )
        translated_audio: bytes | None = None
        if audio_chunks:
            pcm_out = b"".join(audio_chunks)
            translated_audio = self._pcm16_to_wav(pcm_out)
            events.append(
                RuntimeEvent(
                    type="audio",
                    generation_id=generation_id,
                    utterance_id=utterance_id,
                    audio_data=translated_audio,
                    text=translated_text,
                )
            )
        events.append(
            RuntimeEvent(
                type="turn_done",
                generation_id=generation_id,
                utterance_id=utterance_id,
                text=translated_text,
                audio_data=translated_audio,
            )
        )
        return events

    async def _collect_response(
        self, ws: WebSocketPort, timeout: float = 15.0
    ) -> tuple[str, list[bytes]]:
        """response.done までテキスト/音声 delta を収集する。"""
        translated_text = ""
        audio_chunks: list[bytes] = []
        done = False
        start = asyncio.get_event_loop().time()
        while True:
            if asyncio.get_event_loop().time() - start > timeout:
                logger.warning("[NativePersistent] S2S タイムアウト")
                break
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=min(5.0, timeout))
            except TimeoutError:
                continue
            event = json.loads(msg)
            event_type = event.get("type", "")
            if event_type == "response.audio.delta":
                delta = event.get("delta", "")
                if delta:
                    audio_chunks.append(base64.b64decode(delta))
            elif event_type == "response.audio_transcript.delta":
                translated_text += event.get("delta", "")
            elif event_type == "response.done":
                done = True
                break
            elif event_type == "error":
                error_msg = event.get("error", {}).get("message", "Unknown")
                raise RuntimeError(f"Realtime API error: {error_msg}")
        if not done and not translated_text and not audio_chunks:
            raise TimeoutError("Realtime API 応答タイムアウト（response.done 未受信）")
        return translated_text.strip(), audio_chunks

    @staticmethod
    def _pcm16_to_wav(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
        """PCM16 を WAV へ変換する。"""
        num_channels = 1
        bits_per_sample = 16
        byte_rate = sample_rate * num_channels * bits_per_sample // 8
        block_align = num_channels * bits_per_sample // 8
        data_size = len(pcm_data)
        file_size = 36 + data_size
        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",
            file_size,
            b"WAVE",
            b"fmt ",
            16,
            1,
            num_channels,
            sample_rate,
            byte_rate,
            block_align,
            bits_per_sample,
            b"data",
            data_size,
        )
        return header + pcm_data
