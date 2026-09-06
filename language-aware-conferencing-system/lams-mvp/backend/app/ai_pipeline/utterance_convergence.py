"""
言語別発話の fork/join/fallback 収束。

HybridOrchestrator が決定した主線を同時起動し、読む主線優先の字幕、聞く主線の
音声・暫定字幕、実行時縮退、barge-in、interim 終了を一か所で処理する。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Protocol, cast

from app.ai_pipeline.mode_router import RouteDecision
from app.ai_pipeline.output_manager import (
    InterimSubtitleCommand,
    InterruptedEventCommand,
    ListenerRef,
    OutputCommand,
    TranslatedAudioCommand,
)
from app.ai_pipeline.revision_authority import StreamKind

logger = logging.getLogger(__name__)


class _HearingResult(Protocol):
    """聞く主線の収束に必要な結果契約。"""

    audio_data: bytes | None
    translated_text: str
    generation_id: int


class _HearingCallable(Protocol):
    """聞く主線を起動する注入関数の契約。"""

    async def __call__(
        self,
        audio: bytes,
        source_language: str,
        target_language: str,
        speaker_id: str,
        original_text: str | None,
        *,
        room_id: str,
        utterance_id: str,
        s2s_provider: str | None,
    ) -> _HearingResult: ...


class _ReadingCallable(Protocol):
    """読む主線を起動する注入関数の契約。"""

    async def __call__(
        self,
        text: str,
        source_language: str,
        target_language: str,
    ) -> str: ...


class _RunTimedCallable(Protocol):
    """主線を計測付きで実行する注入関数の契約。"""

    async def __call__(
        self,
        mainline: str,
        operation: Awaitable[object],
    ) -> object: ...


class _SendFinalSubtitleCallable(Protocol):
    """確定字幕候補を Output Manager へ渡す注入関数の契約。"""

    async def __call__(
        self,
        *,
        handle_output: _HandleOutputCallable,
        listeners: tuple[ListenerRef, ...],
        room_id: str,
        speaker_id: str,
        speaker_label: str | None,
        subtitle_id: str,
        seq: int,
        original_text: str,
        source_language: str,
        target_language: str,
        translated_text: str,
        mainline: str,
        generation_id: int,
        provider: str | None,
        degraded: bool = False,
    ) -> None: ...


class _InterimMessageCallable(Protocol):
    """暫定字幕の revision 情報を生成する注入関数の契約。"""

    def __call__(
        self,
        *,
        subtitle_id: str,
        target_language: str,
        seq: int,
        room_id: str,
        speaker_id: str,
        text: str,
        generation_id: int,
    ) -> dict[str, object]: ...


class _FinishInterimCallable(Protocol):
    """確定後に interim stream を終了する注入関数の契約。"""

    def __call__(
        self,
        *,
        room_id: str,
        speaker_id: str,
        subtitle_id: str,
        target_language: str,
    ) -> None: ...


class _HandleOutputCallable(Protocol):
    """型付き出力命令を処理する注入関数の契約。"""

    async def __call__(self, command: OutputCommand) -> object: ...


@dataclass(frozen=True)
class LanguageConvergenceResult:
    """言語別収束結果。

    目的:
        DB 永続化候補と QoS/ログ用タグを coordinator へ返す。
    入力 / 出力:
        translation は空文字列を未生成として表し、tag は既存の観測項目を保持する。
    注意:
        配信済みイベント本文は保持せず、発話内容の複製を増やさない。
    """

    translation: str
    tag: dict[str, object]


@dataclass(frozen=True)
class UtteranceConvergence:
    """言語別発話の主線起動と収束を実行する。

    目的:
        聞く/読む主線の fork/join/fallback と interim lifecycle を集約する。
    入力 / 出力:
        注入された主線・計測・配信関数を使い、converge から言語別結果を返す。
    注意:
        orchestrator や具象 Output Manager を import せず、循環依存を作らない。
    """

    hearing: _HearingCallable
    reading: _ReadingCallable
    run_timed: _RunTimedCallable
    send_final_subtitle: _SendFinalSubtitleCallable
    interim_message: _InterimMessageCallable
    finish_interim: _FinishInterimCallable
    handle_output: _HandleOutputCallable

    async def converge(
        self,
        *,
        decision: RouteDecision,
        audio_bytes: bytes,
        source_language: str,
        target_language: str,
        original_text: str,
        listeners: tuple[ListenerRef, ...],
        room_id: str,
        speaker_id: str,
        speaker_label: str | None,
        subtitle_id: str,
        seq: int,
        generation_id: int | None,
    ) -> LanguageConvergenceResult:
        """1言語グループの主線を同時起動し、配信と縮退を完了する。

        入力:
            RouteDecision、発話、受聴者参照、イベント識別子を受け取る。
        出力:
            永続化候補の翻訳文と既存形式の観測タグを返す。
        注意:
            読む主線を先に await し、確定字幕が遅い hearing を待たない順序を維持する。
        """
        audio_data: bytes | None = None
        hearing_text = ""
        reading_text = ""
        reason = decision.reason
        hearing_generation = generation_id

        tasks: dict[str, asyncio.Future[object]] = {}
        if decision.run_hearing and decision.needs_translation:
            tasks["hearing"] = asyncio.ensure_future(
                self.run_timed(
                    "hearing",
                    self.hearing(
                        audio_bytes,
                        source_language,
                        target_language,
                        speaker_id,
                        original_text,
                        room_id=room_id,
                        utterance_id=subtitle_id,
                        s2s_provider=decision.s2s_provider,
                    ),
                )
            )
        if decision.needs_translation and decision.run_reading:
            tasks["reading"] = asyncio.ensure_future(
                self.run_timed(
                    "reading",
                    self.reading(
                        original_text,
                        source_language,
                        target_language,
                    ),
                )
            )

        subtitle_sent = False
        if "reading" in tasks:
            try:
                reading_text = cast(str, await tasks["reading"]) or ""
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[Hybrid] reading 主線エラー(%s): %s",
                    target_language,
                    exc,
                )
            if reading_text:
                await self.send_final_subtitle(
                    handle_output=self.handle_output,
                    listeners=listeners,
                    room_id=room_id,
                    speaker_id=speaker_id,
                    speaker_label=speaker_label,
                    subtitle_id=subtitle_id,
                    seq=seq,
                    original_text=original_text,
                    source_language=source_language,
                    target_language=target_language,
                    translated_text=reading_text,
                    mainline="reading",
                    generation_id=hearing_generation or 0,
                    provider=None,
                )
                subtitle_sent = True
                self.finish_interim(
                    room_id=room_id,
                    speaker_id=speaker_id,
                    subtitle_id=subtitle_id,
                    target_language=target_language,
                )

        if "hearing" in tasks:
            try:
                output = cast(_HearingResult, await tasks["hearing"])
                audio_data = output.audio_data
                hearing_text = output.translated_text
                if output.generation_id > 0:
                    hearing_generation = output.generation_id
                if hearing_text and not subtitle_sent:
                    interim = self.interim_message(
                        subtitle_id=subtitle_id,
                        target_language=target_language,
                        seq=seq,
                        room_id=room_id,
                        speaker_id=speaker_id,
                        text=hearing_text,
                        generation_id=hearing_generation or 0,
                    )
                    await self.handle_output(
                        InterimSubtitleCommand(
                            room_id=room_id,
                            speaker_id=speaker_id,
                            subtitle_id=str(interim.get("utterance_id") or subtitle_id),
                            seq=seq,
                            target_language=target_language,
                            text=hearing_text,
                            listeners=listeners,
                            generation_id=hearing_generation or 0,
                            revision=int(interim["revision"]),
                            stream_kind=StreamKind.HEARING_TRANSCRIPT.value,
                        )
                    )
            except asyncio.CancelledError:
                logger.info(
                    "[Hybrid] hearing キャンセル(barge-in): lang=%s",
                    target_language,
                )
                await self.handle_output(
                    InterruptedEventCommand(
                        room_id=room_id,
                        speaker_id=speaker_id,
                        utterance_id=subtitle_id,
                        seq=seq,
                        generation_id=hearing_generation or 0,
                        listeners=listeners,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[Hybrid] hearing 主線エラー(%s): %s",
                    target_language,
                    exc,
                )
            if audio_data:
                await self.handle_output(
                    TranslatedAudioCommand(
                        speaker_id=speaker_id,
                        source_language=source_language,
                        target_language=target_language,
                        audio=audio_data,
                        listeners=listeners,
                        generation_id=hearing_generation or 0,
                    )
                )

        hearing_failed = "hearing" in tasks and not audio_data and not hearing_text
        if (
            decision.needs_translation
            and hearing_failed
            and "reading" not in tasks
            and not reading_text
        ):
            try:
                fallback = await self.run_timed(
                    "reading",
                    self.reading(
                        original_text,
                        source_language,
                        target_language,
                    ),
                )
                reading_text = cast(str, fallback) or ""
                reason = "hearing_failed_runtime_fallback_reading"
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[Hybrid] 縮退 reading 主線エラー(%s): %s",
                    target_language,
                    exc,
                )

        if not decision.needs_translation:
            reading_text = original_text

        subtitle_text = reading_text or hearing_text
        if not subtitle_sent and subtitle_text:
            mainline = "reading" if reading_text else "hearing"
            await self.send_final_subtitle(
                handle_output=self.handle_output,
                listeners=listeners,
                room_id=room_id,
                speaker_id=speaker_id,
                speaker_label=speaker_label,
                subtitle_id=subtitle_id,
                seq=seq,
                original_text=original_text,
                source_language=source_language,
                target_language=target_language,
                translated_text=subtitle_text,
                mainline=mainline,
                generation_id=hearing_generation or 0,
                provider=(decision.s2s_provider if mainline == "hearing" else None),
            )
            self.finish_interim(
                room_id=room_id,
                speaker_id=speaker_id,
                subtitle_id=subtitle_id,
                target_language=target_language,
            )
        elif not subtitle_sent and decision.needs_translation and original_text:
            logger.warning(
                "[Hybrid] 全主線失敗のため原文プレースホルダを配信(%s): '%s'",
                target_language,
                original_text[:30],
            )
            await self.send_final_subtitle(
                handle_output=self.handle_output,
                listeners=listeners,
                room_id=room_id,
                speaker_id=speaker_id,
                speaker_label=speaker_label,
                subtitle_id=subtitle_id,
                seq=seq,
                original_text=original_text,
                source_language=source_language,
                target_language=target_language,
                translated_text=original_text,
                mainline="degraded",
                generation_id=hearing_generation or 0,
                provider=None,
                degraded=True,
            )
            self.finish_interim(
                room_id=room_id,
                speaker_id=speaker_id,
                subtitle_id=subtitle_id,
                target_language=target_language,
            )

        return LanguageConvergenceResult(
            translation=subtitle_text,
            tag={
                "target_language": target_language,
                "reason": reason,
                "hearing_audio": bool(audio_data),
                "subtitle_mainline": (
                    ("reading" if reading_text else "hearing")
                    if subtitle_text
                    else None
                ),
                "s2s_provider": decision.s2s_provider,
                "generation_id": hearing_generation,
            },
        )
