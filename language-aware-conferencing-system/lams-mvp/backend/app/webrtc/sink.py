"""
LiveKitOutputSink（Phase 3 C1）：HybridOrchestrator の OutputSink を LiveKit へ橋渡し。

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

    orchestrator は目標言語グループ内の全受信者へ同一 audio オブジェクトを渡す。
    本 sink は話者単位のため、同一 payload は最初の 1 回のみ capture する
    （オブジェクト同一性で重複排除）。

    generation_id が渡された場合、GenerationGate 不一致なら capture しない。
"""

from __future__ import annotations

import inspect
import json
import logging
from collections.abc import Awaitable, Callable
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

# 注入コールバック型（旧3引数コールバックも実行時判定で維持する）。
AudioCapture = Callable[..., Awaitable[None]]
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
    """OutputSink プロトコル実装（翻訳音声=track / 字幕・イベント=data channel）。"""

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
        self._user_language = user_language
        self._capture_audio = capture_audio
        self._send_data = send_data
        self._speaker_id = speaker_id
        self._hearing_sample_rate = hearing_sample_rate
        self._generation_gate = generation_gate
        self._capture_supports_generation = self._supports_generation_id(capture_audio)
        # 言語ごとに「直近 capture 済みオブジェクト」を保持し重複 capture を防ぐ。
        self._last_audio: dict[str, bytes] = {}

    async def deliver_audio(
        self,
        user_id: str,
        audio: bytes,
        *,
        generation_id: int | None = None,
    ) -> None:
        """翻訳音声を (話者, 目標言語) トラックへ送る（言語単位で重複排除）。"""
        lang = self._user_language.get(user_id)
        if lang is None or not audio:
            return
        gate = self._generation_gate
        if gate is not None and generation_id is not None:
            if not gate.should_capture(self._speaker_id, lang, generation_id):
                logger.debug(
                    "[LiveKitSink] 旧 generation を抑止: speaker=%s lang=%s gen=%s",
                    self._speaker_id,
                    lang,
                    generation_id,
                )
                return
            gate.set_active(self._speaker_id, lang, generation_id)
        # 同一 payload（同一オブジェクト）は言語トラックへ 1 回だけ capture する。
        if self._last_audio.get(lang) is audio:
            return
        self._last_audio[lang] = audio

        # provider の出力は WAV ヘッダ付きのことがある（TTS / S2S とも）。
        # ヘッダを剥がし、ヘッダ記載の実レートで 48kHz へ変換する（欠陥 #2 付随）。
        pcm, rate = parse_wav16(audio, fallback_rate=self._hearing_sample_rate)
        pcm48 = resample16(pcm, rate, OUTPUT_SAMPLE_RATE)
        await self._invoke_capture(self._speaker_id, lang, pcm48, generation_id)

    async def _invoke_capture(
        self,
        speaker_id: str,
        lang: str,
        pcm48: bytes,
        generation_id: int | None,
    ) -> None:
        """capture コールバックへ generation_id を可能な範囲で渡す。"""
        if self._capture_supports_generation:
            await self._capture_audio(
                speaker_id, lang, pcm48, generation_id=generation_id
            )
            return
        await self._capture_audio(speaker_id, lang, pcm48)

    @staticmethod
    def _supports_generation_id(capture_audio: AudioCapture) -> bool:
        """コールバックが generation_id キーワードを受理するか判定する。"""
        try:
            parameters = inspect.signature(capture_audio).parameters
        except (TypeError, ValueError):
            return False
        return "generation_id" in parameters or any(
            parameter.kind is inspect.Parameter.VAR_KEYWORD
            for parameter in parameters.values()
        )

    async def deliver_subtitle(self, user_id: str, message: dict) -> None:
        """字幕を受信者宛てに data channel で配信する。"""
        await self._send(user_id, message, TOPIC_SUBTITLE)

    async def deliver_interim(self, user_id: str, message: dict) -> None:
        """暫定字幕を確定字幕と同じ topic で配信する。"""
        await self._send(user_id, message, TOPIC_SUBTITLE)

    async def deliver_event(self, user_id: str, message: dict) -> None:
        """QoS 警告等のイベントを受信者宛てに data channel で配信する。"""
        await self._send(user_id, message, TOPIC_EVENT)

    async def _send(self, user_id: str, message: dict, topic: str) -> None:
        payload = json.dumps(message, ensure_ascii=False).encode("utf-8")
        try:
            await self._send_data(payload, [user_id], topic)
        except Exception as e:  # noqa: BLE001
            logger.warning("[LiveKitSink] data 送信失敗(%s/%s): %s", user_id, topic, e)
