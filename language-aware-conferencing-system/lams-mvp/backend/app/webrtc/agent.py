"""
LiveKit Agent Worker（Phase 3 C1-5）：音声フォーク Gateway の rtc 配線。

README §0「2 主線を混ぜない／フォークは音声複製のみ／収束は Output Manager と DB
のみ」を rtc 層で実体化する単一の住処。room へサーバ参加者として接続し、各話者の
購読トラックを 16kHz モノ PCM へ整え（AudioStream が内部リサンプル）、
IngressPipeline へ frame／end／cancel を渡す adapter に限定する。
取り込み政策（VAD／Queue／worker／soft-hard）は pipeline が所有する。
配信は LiveKitPublisher 経由（翻訳音声=track / 字幕=data channel）。

設計原則:
    - rtc 依存はこのモジュールに閉じ込める。収束ロジックは processor へ委譲。
    - 受聴者設定は participant attributes を room_manager へ同期して取得する
      （WS 廃止後の preference 供給路）。participants/config は注入可能（テスト用）。
"""

import asyncio
import contextlib
import json
import logging
from collections.abc import Awaitable, Callable

from livekit import rtc

from app.ai_pipeline.qoe import QoEInput, QoEScope, QoEStateMachine
from app.ai_pipeline.revision_authority import (
    RevisionAuthority,
    RevisionStreamKey,
    RevisionToken,
    StreamKind,
    get_revision_authority,
)
from app.config import settings
from app.rooms.manager import ParticipantPreference, room_manager
from app.webrtc.ingress_pipeline import IngressPipeline
from app.webrtc.persistence import MeetingConfig, end_session, get_meeting_config
from app.webrtc.processor import SegmentProcessor
from app.webrtc.publisher import LiveKitPublisher
from app.webrtc.sink import LiveKitOutputSink
from app.webrtc.token import create_join_token

logger = logging.getLogger(__name__)

