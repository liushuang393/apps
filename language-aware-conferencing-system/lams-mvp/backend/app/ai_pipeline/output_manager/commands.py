"""
Output Manager が受け取る型付き出力命令。

目的:
    orchestrator 等の呼出側が任意辞書を transport へ直接渡さず、
    字幕・暫定字幕・翻訳音声・品質イベントを単一の命令型で渡せるようにする。
入力 / 出力:
    各 Command dataclass は不変。DefaultOutputManager.handle の入力となる。
注意:
    QoE の可否は QualityEventCommand.decision として受け取り、再計算しない。
"""

from __future__ import annotations

from dataclasses import dataclass

from app.ai_pipeline.qoe import QoEDecision


@dataclass(frozen=True)
class ListenerRef:
    """受聴者ポリシー評価に必要な最小情報。"""

    user_id: str
    target_language: str
    wants_audio: bool
    subtitle_enabled: bool


@dataclass(frozen=True)
class FinalSubtitleCommand:
    """確定字幕（読む主線または hearing delta 代替）の配信命令。"""

    room_id: str
    speaker_id: str
    subtitle_id: str
    seq: int
    original_text: str
    source_language: str
    target_language: str
    translated_text: str
    mainline: str
    listeners: tuple[ListenerRef, ...]
    generation_id: int = 0
    provider: str | None = None
    degraded: bool = False
    speaker_label: str | None = None
    model_id: str | None = None
    trace_id: str | None = None


@dataclass(frozen=True)
class InterimSubtitleCommand:
    """暫定字幕（revision 付き）の配信命令。

    revision は RevisionAuthority が発行した値をそのまま載せる。
    Output Manager は再採番しない。
    stream_kind は accept／finalize 時の stream key 構築に使う。
    """

    room_id: str
    speaker_id: str
    subtitle_id: str
    seq: int
    target_language: str
    text: str
    listeners: tuple[ListenerRef, ...]
    revision: int
    generation_id: int = 0
    stream_kind: str = "hearing_transcript"


@dataclass(frozen=True)
class TranslatedAudioCommand:
    """翻訳音声（聞く主線）の配信命令。"""

    speaker_id: str
    source_language: str
    target_language: str
    audio: bytes
    listeners: tuple[ListenerRef, ...]
    generation_id: int


@dataclass(frozen=True)
class QualityEventCommand:
    """QoE decision フラグを消費して品質イベントを配信する命令。"""

    room_id: str
    speaker_id: str
    utterance_id: str
    seq: int
    generation_id: int
    listeners: tuple[ListenerRef, ...]
    decision: QoEDecision


OutputCommand = (
    FinalSubtitleCommand
    | InterimSubtitleCommand
    | TranslatedAudioCommand
    | QualityEventCommand
)
"""Output Manager 公開面が受理する出力命令の和型。"""
