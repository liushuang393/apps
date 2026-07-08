"""
LiveKit 配信実体（Phase 3 C1）：翻訳音声トラックの遅延生成と data channel 送信。

トラックは (話者, 目標言語) 単位で分離する。共有トラックでは同時発話のフレームが
交互に混入して破綻し（欠陥 #3）、話者本人の除外も不可能（欠陥 #6: エコー）なため。
capture はキー単位の Lock で 1 セグメントずつ原子的に行う。
"""

import asyncio
import logging

from livekit import rtc

from app.audio.pcm import chunk16
from app.webrtc.sink import OUTPUT_SAMPLE_RATE

logger = logging.getLogger(__name__)

# 翻訳音声トラック名: translation-{lang}-{speaker}（フロントは name で振り分ける）
TRACK_NAME_PREFIX = "translation-"
_NUM_CHANNELS = 1
FRAME_MS = 10
_FRAME_SAMPLES = OUTPUT_SAMPLE_RATE * FRAME_MS // 1000  # 480 標本/10ms


class LiveKitPublisher:
    """(話者×言語) の翻訳音声トラックと data channel 送信を担う rtc 実体。"""

    def __init__(
        self, room: rtc.Room, *, sample_rate: int = OUTPUT_SAMPLE_RATE
    ) -> None:
        self._room = room
        self._sample_rate = sample_rate
        # (speaker_id, language) -> AudioSource（publish 済みトラックの入力口）
        self._sources: dict[tuple[str, str], rtc.AudioSource] = {}
        # (speaker_id, language) -> セグメント直列化用ロック
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}
        self._create_lock = asyncio.Lock()

    async def _get_source(self, speaker_id: str, language: str) -> rtc.AudioSource:
        """(話者, 言語) の AudioSource を取得（未作成ならトラックを生成・publish）。

        publish_track はネットワーク待ちを伴うため、既存キーの高速経路では
        _create_lock を握らない（他話者/言語の capture_segment を止めないため）。
        未作成の場合のみロックを取得し、ロック待ち中に他コルーチンが同じキーを
        publish 済みにしていないか再確認する（double-checked locking）。
        """
        key = (speaker_id, language)
        source = self._sources.get(key)
        if source is not None:
            return source
        async with self._create_lock:
            source = self._sources.get(key)
            if source is not None:
                return source
            source = rtc.AudioSource(self._sample_rate, _NUM_CHANNELS)
            track = rtc.LocalAudioTrack.create_audio_track(
                f"{TRACK_NAME_PREFIX}{language}-{speaker_id}", source
            )
            options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
            await self._room.local_participant.publish_track(track, options)
            self._sources[key] = source
            self._locks[key] = asyncio.Lock()
            logger.info(
                "[Publisher] 翻訳音声トラック publish: lang=%s speaker=%s",
                language,
                speaker_id,
            )
            return source

    async def capture_segment(
        self, speaker_id: str, language: str, pcm48: bytes
    ) -> None:
        """48k int16 モノの 1 セグメントを当該トラックへ原子的に capture する。"""
        if not pcm48:
            return
        source = await self._get_source(speaker_id, language)
        lock = self._locks[(speaker_id, language)]
        frames, _remainder = chunk16(pcm48, _FRAME_SAMPLES)
        async with lock:
            for frame in frames:
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
