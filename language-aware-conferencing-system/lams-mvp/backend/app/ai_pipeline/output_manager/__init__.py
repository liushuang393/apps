"""
Output Manager 公開 module。

型付き出力命令を一つ渡し、受聴者ポリシーに従って字幕・暫定字幕・翻訳音声・
品質イベントを transport adapter へ配信する。実 LiveKit 依存は adapter 実装側。
"""

from app.ai_pipeline.output_manager.adapter import (
    TOPIC_EVENT,
    TOPIC_SUBTITLE,
    RecordingTransportAdapter,
    TransportAdapter,
)
from app.ai_pipeline.output_manager.commands import (
    FinalSubtitleCommand,
    InterimSubtitleCommand,
    InterruptedEventCommand,
    ListenerRef,
    OutputCommand,
    PartialSubtitleCommand,
    QosWarningCommand,
    QualityEventCommand,
    TranslatedAudioCommand,
)
from app.ai_pipeline.output_manager.manager import (
    DefaultOutputManager,
    DeliveryFailure,
    DeliveryReport,
    GenerationGate,
    OutputManager,
    Suppression,
)

__all__ = [
    "TOPIC_EVENT",
    "TOPIC_SUBTITLE",
    "DefaultOutputManager",
    "DeliveryFailure",
    "DeliveryReport",
    "FinalSubtitleCommand",
    "GenerationGate",
    "InterimSubtitleCommand",
    "InterruptedEventCommand",
    "ListenerRef",
    "OutputCommand",
    "OutputManager",
    "PartialSubtitleCommand",
    "QosWarningCommand",
    "QualityEventCommand",
    "RecordingTransportAdapter",
    "Suppression",
    "TranslatedAudioCommand",
    "TransportAdapter",
]
