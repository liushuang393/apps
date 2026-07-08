"""
声紋 embedding 抽出（P4-A diarization：話者分離の前段）

目的:
    16kHz モノ WAV バイト列から話者固有の声紋 embedding（固定長ベクトル）を
    抽出する。後段の diarization / 話者クラスタリングが、この embedding 間の
    距離で発話を話者へ束ねる。バックエンドは settings.speaker_embed_backend で
    切替え、"resemblyzer"（VoiceEncoder）を初期実装として提供する。
入力 / 出力:
    入力は wrap_wav16 が生成する 16kHz モノ int16 WAV バイト列。
    embed は声紋ベクトル（list[float]）を返す。失敗・空・未導入は None。
注意点:
    - 重量依存 resemblyzer は未導入環境でも import・単体テスト可能とするため
      関数/メソッド内で「遅延 import」する（モジュール先頭 import 禁止）。
    - 例外は握り潰して None を返す（ライブ主線を絶対に落とさない）。
    - 実推論はブロッキングのため asyncio.to_thread でイベントループを塞がない。
"""

import abc
import asyncio
import io
import logging
import wave
from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    import numpy as np

logger = logging.getLogger(__name__)

# int16 PCM → float32 正規化係数（[-1.0, 1.0] へ写像）とサンプル幅（マジックナンバー回避）。
_PCM_MAX = 32768.0
_SAMPLE_WIDTH_BYTES = 2  # int16 = 2 バイト/標本


def resemblyzer_available() -> bool:
    """resemblyzer + numpy が import 可能かを判定する（未導入では False）。

    重量依存はこの関数内でのみ import する（モジュール先頭 import 禁止＝
    未導入環境でも本モジュールを import・単体テスト可能にする）。
    """
    try:
        import numpy  # noqa: F401
        import resemblyzer  # noqa: F401
    except ImportError:
        return False
    return True


def _decode_wav(wav: bytes) -> "np.ndarray":
    """16bit int16 WAV バイト列を float32 モノ numpy 配列（[-1,1]）へデコードする。

    標準ライブラリ wave + numpy のみを用いる（numpy は導入済み）。空・不正・
    非 16bit は空配列を返し、呼び出し側は None へ縮退する。多 ch は平均でモノ化。
    """
    import numpy as np

    if not wav:
        return np.empty(0, dtype=np.float32)
    with wave.open(io.BytesIO(wav), "rb") as reader:
        if reader.getsampwidth() != _SAMPLE_WIDTH_BYTES:
            return np.empty(0, dtype=np.float32)
        channels = reader.getnchannels()
        frames = reader.readframes(reader.getnframes())
    if not frames:
        return np.empty(0, dtype=np.float32)
    pcm = np.frombuffer(frames, dtype=np.int16)
    if channels > 1:
        usable = (len(pcm) // channels) * channels
        if usable == 0:
            return np.empty(0, dtype=np.float32)
        pcm = pcm[:usable].reshape(-1, channels).mean(axis=1)
    return (pcm.astype(np.float32) / _PCM_MAX).astype(np.float32)


class SpeakerEmbedder(abc.ABC):
    """声紋 embedding 抽出器の抽象基底（バックエンド差替えの契約）。"""

    @abc.abstractmethod
    async def embed(self, wav: bytes) -> list[float] | None:
        """WAV バイト列から声紋 embedding を返す（失敗・空・未導入は None）。"""
        raise NotImplementedError

    @abc.abstractmethod
    def available(self) -> bool:
        """この抽出器が実際に推論可能か（依存導入済み等）を返す。"""
        raise NotImplementedError


class ResemblyzerEmbedder(SpeakerEmbedder):
    """resemblyzer の VoiceEncoder を用いた声紋 embedding 抽出実装。"""

    def __init__(self, encoder: object | None = None) -> None:
        """encoder はテスト用に注入可能。未注入時は遅延に VoiceEncoder を生成する。"""
        self._encoder = encoder

    def _get_encoder(self) -> object:
        """VoiceEncoder を遅延生成・キャッシュする（注入済みならそれを返す）。

        重量依存はここでのみ import する（未導入環境でも import 可能にする）。
        """
        if self._encoder is not None:
            return self._encoder
        from resemblyzer import VoiceEncoder

        self._encoder = VoiceEncoder()
        return self._encoder

    def _embed_sync(self, wav: bytes) -> list[float] | None:
        """同期の抽出本体（to_thread から呼ぶ）。空・失敗は None。"""
        samples = _decode_wav(wav)
        if samples.size == 0:
            return None
        encoder = self._get_encoder()
        vector = encoder.embed_utterance(samples)
        # numpy 配列・list いずれでも list[float] へ正規化する。
        to_list = getattr(vector, "tolist", None)
        values = to_list() if callable(to_list) else list(vector)
        return [float(v) for v in values]

    async def embed(self, wav: bytes) -> list[float] | None:
        """WAV バイト列から声紋 embedding を返す（失敗・空・未導入は None）。

        例外（import 失敗・デコード失敗・推論失敗）は握り潰して None を返す
        （ライブ主線を絶対に落とさない）。
        """
        if not wav:
            return None
        try:
            return await asyncio.to_thread(self._embed_sync, wav)
        except Exception as exc:  # noqa: BLE001 - 抽出失敗は握り潰し None へ縮退
            logger.warning("[speaker_embedding] 抽出失敗のため None 返却: %s", exc)
            return None

    def available(self) -> bool:
        """推論可能かを返す（encoder 注入時は True、未注入は依存導入で判定）。"""
        return self._encoder is not None or resemblyzer_available()


def build_speaker_embedder() -> SpeakerEmbedder | None:
    """settings から声紋抽出器を構築する。

    backend=="none"、または backend=="resemblyzer" でも依存が未導入なら None
    （＝話者分離を無効化して主線を継続する）。
    """
    if settings.speaker_embed_backend == "resemblyzer" and resemblyzer_available():
        return ResemblyzerEmbedder()
    return None
