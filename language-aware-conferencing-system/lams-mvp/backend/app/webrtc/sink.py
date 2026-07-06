"""
LiveKitOutputSink（Phase 3 C1）：HybridOrchestrator の OutputSink を LiveKit へ橋渡し。

収束結果を「混ぜずに」配信する境界:
    - 聞く主線（翻訳音声）= 目標言語ごとの音声トラックへ capture（48kHz int16）。
    - 読む主線（字幕）/ QoS イベント = data channel（受信者 identity 宛て）。

設計:
    実 rtc.Room への依存を避けるため、音声 capture と data 送信は注入された
    コールバックへ委譲する（agent が実体を渡す）。これにより I/O 非依存で
    単体テスト可能。受信者 identity→目標言語の対応は構築時に受け取る。

    orchestrator は目標言語グループ内の全受信者へ同一 audio オブジェクトを渡す。
    トラックは言語単位で 1 本のため、同一 payload は最初の 1 回のみ capture する
    （オブジェクト同一性で重複排除）。
"""

import json
import logging
from collections.abc import Awaitable, Callable

from app.audio.pcm import chunk16, parse_wav16, resample16

logger = logging.getLogger(__name__)

# LiveKit publish 用の出力フォーマット（WebRTC 標準の 48kHz / 10ms フレーム）。
OUTPUT_SAMPLE_RATE = 48000
FRAME_MS = 10
OUTPUT_FRAME_SAMPLES = OUTPUT_SAMPLE_RATE * FRAME_MS // 1000  # 480 標本/10ms

# data channel のトピック（フロントはトピックで購読を振り分ける）。
TOPIC_SUBTITLE = "subtitle"
TOPIC_EVENT = "qos"

# 注入コールバック型
AudioCapture = Callable[[str, bytes], Awaitable[None]]  # (target_language, 48k frame)
DataSend = Callable[[bytes, list[str], str], Awaitable[None]]  # (payload, ids, topic)


class LiveKitOutputSink:
    """OutputSink プロトコル実装（翻訳音声=track / 字幕・イベント=data channel）。"""

    def __init__(
        self,
        *,
        user_language: dict[str, str],
        capture_audio: AudioCapture,
        send_data: DataSend,
        hearing_sample_rate: int = 24000,
    ) -> None:
        self._user_language = user_language
        self._capture_audio = capture_audio
        self._send_data = send_data
        self._hearing_sample_rate = hearing_sample_rate
        # 言語ごとに「直近 capture 済みオブジェクト」を保持し重複 capture を防ぐ。
        self._last_audio: dict[str, bytes] = {}

    async def deliver_audio(self, user_id: str, audio: bytes) -> None:
        """翻訳音声を受信者の目標言語トラックへ送る（言語単位で重複排除）。"""
        lang = self._user_language.get(user_id)
        if lang is None or not audio:
            return
        # 同一 payload（同一オブジェクト）は言語トラックへ 1 回だけ capture する。
        if self._last_audio.get(lang) is audio:
            return
        self._last_audio[lang] = audio

        # provider の出力は WAV ヘッダ付きのことがある（TTS / S2S とも）。
        # ヘッダを剥がし、ヘッダ記載の実レートで 48kHz へ変換する（欠陥 #2 付随）。
        pcm, rate = parse_wav16(audio, fallback_rate=self._hearing_sample_rate)
        pcm48 = resample16(pcm, rate, OUTPUT_SAMPLE_RATE)
        frames, _remainder = chunk16(pcm48, OUTPUT_FRAME_SAMPLES)
        for frame in frames:
            await self._capture_audio(lang, frame)

    async def deliver_subtitle(self, user_id: str, message: dict) -> None:
        """字幕を受信者宛てに data channel で配信する。"""
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
