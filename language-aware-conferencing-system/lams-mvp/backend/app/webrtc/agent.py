"""
LiveKit Agent Worker（Phase 3 C1-5）：音声フォーク Gateway の rtc 配線。

README §0「2 主線を混ぜない／フォークは音声複製のみ／収束は Output Manager と DB
のみ」を rtc 層で実体化する単一の住処。room へサーバ参加者として接続し、各話者の
購読トラックを 16kHz モノへ整え（AudioStream が内部リサンプル）、SpeechSegmenter
で発話単位に切り、SegmentProcessor（transport 非依存）へ渡して 2 主線を駆動する。
配信は LiveKitPublisher 経由（翻訳音声=track / 字幕=data channel）。

設計原則:
    - rtc 依存はこのモジュールに閉じ込める。収束ロジックは processor へ委譲。
    - 受聴者設定は participant attributes を room_manager へ同期して取得する
      （WS 廃止後の preference 供給路）。participants/config は注入可能（テスト用）。
"""

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable

from livekit import rtc

from app.config import settings
from app.rooms.manager import ParticipantPreference, room_manager
from app.webrtc.persistence import MeetingConfig, end_session, get_meeting_config
from app.webrtc.processor import SegmentProcessor
from app.webrtc.publisher import LiveKitPublisher
from app.webrtc.segmenter import SpeechSegmenter
from app.webrtc.sink import LiveKitOutputSink
from app.webrtc.token import create_join_token

logger = logging.getLogger(__name__)

# AI 主線の入力サンプルレート（AudioStream にこの値を要求し内部リサンプルさせる）。
_AI_SAMPLE_RATE = 16000
# 話者別セグメントキューの上限（過負荷時は最古を破棄して遅延暴走を防ぐ）。
_SEGMENT_QUEUE_MAX = 8
# preference 未供給時の話者既定言語（言語検出のヒントに使う）。
_DEFAULT_LANG = "ja"
# participant attributes のキー（フロントが join 時に設定する preference）。
_ATTR_NATIVE = "native_language"
_ATTR_AUDIO_MODE = "audio_mode"
_ATTR_TARGET = "target_language"
_ATTR_SUBTITLE = "subtitle_enabled"

ParticipantsProvider = Callable[[], Awaitable[dict[str, ParticipantPreference]]]
ConfigProvider = Callable[[], Awaitable[MeetingConfig]]


