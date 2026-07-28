"""
DefaultOutputManager — 型付き出力命令のポリシー評価と配信。

目的:
    受聴者設定・話者除外・同一言語抑止・世代ゲート・interim 終了を一貫処理し、
    canonical encoder 経由で transport adapter へ渡す。
入力 / 出力:
    handle(command) -> DeliveryReport（配信・抑止・失敗の観測結果）。
注意:
    QoE は decision フラグを消費するのみ。transport 固有変換は adapter 側。
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from app.ai_pipeline.events import encode_event, envelope_event
from app.ai_pipeline.output_manager.adapter import (
    TOPIC_EVENT,
    TOPIC_SUBTITLE,
    TransportAdapter,
)
from app.ai_pipeline.output_manager.commands import (
    FinalSubtitleCommand,
    InterimSubtitleCommand,
    ListenerRef,
    OutputCommand,
    QualityEventCommand,
    TranslatedAudioCommand,
)
from app.ai_pipeline.qoe import QoEState
from app.ai_pipeline.revision_authority import (
    RevisionAuthority,
    RevisionStreamKey,
    RevisionToken,
    RevisionUnknownError,
    StreamKind,
)

logger = logging.getLogger(__name__)


class GenerationGate(Protocol):
    """旧 generation 抑止に必要な最小契約。"""

    def should_capture(self, generation_id: int) -> bool:
        """当該世代の音声を配信してよいか。"""


@dataclass(frozen=True)
class Suppression:
    """ポリシーにより抑止された配信の理由記録。"""

    reason: str
    user_id: str | None = None
    channel: str | None = None


@dataclass(frozen=True)
class DeliveryFailure:
    """個別受信者への送信失敗（他受信者には影響しない）。"""

    user_id: str
    channel: str
    error: str


@dataclass
class DeliveryReport:
    """1 命令処理の観測結果。"""

    suppressed: list[Suppression] = field(default_factory=list)
    failures: list[DeliveryFailure] = field(default_factory=list)
    delivered_revisions: tuple[int, ...] = ()


class OutputManager(Protocol):
    """クライアント向け出力の単一公開 interface。"""

    async def handle(self, command: OutputCommand) -> DeliveryReport:
        """型付き出力命令を評価し、adapter 経由で配信する。"""


def _base_lang(code: str) -> str:
    """言語タグから基底コードを取り出す。"""
    return (code or "").split("-")[0]


def _qoe_event_type(state: QoEState) -> str:
    """QoE 状態をクライアント向けイベント種別へ写像する（再計算なし）。"""
    if state is QoEState.HEALTHY:
        return "qoe_recovered"
    if state is QoEState.QUEUE_OVERLOAD:
        return "overload_degraded"
    return "qoe_degraded"


class DefaultOutputManager:
    """受聴者ポリシーとイベント契約を束ねる Output Manager 実装。"""

    def __init__(
        self,
        *,
        adapter: TransportAdapter,
        generation_gate: GenerationGate | None = None,
        revision_authority: RevisionAuthority | None = None,
    ) -> None:
        self._adapter = adapter
        self._generation_gate = generation_gate
        # 注入時のみ accept／finalize。未注入でも command.revision は再採番しない。
        self._revision_authority = revision_authority

    async def handle(self, command: OutputCommand) -> DeliveryReport:
        """型付き出力命令を処理し、配信結果を返す。"""
        if isinstance(command, FinalSubtitleCommand):
            return await self._handle_final_subtitle(command)
        if isinstance(command, InterimSubtitleCommand):
            return await self._handle_interim(command)
        if isinstance(command, TranslatedAudioCommand):
            return await self._handle_audio(command)
        if isinstance(command, QualityEventCommand):
            return await self._handle_quality(command)
        raise TypeError(f"未対応の出力命令です: {type(command)!r}")

    async def _handle_final_subtitle(
        self, command: FinalSubtitleCommand
    ) -> DeliveryReport:
        """確定字幕を購読者へ配信し、対象 hearing stream を finalize する。"""
        report = DeliveryReport()
        event = self._build_final_subtitle_event(command)
        await self._fanout_data(
            listeners=command.listeners,
            topic=TOPIC_SUBTITLE,
            event=event,
            channel="subtitle",
            report=report,
            require_subtitle=True,
        )
        self._finalize_hearing_stream(command)
        return report

    async def _handle_interim(self, command: InterimSubtitleCommand) -> DeliveryReport:
        """暫定字幕を authority 発行 revision のまま配信する（再採番しない）。"""
        report = DeliveryReport()
        if not command.text:
            return report
        if self._revision_authority is not None:
            token = self._token_from_interim_command(command)
            if not self._revision_authority.accept(token):
                report.suppressed.append(
                    Suppression(
                        reason="stale_or_finalized_revision",
                        channel="interim",
                    )
                )
                return report
        revision = command.revision
        event = envelope_event(
            {
                "type": "subtitle_interim",
                "id": command.subtitle_id,
                "seq": command.seq,
                "speaker_id": command.speaker_id,
                "text": command.text,
                "is_final": False,
            },
            room_id=command.room_id,
            speaker_id=command.speaker_id,
            utterance_id=command.subtitle_id,
            generation_id=command.generation_id,
            sequence_id=command.seq,
            revision=revision,
        )
        await self._fanout_data(
            listeners=command.listeners,
            topic=TOPIC_SUBTITLE,
            event=event,
            channel="interim",
            report=report,
            require_subtitle=True,
        )
        report.delivered_revisions = (revision,)
        return report

    def _finalize_hearing_stream(self, command: FinalSubtitleCommand) -> None:
        """確定字幕の目標言語 hearing stream を authority 上で finalize する。"""
        auth = self._revision_authority
        if auth is None:
            return
        stream = RevisionStreamKey(
            kind=StreamKind.HEARING_TRANSCRIPT,
            language=command.target_language,
        )
        try:
            auth.finalize(
                command.room_id,
                command.speaker_id,
                command.subtitle_id,
                stream,
            )
        except RevisionUnknownError:
            # interim 未発行の発話では finalize 対象が無い
            return

    @staticmethod
    def _token_from_interim_command(command: InterimSubtitleCommand) -> RevisionToken:
        """InterimSubtitleCommand から accept 用 RevisionToken を復元する。"""
        kind = StreamKind(command.stream_kind)
        language = (
            command.target_language if kind is StreamKind.HEARING_TRANSCRIPT else ""
        )
        return RevisionToken(
            room_id=command.room_id,
            speaker_id=command.speaker_id,
            utterance_id=command.subtitle_id,
            stream_key=RevisionStreamKey(kind=kind, language=language),
            revision=command.revision,
        )

    async def _handle_audio(self, command: TranslatedAudioCommand) -> DeliveryReport:
        """翻訳音声を話者除外・同一言語・世代ゲートで評価して publish する。"""
        report = DeliveryReport()
        if not command.audio:
            report.suppressed.append(Suppression(reason="empty_audio", channel="audio"))
            return report

        if _base_lang(command.source_language) == _base_lang(command.target_language):
            report.suppressed.append(
                Suppression(reason="same_language", channel="audio")
            )
            return report

        gate = self._generation_gate
        if gate is not None and not gate.should_capture(command.generation_id):
            report.suppressed.append(
                Suppression(reason="stale_generation", channel="audio")
            )
            return report

        recipients = [
            ls.user_id
            for ls in command.listeners
            if ls.wants_audio
            and ls.user_id != command.speaker_id
            and _base_lang(ls.target_language) == _base_lang(command.target_language)
        ]
        for ls in command.listeners:
            if not ls.wants_audio:
                report.suppressed.append(
                    Suppression(
                        reason="audio_disabled",
                        user_id=ls.user_id,
                        channel="audio",
                    )
                )
            elif ls.user_id == command.speaker_id:
                report.suppressed.append(
                    Suppression(
                        reason="speaker_echo",
                        user_id=ls.user_id,
                        channel="audio",
                    )
                )

        if not recipients:
            return report

        try:
            await self._adapter.publish_audio(
                speaker_id=command.speaker_id,
                language=command.target_language,
                audio=command.audio,
                recipient_ids=recipients,
                generation_id=command.generation_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[OutputManager] 音声 publish 失敗(lang=%s): %s",
                command.target_language,
                exc,
            )
            for user_id in recipients:
                report.failures.append(
                    DeliveryFailure(
                        user_id=user_id,
                        channel="audio",
                        error=str(exc),
                    )
                )
        return report

    async def _handle_quality(self, command: QualityEventCommand) -> DeliveryReport:
        """QoE decision フラグを消費して品質イベントを配信する。"""
        report = DeliveryReport()
        decision = command.decision
        # 変更なしかつ聞く主線が利用可能なら配信しない（再計算はしない）
        if (
            decision.state is QoEState.HEALTHY
            and not decision.changed
            and decision.hearing_available
        ):
            report.suppressed.append(
                Suppression(reason="qoe_unchanged_healthy", channel="event")
            )
            return report

        recovered = decision.state is QoEState.HEALTHY
        # orchestrator と同様、回復時のみ fallback=False（decision の state を消費）
        should_fallback = not recovered

        payload: dict[str, object] = {
            "type": _qoe_event_type(decision.state),
            "metric": decision.state.value,
            "mainline": "hearing",
            "should_fallback_to_subtitle": should_fallback,
        }
        if decision.primary_reason is not None:
            payload["reason_code"] = decision.primary_reason.value
        if decision.ui_reason is not None:
            payload["ui_reason"] = decision.ui_reason.value

        event = envelope_event(
            payload,
            room_id=command.room_id,
            speaker_id=command.speaker_id,
            utterance_id=command.utterance_id,
            generation_id=command.generation_id,
            sequence_id=command.seq,
        )
        await self._fanout_data(
            listeners=command.listeners,
            topic=TOPIC_EVENT,
            event=event,
            channel="event",
            report=report,
            require_subtitle=False,
        )
        return report

    def _build_final_subtitle_event(
        self, command: FinalSubtitleCommand
    ) -> dict[str, object]:
        """確定字幕の canonical イベントを組み立てる。"""
        same_lang = _base_lang(command.source_language) == _base_lang(
            command.target_language
        )
        translated: str | None
        if command.degraded or same_lang or not command.translated_text:
            translated = None
        else:
            translated = command.translated_text
        is_translated = bool(
            not command.degraded and not same_lang and command.translated_text
        )
        provider = command.provider
        if provider is None:
            provider = "asr_mt" if command.mainline != "hearing" else None
        return envelope_event(
            {
                "type": "subtitle",
                "id": command.subtitle_id,
                "seq": command.seq,
                "speaker_id": command.speaker_id,
                "speaker_label": command.speaker_label,
                "original_text": command.original_text,
                "source_language": command.source_language,
                "translated_text": translated,
                "target_language": command.target_language,
                "is_translated": is_translated,
                "is_partial": False,
                "is_final": True,
                "degraded": command.degraded,
                "mainline": command.mainline,
                "provider": provider,
                "trace_id": command.trace_id,
                "model_id": command.model_id,
            },
            room_id=command.room_id,
            speaker_id=command.speaker_id,
            utterance_id=command.subtitle_id,
            generation_id=command.generation_id,
            sequence_id=command.seq,
        )

    async def _fanout_data(
        self,
        *,
        listeners: Sequence[ListenerRef],
        topic: str,
        event: dict[str, object],
        channel: str,
        report: DeliveryReport,
        require_subtitle: bool,
    ) -> None:
        """encoder 済みイベントを受信者ごとに送り、失敗を隔離する。"""
        payload = encode_event(event)
        for ls in listeners:
            if require_subtitle and not ls.subtitle_enabled:
                report.suppressed.append(
                    Suppression(
                        reason="subtitle_disabled",
                        user_id=ls.user_id,
                        channel=channel,
                    )
                )
                continue
            try:
                await self._adapter.send_data(
                    user_id=ls.user_id,
                    topic=topic,
                    payload=payload,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[OutputManager] data 送信失敗(%s/%s): %s",
                    ls.user_id,
                    topic,
                    exc,
                )
                report.failures.append(
                    DeliveryFailure(
                        user_id=ls.user_id,
                        channel=channel,
                        error=str(exc),
                    )
                )
