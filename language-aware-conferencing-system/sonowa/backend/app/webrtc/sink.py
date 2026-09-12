"""
LiveKitOutputSink（Phase 3 C1）：HybridOrchestrator の TransportAdapter を LiveKit へ橋渡し。

収束結果を「混ぜずに」配信する境界:
    - 聞く主線（翻訳音声）= (話者, 目標言語) ごとの音声トラックへ capture（48kHz int16）。
    - 読む主線（字幕）/ QoS イベント = data channel（受信者 identity 宛て）。

設計:
    実 rtc.Room への依存を避けるため、音声 capture と data 送信は注入された
    コールバックへ委譲する（agent が実体を渡す）。これにより I/O 非依存で
    単体テスト可能。受信者 identity→目標言語の対応は構築時に受け取る。

    トラックは言語ごと 1 本の共有ではなく (話者, 言語) 単位に分離する。共有トラックは
    同時発話のフレームが交互に混入して破綻し（欠陥 #3）、話者本人の除外も不可能で
    自声翻訳がエコーとして返ってしまう（欠陥 #6）。フレーム分割は publisher 側の
    責務とし、本 sink はセグメント単位の 48kHz PCM を capture コールバックへ渡すのみ。

    Output Manager は目標言語グループ内の全受信者へ同一 audio を 1 回 publish する。
    本 sink は話者単位のため、同一 payload は最初の 1 回のみ capture する
    （オブジェクト同一性で重複排除）。

    generation_id が渡された場合、GenerationGate 不一致なら capture しない。

    公開契約は TransportAdapter（publish_audio / send_data）のみ。
    send_data の失敗は伝播し、受信者単位の隔離は Output Manager 側で行う。
"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Awaitable, Callable, Sequence
from typing import Protocol

from app.audio.pcm import parse_wav16, resample16

logger = logging.getLogger(__name__)

# LiveKit publish 用の出力フォーマット（WebRTC 標準の 48kHz）。
OUTPUT_SAMPLE_RATE = 48000
FRAME_MS = 10
OUTPUT_FRAME_SAMPLES = OUTPUT_SAMPLE_RATE * FRAME_MS // 1000  # 480 標本/10ms

# data channel のトピック（フロントはトピックで振り分ける）。
TOPIC_SUBTITLE = "subtitle"
TOPIC_EVENT = "qos"


# 注入コールバック型。generation_id は旧世代抑止のため必須の契約要素。
class AudioCapture(Protocol):
    """翻訳音声を世代情報付きで capture する固定契約。"""

    def __call__(
        self,
        speaker_id: str,
        language: str,
        pcm48: bytes,
        *,
        generation_id: int | None = None,
    ) -> Awaitable[None]: ...


DataSend = Callable[[bytes, list[str], str], Awaitable[None]]  # (payload, ids, topic)


class GenerationGatePort(Protocol):
    """Sink が必要とする generation gate の最小契約。"""

    def set_active(
        self, speaker_id: str, language: str, generation_id: int
    ) -> None: ...

    def should_capture(
        self, speaker_id: str, language: str, generation_id: int | None
    ) -> bool: ...


class LiveKitOutputSink:
    """TransportAdapter 実装（翻訳音声=track / 字幕・イベント=data channel）。"""

    def __init__(
        self,
        *,
        user_language: dict[str, str],
        capture_audio: AudioCapture,
        send_data: DataSend,
        speaker_id: str,
        hearing_sample_rate: int = 24000,
        generation_gate: GenerationGatePort | None = None,
    ) -> None:
        # user_language は sink_factory 契約互換のため受け取る（配信は language 引数）。
        self._user_language = user_language
        self._capture_audio = capture_audio
        self._send_data = send_data
        self._speaker_id = speaker_id
        self._hearing_sample_rate = hearing_sample_rate
        self._generation_gate = generation_gate
        self._validate_audio_capture(capture_audio)
        # 言語ごとに「直近 capture 済みオブジェクト」を保持し重複 capture を防ぐ。
        self._last_audio: dict[str, bytes] = {}

    async def publish_audio(
        self,
        *,
        speaker_id: str,
        language: str,
        audio: bytes,
        recipient_ids: Sequence[str],
        generation_id: int | None,
    ) -> None:
        """Output Manager から言語トラック単位の翻訳音声を受け取る。"""
        if not recipient_ids or not audio:
            return
        gate = self._generation_gate
        if gate is not None and generation_id is not None:
            if not gate.should_capture(speaker_id, language, generation_id):
                logger.debug(
                    "[LiveKitSink] 旧 generation を抑止: speaker=%s lang=%s gen=%s",
                    speaker_id,
                    language,
                    generation_id,
                )
                return
            gate.set_active(speaker_id, language, generation_id)
        if self._last_audio.get(language) is audio:
            return
        self._last_audio[language] = audio
        pcm, rate = parse_wav16(audio, fallback_rate=self._hearing_sample_rate)
        pcm48 = resample16(pcm, rate, OUTPUT_SAMPLE_RATE)
        await self._invoke_capture(speaker_id, language, pcm48, generation_id)

    async def send_data(
        self,
        *,
        user_id: str,
        topic: str,
        payload: bytes,
    ) -> None:
        """Output Manager の送信失敗集約のため、例外を伝播して送信する。"""
        await self._send_data(payload, [user_id], topic)

    async def _invoke_capture(
        self,
        speaker_id: str,
        lang: str,
        pcm48: bytes,
        generation_id: int | None,
    ) -> None:
        """capture コールバックへ generation_id を必ず渡す。"""
        await self._capture_audio(speaker_id, lang, pcm48, generation_id=generation_id)

    @staticmethod
    def _validate_audio_capture(capture_audio: AudioCapture) -> None:
        """構築時に generation-aware capture 契約を検証する。"""
        try:
            signature = inspect.signature(capture_audio)
        except (TypeError, ValueError) as exc:
            raise TypeError(
                "capture_audio は generation_id を含む固定 signature が必要"
            ) from exc
        if "generation_id" not in signature.parameters:
            raise TypeError(
                "capture_audio は generation_id を含む固定 signature が必要"
            )
        try:
            signature.bind("speaker", "language", b"", generation_id=None)
        except TypeError as exc:
            raise TypeError(
                "capture_audio は generation_id を含む固定 signature が必要"
            ) from exc
