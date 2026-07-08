"""
発話セグメント収束処理（Phase 3 C1）：1 発話 → 言語検出 → 2 主線 → 永続化。

LiveKit Agent の rtc 配線から切り離した「1 発話セグメントの収束」を担う
transport 非依存の単一責務クラス。SpeechSegmenter が切り出した 16kHz モノ生 PCM
を受け取り、WAV 化 → 言語検出 → 採番/重複排除 → HybridOrchestrator 駆動 →
DB 永続化までを束ねる。rtc に依存しないため単体テスト可能（依存は注入可能）。

設計原則:
    - README §0「収束は Output Manager と DB のみ」。配信は sink 経由のみ。
    - 言語検出・orchestrator・sequencer は注入可能（既定は本番実体を遅延束縛）。
    - Sink は受聴者の user_language に依存するため、構築は sink_factory に委譲する。
"""

import logging
from collections.abc import Awaitable, Callable

from app.ai_pipeline.orchestrator import (
    HybridOrchestrator,
    OrchestrationResult,
    OutputSink,
)
from app.ai_pipeline.qos import HybridQoSMonitor
from app.audio.pcm import wrap_wav16
from app.rooms.manager import ParticipantPreference
from app.translate import subtitle_cache
from app.webrtc.listeners import build_listeners
from app.webrtc.persistence import (
    MeetingConfig,
    SubtitleSequencer,
    generate_subtitle_id,
    save_transcript_segment,
)

logger = logging.getLogger(__name__)

# AI 主線の入力サンプルレート（16kHz モノ。segmenter 出力に一致）。
_INPUT_SAMPLE_RATE = 16000
# 言語検出失敗を表す値（この場合は話者ヒント言語へフォールバック）。
_UNKNOWN_LANG = "multi"
_ERROR_PREFIXES = (
    "[ASRエラー",
    "[ASR error",
    "[Transcription error",
    "[Speech error",
)

# 注入可能な言語検出関数（wav, hint）→（認識テキスト, 検出言語）。
DetectFn = Callable[[bytes, str], Awaitable[tuple[str, str]]]
# user_language（user_id→目標言語）と話者 ID から OutputSink を構築するファクトリ。
SinkFactory = Callable[[dict[str, str], str], OutputSink]


class SegmentProcessor:
    """1 発話セグメントの収束（検出→2 主線→永続化）を担う transport 非依存クラス。"""

    def __init__(
        self,
        *,
        orchestrator: HybridOrchestrator | None = None,
        sequencer: SubtitleSequencer | None = None,
        detect_fn: DetectFn | None = None,
        input_sample_rate: int = _INPUT_SAMPLE_RATE,
    ) -> None:
        self._orchestrator = orchestrator or HybridOrchestrator(
            monitor=HybridQoSMonitor()
        )
        self._sequencer = sequencer or SubtitleSequencer()
        self._detect_fn = detect_fn
        self._input_sample_rate = input_sample_rate

    @staticmethod
    def _is_provider_error_text(text: str) -> bool:
        """ASR 失敗を示す疑似テキストを通常字幕として流さない。"""
        normalized = text.strip()
        if not normalized:
            return False
        if normalized.startswith(_ERROR_PREFIXES):
            return True
        return (
            normalized.startswith("[")
            and normalized.endswith("]")
            and "エラー" in normalized
        )

    async def _detect(self, wav: bytes, hint: str) -> tuple[str, str]:
        """言語検出（既定は ai_pipeline.detect_language を遅延束縛）。"""
        if self._detect_fn is not None:
            return await self._detect_fn(wav, hint)
        from app.ai_pipeline.pipeline import ai_pipeline

        return await ai_pipeline.detect_language(wav, hint_language=hint)

    async def process(
        self,
        *,
        room_id: str,
        speaker_id: str,
        pcm16: bytes,
        speaker_lang_hint: str,
        participants: dict[str, ParticipantPreference],
        sink_factory: SinkFactory,
        config: MeetingConfig,
    ) -> OrchestrationResult | None:
        """1 発話セグメントを収束させる（配信は sink、記録は DB へ）。

        Returns:
            収束結果（無音・認識空・連続重複時は None で早期離脱）。
        """
        if not pcm16:
            return None
        wav = wrap_wav16(pcm16, self._input_sample_rate)

        original_text, detected_lang = await self._detect(wav, speaker_lang_hint)
        if not detected_lang or detected_lang == _UNKNOWN_LANG:
            detected_lang = speaker_lang_hint
        if not original_text:
            logger.debug(
                "[Agent] 認識結果なし(room=%s, speaker=%s)", room_id, speaker_id
            )
            return None
        if self._is_provider_error_text(original_text):
            logger.warning(
                "[Agent] 認識エラー文字列を字幕化せず破棄: room=%s speaker=%s text=%s",
                room_id,
                speaker_id,
                original_text,
            )
            return None

        # 連続同一テキストは字幕を発行しない（採番もしない）。
        if self._sequencer.is_duplicate(room_id, speaker_id, original_text):
            logger.debug("[Agent] 重複字幕をスキップ: '%s'", original_text[:30])
            return None
        self._sequencer.remember(room_id, speaker_id, original_text)
        seq = self._sequencer.next_seq(room_id)

        listeners, user_language = build_listeners(participants, speaker_id)
        sink = sink_factory(user_language, speaker_id)
        subtitle_id = generate_subtitle_id()
        await subtitle_cache.store_original(subtitle_id, original_text, detected_lang)

        result = await self._orchestrator.orchestrate(
            audio_bytes=wav,
            source_language=detected_lang,
            original_text=original_text,
            listeners=listeners,
            sink=sink,
            mode=config.mode,
            enable_openai_s2s=config.enable_openai_s2s,
            language_routes=config.language_routes,
            subtitle_id=subtitle_id,
            seq=seq,
            speaker_id=speaker_id,
        )

        await save_transcript_segment(
            room_id=room_id,
            speaker_id=speaker_id,
            source_language=detected_lang,
            text=original_text,
            translations=result.translations,
            tags=result.tags,
        )
        return result
