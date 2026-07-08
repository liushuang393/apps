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

from app.audio.vad import SILERO_FRAME_MS, build_vad, resolve_backend
from app.config import settings
from app.rooms.manager import ParticipantPreference, room_manager
from app.webrtc.persistence import MeetingConfig, end_session, get_meeting_config
from app.webrtc.processor import SegmentProcessor
from app.webrtc.publisher import LiveKitPublisher
from app.webrtc.segmenter import SegmentEvent, SpeechSegmenter
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


def _build_default_processor() -> SegmentProcessor:
    """設定に応じて回放ログ・音声アーカイブを配線した SegmentProcessor を構築する。

    P3-D: enable_pipeline_event_log 有効時のみ回放ログを記録し、enable_audio_archive
    かつ鍵が有効な時のみ音声を暗号化アーカイブする。いずれも既定は安全側（記録あり・
    アーカイブなし）で、失敗はライブを壊さない。
    """
    record_fn = None
    if settings.enable_pipeline_event_log:
        from app.db.replay import record_pipeline_event

        record_fn = record_pipeline_event
    archive = None
    if settings.enable_audio_archive:
        from app.audio.archive import build_audio_archive

        archive = build_audio_archive()
    embedder = None
    identifier = None
    loader = None
    if settings.enable_diarization:
        from app.ai_pipeline.diarization import SpeakerIdentifier
        from app.audio.speaker_embedding import build_speaker_embedder
        from app.db.training import export_speaker_enrollments

        embedder = build_speaker_embedder()
        if embedder is not None:
            identifier = SpeakerIdentifier(
                match_threshold=settings.speaker_match_threshold,
                cluster_threshold=settings.speaker_cluster_threshold,
            )
            loader = export_speaker_enrollments
    return SegmentProcessor(
        audio_archive=archive,
        record_event_fn=record_fn,
        speaker_embedder=embedder,
        speaker_identifier=identifier,
        enrollment_loader=loader,
    )


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
        self._processor = processor or _build_default_processor()
        self._get_participants = get_participants or self._default_participants
        self._get_config = get_config or self._default_config
        self._room = room or rtc.Room()
        self._publisher: LiveKitPublisher | None = None
        self._tasks: set[asyncio.Task] = set()
        # 話者別の partial リビジョン（暫定字幕を単調増加で上書き。final でリセット）。
        self._partial_rev: dict[str, int] = {}

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
        # 退室者の partial リビジョンを破棄（残留防止＋再入室で 1 から再開させる）。
        self._partial_rev.pop(participant_id, None)
        remaining = await room_manager.remove_participant(self._room_id, participant_id)
        if remaining == 0:
            await end_session(self._room_id)
            # room が空になったら採番・重複排除状態を破棄する（改善点 M5）。
            self._processor.forget_room(self._room_id)

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
            # room が空になったら採番・重複排除状態を破棄する（改善点 M5）。
            self._processor.forget_room(self._room_id)
            self._partial_rev.clear()

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
        # VAD は設定に従い選択（既定 energy / silero 指定かつ導入時のみ Silero）。
        # Silero は RNN 状態を持つため話者トラック毎に独立インスタンスを注入する。
        # silero 有効時はフレーム長を窓長(32ms=512標本)へ整合し確率希釈を防ぐ。
        seg_kwargs: dict[str, object] = {"sample_rate": _AI_SAMPLE_RATE}
        if resolve_backend() == "silero":
            seg_kwargs["frame_ms"] = SILERO_FRAME_MS
        # partial 有効時のみ暫定字幕を切り出す（既定 0＝final のみ＝従来動作）。
        if settings.enable_partial_subtitles:
            seg_kwargs["partial_ms"] = settings.partial_ms
        segmenter = SpeechSegmenter(
            is_speech=build_vad(sample_rate=_AI_SAMPLE_RATE),
            **seg_kwargs,
        )
        queue: asyncio.Queue[SegmentEvent | None] = asyncio.Queue(
            maxsize=_SEGMENT_QUEUE_MAX
        )
        worker = asyncio.ensure_future(self._segment_worker(speaker_id, queue))
        try:
            async for event in stream:
                pcm = bytes(event.frame.data)
                # push_events は partial/final を返す（partial_ms=0 なら final のみ＝従来）。
                for seg_event in segmenter.push_events(pcm):
                    self._enqueue_segment(speaker_id, queue, seg_event)
        finally:
            # tail flush は finally 内で行い、正常終了・例外・キャンセルの全離脱
            # 経路で末尾発話を必ず emit する（改善点 M3）。flush 自身の失敗が
            # worker 回収を妨げないよう suppress する。
            with contextlib.suppress(Exception):
                tail = segmenter.flush()
                if tail:
                    self._enqueue_segment(speaker_id, queue, SegmentEvent(tail, False))
            await queue.put(None)  # 終端シグナル（worker を確実に畳む）
            await worker
            aclose = getattr(stream, "aclose", None)
            if aclose is not None:
                await aclose()

    def _enqueue_segment(
        self, speaker_id: str, queue: asyncio.Queue, event: SegmentEvent
    ) -> None:
        """キュー投入（過負荷保護）。partial は使い捨てのため満杯時は破棄する。
        final（確定発話）は必ず載せる（満杯時は最古を1件退避。単一 producer/
        consumer のため退避後は必ず空きができ新規 final は落ちない）。
        注: 有効化時、partial ASR は final と同一直列 worker を通るため過負荷時は
        final 遅延要因になり得る（既定 OFF。緩和は将来の partial 専用レーンで対応）。"""
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            if event.is_partial:
                # 暫定字幕は捨てても後続 partial/final が上書きするため破棄で良い。
                return
            with contextlib.suppress(asyncio.QueueEmpty):
                queue.get_nowait()
            logger.warning(
                "[Agent] 過負荷のため最古セグメントを破棄: speaker=%s", speaker_id
            )
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(event)

    async def _segment_worker(self, speaker_id: str, queue: asyncio.Queue) -> None:
        """話者ごとの直列ワーカー（発話順を保ちつつ ingest を塞がない）。"""
        while True:
            event = await queue.get()
            if event is None:
                return
            try:
                if event.is_partial:
                    await self._handle_partial(speaker_id, event.pcm)
                else:
                    await self._handle_segment(speaker_id, event.pcm)
            except Exception as e:  # noqa: BLE001
                logger.error(
                    "[Agent] セグメント処理エラー: speaker=%s err=%s", speaker_id, e
                )

    def _make_sink_factory(
        self, publisher: LiveKitPublisher
    ) -> Callable[[dict[str, str], str], LiveKitOutputSink]:
        """publisher を束ねた OutputSink ファクトリを返す（partial/final 共用）。"""

        def sink_factory(
            user_language: dict[str, str], seg_speaker_id: str
        ) -> LiveKitOutputSink:
            return LiveKitOutputSink(
                user_language=user_language,
                capture_audio=publisher.capture_segment,
                send_data=publisher.send_data,
                speaker_id=seg_speaker_id,
            )

        return sink_factory

    async def _handle_partial(self, speaker_id: str, pcm16: bytes) -> None:
        """確定前の暫定字幕（ASR 原文 interim）を配信する（§P2 首字遅延短縮）。"""
        publisher = self._publisher
        if publisher is None:
            return
        participants = await self._get_participants()
        speaker = participants.get(speaker_id)
        hint = speaker.native_language if speaker is not None else _DEFAULT_LANG
        rev = self._partial_rev.get(speaker_id, 0) + 1
        self._partial_rev[speaker_id] = rev
        await self._processor.process_partial(
            room_id=self._room_id,
            speaker_id=speaker_id,
            pcm16=pcm16,
            speaker_lang_hint=hint,
            participants=participants,
            sink_factory=self._make_sink_factory(publisher),
            revision=rev,
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
        # 発話確定でこの話者の partial リビジョンを畳む（前端は final で interim を消す）。
        self._partial_rev.pop(speaker_id, None)

        await self._processor.process(
            room_id=self._room_id,
            speaker_id=speaker_id,
            pcm16=pcm16,
            speaker_lang_hint=hint,
            participants=participants,
            sink_factory=self._make_sink_factory(publisher),
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
