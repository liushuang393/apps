"""
LiveKit 配信実体（Phase 3 C1）：翻訳音声トラックの遅延生成と data channel 送信。

LiveKitOutputSink は「(言語, 48k フレーム) を capture」「(payload, identities, topic)
を送信」という 2 つのコールバックのみに依存する。本モジュールはそれらを実 rtc.Room
に対して実装する薄い実体で、目標言語ごとに 1 本の翻訳音声トラックを遅延生成し、
字幕/イベントは local_participant の data channel で受信者 identity 宛てに送る。

設計:
    - 言語トラックは初回 capture 時に生成・publish（不要言語のトラックを作らない）。
    - sample_rate は LiveKitOutputSink の OUTPUT_SAMPLE_RATE（48kHz）に一致させる。
    - rtc 依存はこの実体に閉じ込め、Sink/Orchestrator は I/O 非依存のまま保つ。
"""

import asyncio
import logging

from livekit import rtc

from app.webrtc.sink import OUTPUT_SAMPLE_RATE

logger = logging.getLogger(__name__)

# 翻訳音声トラック名の接頭辞（フロントは name で言語トラックを振り分ける）。
TRACK_NAME_PREFIX = "translation-"
_NUM_CHANNELS = 1


class LiveKitPublisher:
    """目標言語ごとの翻訳音声トラックと data channel 送信を担う rtc 実体。"""

    def __init__(
        self, room: rtc.Room, *, sample_rate: int = OUTPUT_SAMPLE_RATE
    ) -> None:
        self._room = room
        self._sample_rate = sample_rate
        # 言語 -> AudioSource（publish 済みトラックの音声入力口）。
        self._sources: dict[str, rtc.AudioSource] = {}
        self._lock = asyncio.Lock()

    async def _get_source(self, language: str) -> rtc.AudioSource:
        """言語の AudioSource を取得（未作成ならトラックを生成・publish）。"""
        async with self._lock:
            source = self._sources.get(language)
            if source is not None:
                return source
            source = rtc.AudioSource(self._sample_rate, _NUM_CHANNELS)
            track = rtc.LocalAudioTrack.create_audio_track(
                f"{TRACK_NAME_PREFIX}{language}", source
            )
            options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
            await self._room.local_participant.publish_track(track, options)
            self._sources[language] = source
            logger.info("[Publisher] 翻訳音声トラック publish: lang=%s", language)
            return source

    async def capture_audio(self, language: str, frame: bytes) -> None:
        """48k int16 モノの 1 フレームを当該言語トラックへ capture する。"""
        if not frame:
            return
        source = await self._get_source(language)
        samples_per_channel = len(frame) // (2 * _NUM_CHANNELS)
        audio_frame = rtc.AudioFrame(
            frame, self._sample_rate, _NUM_CHANNELS, samples_per_channel
        )
        await source.capture_frame(audio_frame)

    async def send_data(
        self, payload: bytes, identities: list[str], topic: str
    ) -> None:
        """字幕/イベント payload を受信者 identity 宛てに data channel で送る。"""
        await self._room.local_participant.publish_data(
            payload, reliable=True, destination_identities=identities, topic=topic
        )
