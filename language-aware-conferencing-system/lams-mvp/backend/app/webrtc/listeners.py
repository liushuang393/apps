"""
受聴者マッピング（Phase 3 C1）：room 参加者 → Orchestrator の Listener 群。

LiveKit Agent は発話セグメントごとに HybridOrchestrator を駆動するが、
orchestrator は transport / room 表現に非依存な Listener のみを受け取る。
ここでは ParticipantPreference 群を Listener 群へ写す純関数を提供し、
併せて Sink が音声トラックを言語単位に束ねるための「user_id→目標言語」表も返す。

設計原則:
    - 純ロジック（I/O 非依存・単体テスト可能）。2 主線は混ぜない。
    - 翻訳音声（聞く主線）は audio_mode="translated" の受聴者のみが受信する。
      話者自身へは音声を返さない（エコー防止）が、字幕は本人確認用に配信し得る。
    - 目標言語は target_language を優先し、未設定時は native_language を使う。
"""

from app.ai_pipeline.orchestrator import Listener
from app.rooms.manager import ParticipantPreference

# 翻訳音声を受信する audio_mode（原声モードは LiveKit の原音トラックを直接購読）。
_TRANSLATED_MODE = "translated"


def resolve_target_language(participant: ParticipantPreference) -> str:
    """受聴者の目標言語を決定する（target_language 優先・無ければ native）。"""
    return participant.target_language or participant.native_language


def build_listeners(
    participants: dict[str, ParticipantPreference],
    speaker_id: str,
) -> tuple[list[Listener], dict[str, str]]:
    """参加者群を Listener 群へ写し、user_id→目標言語表を併せて返す。

    Args:
        participants: room の全参加者（user_id→ParticipantPreference）。
        speaker_id: 発話者の user_id（自身には翻訳音声を返さない）。
    Returns:
        (listeners, user_language):
            listeners      = orchestrator へ渡す Listener 群。
            user_language  = Sink が言語トラックへ束ねるための user_id→目標言語。
    """
    listeners: list[Listener] = []
    user_language: dict[str, str] = {}
    for participant in participants.values():
        target = resolve_target_language(participant)
        # 翻訳音声は translated モードかつ話者自身でない場合のみ受信する。
        wants_audio = (
            participant.audio_mode == _TRANSLATED_MODE
            and participant.user_id != speaker_id
        )
        listeners.append(
            Listener(
                user_id=participant.user_id,
                target_language=target,
                wants_audio=wants_audio,
                subtitle_enabled=participant.subtitle_enabled,
            )
        )
        user_language[participant.user_id] = target
    return listeners, user_language
