"""
音声処理モジュール

PCM 音声ユーティリティ（リサンプル／モノ化／チャンク化）を提供する。
発話単位の切り出し（VAD/セグメント化）はサーバ側 Agent の app.webrtc.segmenter
が担うため、本パッケージは PCM 変換ユーティリティのみを公開する。
"""

from app.audio.pcm import chunk16, resample16, to_mono16, wrap_wav16

__all__ = ["chunk16", "resample16", "to_mono16", "wrap_wav16"]