class LiveKitAgent:
    """room の音声を購読し発話単位で 2 主線を駆動する rtc Agent（収束は processor）。"""

    def __init__(
        self,
        room_id: str,
        *,
        processor: SegmentProcessor | None = None,
        get_participants: ParticipantsProvider | None = None,
        get_config: ConfigProvider | None = None,
        room: rtc.Room | None = None,
    ) -> None:
        self._room_id = room_id
        self._processor = processor or SegmentProcessor()
        self._get_participants = get_participants or self._default_participants
        self._get_config = get_config or self._default_config
        self._room = room or rtc.Room()
        self._publisher: LiveKitPublisher | None = None
        self._tasks: set[asyncio.Task] = set()

    async def _default_participants(self) -> dict[str, ParticipantPreference]:
        """既定の受聴者供給（room_manager / Redis）。"""
        return await room_manager.get_participants(self._room_id)

    async def _default_config(self) -> MeetingConfig:
        """既定の会議設定供給（DB）。"""
        return await get_meeting_config(self._room_id)

    def _spawn(self, coro: Awaitable[None]) -> None:
        """非同期処理を追跡付きで起動する（例外はログ、GC 防止）。"""
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._on_task_done)

    def _on_task_done(self, task: asyncio.Task) -> None:
        """完了タスクを集合から外し、例外があればログする。"""
        self._tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.error("[Agent] タスクエラー: %s", task.exception())

    async def run(self, url: str, token: str) -> None:
        """room へ接続し、disconnect まで購読・処理を継続する。"""
        self._publisher = LiveKitPublisher(self._room)
        disconnected = asyncio.Event()
        self._register_handlers(disconnected)
        await self._room.connect(url, token)
        await self._sync_existing_participants()
        logger.info("[Agent] 接続完了: room=%s", self._room_id)
        await disconnected.wait()
        logger.info("[Agent] 切断: room=%s", self._room_id)

    def _register_handlers(self, disconnected: asyncio.Event) -> None:
        """rtc イベントハンドラを登録する（同期 → 追跡タスクへ委譲）。"""

        @self._room.on("track_subscribed")
        def _on_track(track, _publication, participant) -> None:  # noqa: ANN001
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                self._spawn(self._ingest(track, participant))

        @self._room.on("participant_connected")
        def _on_join(participant) -> None:  # noqa: ANN001
            self._spawn(self._sync_participant(participant))

        @self._room.on("participant_attributes_changed")
        def _on_attrs(_changed, participant) -> None:  # noqa: ANN001
            self._spawn(self._sync_participant(participant))

        @self._room.on("participant_disconnected")
        def _on_leave(participant) -> None:  # noqa: ANN001
            self._spawn(self._handle_participant_leave(participant.identity))

        @self._room.on("disconnected")
        def _on_disc(*_args) -> None:
            self._spawn(self._finalize_if_room_empty())
            disconnected.set()

    async def _handle_participant_leave(self, participant_id: str) -> None:
        """参加者退室後、最後の1人なら session を終了する。"""
        remaining = await room_manager.remove_participant(self._room_id, participant_id)
        if remaining == 0:
            await end_session(self._room_id)

    async def _finalize_if_room_empty(self) -> None:
        """Agent 切断時に人間参加者が残っていなければ session を閉じる。"""
        try:
            remaining = await room_manager.count_participants(self._room_id)
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[Agent] 退室後参加者数の確認に失敗: room=%s err=%s", self._room_id, e
            )
            return
        if remaining == 0:
            await end_session(self._room_id)

    async def _sync_participant(self, participant) -> None:  # noqa: ANN001
        """participant attributes を room_manager の preference へ反映する。"""
        attrs = dict(getattr(participant, "attributes", {}) or {})
        await room_manager.add_participant(
            room_id=self._room_id,
            user_id=participant.identity,
            display_name=getattr(participant, "name", "") or participant.identity,
            native_language=attrs.get(_ATTR_NATIVE) or _DEFAULT_LANG,
            audio_mode=attrs.get(_ATTR_AUDIO_MODE) or "original",
            subtitle_enabled=attrs.get(_ATTR_SUBTITLE, "true") != "false",
        )
        target = attrs.get(_ATTR_TARGET)
        if target:
            await room_manager.update_preference(
                self._room_id, participant.identity, target_language=target
            )

    async def _sync_existing_participants(self) -> None:
        """接続時点ですでに room にいる参加者を初期同期する。"""
        remote_participants = getattr(self._room, "remote_participants", {}) or {}
        for participant in remote_participants.values():
            await self._sync_participant(participant)

    async def _ingest(self, track, participant) -> None:  # noqa: ANN001
        """1 話者トラックを 16kHz モノで購読し、発話単位に切り出して処理する。

        セグメント処理はワーカーへ委譲し、フレーム消費を塞がない（欠陥 #11）。
        """
        speaker_id = participant.identity
        stream = rtc.AudioStream(track, sample_rate=_AI_SAMPLE_RATE, num_channels=1)
        segmenter = SpeechSegmenter(sample_rate=_AI_SAMPLE_RATE)
        queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=_SEGMENT_QUEUE_MAX)
        worker = asyncio.ensure_future(self._segment_worker(speaker_id, queue))
        try:
            async for event in stream:
                pcm = bytes(event.frame.data)
                for segment in segmenter.push(pcm):
                    self._enqueue_segment(speaker_id, queue, segment)
            tail = segmenter.flush()
            if tail:
                self._enqueue_segment(speaker_id, queue, tail)
        finally:
            await queue.put(None)  # 終端シグナル（worker を確実に畳む）
            await worker
            aclose = getattr(stream, "aclose", None)
            if aclose is not None:
                await aclose()

    def _enqueue_segment(
        self, speaker_id: str, queue: asyncio.Queue, segment: bytes
    ) -> None:
        """キュー満杯時は最古を破棄して新しい発話を優先する（過負荷保護）。"""
        try:
            queue.put_nowait(segment)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                queue.get_nowait()
            logger.warning(
                "[Agent] 過負荷のため最古セグメントを破棄: speaker=%s", speaker_id
            )
            queue.put_nowait(segment)

    async def _segment_worker(self, speaker_id: str, queue: asyncio.Queue) -> None:
        """話者ごとの直列ワーカー（発話順を保ちつつ ingest を塞がない）。"""
        while True:
            segment = await queue.get()
            if segment is None:
                return
            try:
                await self._handle_segment(speaker_id, segment)
            except Exception as e:  # noqa: BLE001
                logger.error(
                    "[Agent] セグメント処理エラー: speaker=%s err=%s", speaker_id, e
                )

    async def _handle_segment(self, speaker_id: str, pcm16: bytes) -> None:
        """1 発話セグメントを SegmentProcessor へ渡し 2 主線を駆動する。"""
        publisher = self._publisher
        if publisher is None:
            return
        participants = await self._get_participants()
        speaker = participants.get(speaker_id)
        hint = speaker.native_language if speaker is not None else _DEFAULT_LANG
        config = await self._get_config()

        def sink_factory(
            user_language: dict[str, str], seg_speaker_id: str
        ) -> LiveKitOutputSink:
            return LiveKitOutputSink(
                user_language=user_language,
                capture_audio=publisher.capture_segment,
                send_data=publisher.send_data,
                speaker_id=seg_speaker_id,
            )

        await self._processor.process(
            room_id=self._room_id,
            speaker_id=speaker_id,
            pcm16=pcm16,
            speaker_lang_hint=hint,
            participants=participants,
            sink_factory=sink_factory,
            config=config,
        )


async def run_agent(
    room_id: str,
    *,
    identity: str = "lams-agent",
    display_name: str = "LAMS Agent",
) -> None:
    """Agent をサーバ参加者として room へ接続して常駐させる（worker 本体）。"""
    token = create_join_token(
        room_id=room_id,
        identity=identity,
        display_name=display_name,
        can_publish=True,
    )
    await LiveKitAgent(room_id).run(settings.livekit_url, token)


def main() -> None:
    """CLI/worker エントリ（room id は argv または LAMS_AGENT_ROOM から取得）。"""
    import os
    import sys

    logging.basicConfig(level=logging.INFO)
    room_id = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("LAMS_AGENT_ROOM")
    if not room_id:
        raise SystemExit("room id を argv[1] または LAMS_AGENT_ROOM で指定してください")
    asyncio.run(run_agent(room_id))


if __name__ == "__main__":
    main()