# AI 主線の入力サンプルレート（AudioStream にこの値を要求し内部リサンプルさせる）。
_AI_SAMPLE_RATE = 16000
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
        revision_authority: RevisionAuthority | None = None,
    ) -> None:
        self._room_id = room_id
        self._processor = processor or _build_default_processor()
        self._get_participants = get_participants or self._default_participants
        self._get_config = get_config or self._default_config
        self._room = room or rtc.Room()
        self._publisher: LiveKitPublisher | None = None
        self._tasks: set[asyncio.Task] = set()
        # Ingress／Runtime 共有の暫定字幕 revision 権威
        self._revision_authority = revision_authority or get_revision_authority()
        # 話者ごとの進行中 partial utterance（空 id を恒久 key にしない）
        self._partial_utterances: dict[str, str] = {}
        # 話者別 IngressPipeline（取り込み政策の所有は pipeline 側）。
        self._pipelines: dict[str, IngressPipeline] = {}
        self._speaker_overloaded: dict[str, bool] = {}
        self._provider_recovering: dict[str, bool] = {}
        self._qoe_by_speaker: dict[str, QoEStateMachine] = {}

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

        @self._room.on("data_received")
        def _on_data(data_packet) -> None:  # noqa: ANN001
            self._spawn(self._handle_qoe_stats(data_packet))

        @self._room.on("disconnected")
        def _on_disc(*_args) -> None:
            self._spawn(self._finalize_if_room_empty())
            disconnected.set()

    async def _handle_qoe_stats(self, data_packet: rtc.DataPacket) -> None:
        """クライアント集約の WebRTC 品質値を受理する（検証のみ）。

        packet loss による受聴者単位の mute/回復は前端の ListenerLocalQoE
        （backend LISTENER_LOCAL と同一政策）が行う。サーバは全員一括の
        Mode A 停止に使わず、不正 payload の検証のみ行う。
        """
        if data_packet.topic != "qoe_stats":
            return
        participant = data_packet.participant
        if participant is None:
            return
        try:
            payload = json.loads(bytes(data_packet.data).decode("utf-8"))
            loss = payload.get("packet_loss_ratio")
            if loss is not None and not (
                isinstance(loss, (int, float)) and 0 <= float(loss) <= 1
            ):
                logger.warning(
                    "[Agent] 不正な QoE Stats を無視: speaker=%s",
                    participant.identity,
                )
        except (AttributeError, UnicodeDecodeError, json.JSONDecodeError, TypeError):
            logger.warning(
                "[Agent] 不正な QoE Stats を無視: speaker=%s",
                participant.identity,
            )

    async def _handle_participant_leave(self, participant_id: str) -> None:
        """参加者退室後、最後の1人なら session を終了する。"""
        # 退室者の revision／partial utterance を破棄（残留防止＋再入室で新 stream）。
        self._partial_utterances.pop(participant_id, None)
        self._revision_authority.release_speaker(self._room_id, participant_id)
        self._qoe_by_speaker.pop(participant_id, None)
        self._speaker_overloaded.pop(participant_id, None)
        self._provider_recovering.pop(participant_id, None)
        # 取り込み worker／Queue を速やかに閉じ zombie task を残さない。
        pipeline = self._pipelines.pop(participant_id, None)
        if pipeline is not None:
            await pipeline.cancel()
        await self._processor.release_speaker(self._room_id, participant_id)
        remaining = await room_manager.remove_participant(self._room_id, participant_id)
        if remaining == 0:
            await end_session(self._room_id)
            # room が空になったら採番・重複排除状態を破棄する（改善点 M5）。
            self._processor.forget_room(self._room_id)

    async def _finalize_if_room_empty(self) -> None:
        """Agent 切断時に人間参加者が残っていなければ session を閉じる。"""
        await self._processor.release_room(self._room_id)
        self._revision_authority.release_room(self._room_id)
        self._partial_utterances.clear()
        self._qoe_by_speaker.clear()
        self._speaker_overloaded.clear()
        self._provider_recovering.clear()
        # 残留 pipeline を cancel してから辞書を空にする。
        pending = list(self._pipelines.values())
        self._pipelines.clear()
        for pipeline in pending:
            await pipeline.cancel()
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

    async def _sync_participant(self, participant: rtc.RemoteParticipant) -> None:
        """participant attributes を room_manager の preference へ反映する。"""
        attrs = dict(participant.attributes)
        await room_manager.add_participant(
            room_id=self._room_id,
            user_id=participant.identity,
            display_name=participant.name or participant.identity,
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
        for participant in self._room.remote_participants.values():
            await self._sync_participant(participant)

    async def _ingest(
        self, track: rtc.RemoteAudioTrack, participant: rtc.RemoteParticipant
    ) -> None:
        """1 話者トラックを 16kHz モノで購読し Ingress pipeline へ渡す。

        本メソッドは rtc frame → PCM 変換と pipeline lifecycle（登録／end／解除）
        に限定する。VAD／Queue／worker／soft-hard は create_default が所有する。
        """
        speaker_id = participant.identity
        stream = rtc.AudioStream(track, sample_rate=_AI_SAMPLE_RATE, num_channels=1)

        async def on_final(pcm: bytes) -> None:
            await self._handle_segment(speaker_id, pcm)

        async def on_partial(pcm: bytes) -> None:
            await self._handle_partial(speaker_id, pcm)

        def on_overload(overloaded: bool) -> None:
            # QoE 権威へ渡す overload 事実のみ更新する（縮退判定はここでは行わない）。
            self._speaker_overloaded[speaker_id] = overloaded

        # 確定発話の受理時点では聞く主線を無効化しない。受理は「queue へ積んだ」
        # 合図であり、直前発話の聞く主線（ASR+MT+TTS で数秒）はまだ生成中である。
        # ここで世代を無効化すると、まだ誰も聞いていない翻訳音声が毎発話破棄され、
        # 連続発話では翻訳音声が一切届かなくなる。配信済み／配信中音声に対する
        # barge-in は publisher の GenerationGate がフレーム単位で担う。
        pipeline = IngressPipeline.create_default(
            on_final=on_final,
            on_partial=on_partial,
            on_overload=on_overload,
            sample_rate=_AI_SAMPLE_RATE,
        )
        self._pipelines[speaker_id] = pipeline
        try:
            async for event in stream:
                pipeline.push_frame(bytes(event.frame.data))
        finally:
            # 正常終了・例外・キャンセルの全離脱で tail flush と worker 回収を行う。
            # 退室側で既に cancel 済みなら end は冪等に閉じる。
            with contextlib.suppress(Exception):
                await pipeline.end()
            if self._pipelines.get(speaker_id) is pipeline:
                self._pipelines.pop(speaker_id, None)
            with contextlib.suppress(AttributeError):
                await stream.aclose()

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
                generation_gate=publisher.generation_gate,
            )

        return sink_factory

    def report_provider_recovering(self, speaker_id: str, recovering: bool) -> None:
        """Runtime 再接続などの Provider 状態を QoE 向け観測として記録する。"""
        if recovering:
            self._provider_recovering[speaker_id] = True
        else:
            self._provider_recovering.pop(speaker_id, None)

    def _evaluate_server_qoe(self, speaker_id: str):
        """Ingress / AI / Provider の事実を QoE 権威へ渡し server decision を得る。"""
        machine = self._qoe_by_speaker.setdefault(speaker_id, QoEStateMachine())
        provider_recovering = self._provider_recovering.get(
            speaker_id, False
        ) or self._processor.is_provider_recovering(speaker_id)
        return machine.evaluate(
            QoEInput(
                queue_overloaded=self._speaker_overloaded.get(speaker_id, False),
                hearing_degraded=self._processor.hearing_p95_exceeded(),
                provider_recovering=provider_recovering,
                scope=QoEScope.SERVER,
            )
        )

    def _next_partial_token(self, speaker_id: str) -> RevisionToken:
        """partial ASR 用に同一 authority から次 revision token を取得する。

        入力:
            speaker_id: 話者 identity。
        出力:
            PARTIAL_ASR stream の RevisionToken。
        注意:
            空の temporary id は使わず、発話開始時に begin で安定 id を割り当てる。
        """
        utterance_id = self._partial_utterances.get(speaker_id)
        if utterance_id is None:
            utterance_id = self._revision_authority.begin(self._room_id, speaker_id)
            self._partial_utterances[speaker_id] = utterance_id
        return self._revision_authority.advance(
            self._room_id,
            speaker_id,
            utterance_id,
            RevisionStreamKey(kind=StreamKind.PARTIAL_ASR),
        )

    def _finalize_partial_utterance(self, speaker_id: str) -> None:
        """発話確定時に partial stream を finalize し、進行中 utterance を畳む。"""
        utterance_id = self._partial_utterances.pop(speaker_id, None)
        if utterance_id is None:
            return
        self._revision_authority.finalize(
            self._room_id,
            speaker_id,
            utterance_id,
            RevisionStreamKey(kind=StreamKind.PARTIAL_ASR),
        )

    async def _handle_partial(self, speaker_id: str, pcm16: bytes) -> None:
        """確定前の暫定字幕（ASR 原文 interim）を配信する（§P2 首字遅延短縮）。"""
        publisher = self._publisher
        if publisher is None:
            return
        qoe = self._evaluate_server_qoe(speaker_id)
        if not qoe.partial_available:
            return
        participants = await self._get_participants()
        speaker = participants.get(speaker_id)
        hint = speaker.native_language if speaker is not None else _DEFAULT_LANG
        token = self._next_partial_token(speaker_id)
        await self._processor.process_partial(
            room_id=self._room_id,
            speaker_id=speaker_id,
            pcm16=pcm16,
            speaker_lang_hint=hint,
            participants=participants,
            sink_factory=self._make_sink_factory(publisher),
            revision=token.revision,
            subtitle_id=token.utterance_id,
            revision_authority=self._revision_authority,
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
        # 発話確定でこの話者の partial stream を畳む（前端は final で interim を消す）。
        self._finalize_partial_utterance(speaker_id)

        qoe = self._evaluate_server_qoe(speaker_id)
        await self._processor.process(
            room_id=self._room_id,
            speaker_id=speaker_id,
            pcm16=pcm16,
            speaker_lang_hint=hint,
            participants=participants,
            sink_factory=self._make_sink_factory(publisher),
            config=config,
            hearing_available=qoe.hearing_available,
            qoe_state=qoe.state.value,
            qoe_changed=qoe.changed,
            qoe_reason=qoe.primary_reason.value if qoe.primary_reason else None,
            qoe_ui_reason=qoe.ui_reason.value,
            qoe_decision=qoe,
        )
        # 発話処理後の Runtime 観測を次発話の QoE input へ反映する
        self.report_provider_recovering(
            speaker_id, self._processor.is_provider_recovering(speaker_id)
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
