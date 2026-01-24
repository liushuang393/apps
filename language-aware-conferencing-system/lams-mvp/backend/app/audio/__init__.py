"""
音声処理モジュール

VAD（Voice Activity Detection）などの音声処理機能を提供
"""

from app.audio.vad import VADResult, detect_voice_activity, get_audio_energy, has_speech

__all__ = ["VADResult", "detect_voice_activity", "get_audio_energy", "has_speech"]
