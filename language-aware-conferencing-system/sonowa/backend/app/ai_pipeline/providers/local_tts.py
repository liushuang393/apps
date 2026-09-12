"""
Lite ローカル TTS ステージ（VoxCPM2 / Apache-2.0 / 4言語単一モデル）

目的:
    Kokoro の vi 欠落を解消し、ja/en/zh/vi を同一 OSS モデルで合成する。
    OpenAITTSStage と同じ `synthesize(text, language) -> bytes | None` 契約に従う。
入力 / 出力:
    text・language（ja/en/zh/vi）→ WAV(RIFF) バイト列 or None。
注意点:
    - voxcpm は遅延 import（未導入環境でもモジュール import 可）。
    - VoxCPM2 は単体で約 8GB VRAM。VRAM Broker が他モデルと排他調停する。
    - 合成失敗・VRAM 逼迫は None を返し、字幕継続を可能にする。
    - 出力は 48kHz。LiveKit 向けに int16 WAV へ正規化する。
"""

import asyncio
import importlib.util
import logging
from collections.abc import Callable

import numpy as np

from app.ai_pipeline.vram_broker import PRIORITY_TTS, VRAMCapacityError
from app.ai_pipeline.vram_broker import broker as default_broker
from app.audio.pcm import wrap_wav16
from app.config import settings

logger = logging.getLogger(__name__)

# VoxCPM2 の出力サンプルレート（Hz）。
VOXCPM_SAMPLE_RATE = 48000

# 後方互換エイリアス（旧テスト名・参照用）。
KOKORO_SAMPLE_RATE = VOXCPM_SAMPLE_RATE

_INT16_MAX = 32767
_INT16_MIN = -32768

# 単一エンジンの VRAM Broker キー。
ENGINE_CACHE_KEY = "tts:voxcpm2"


def available() -> bool:
    """voxcpm が import 可能かを返す。"""
    return importlib.util.find_spec("voxcpm") is not None


def _to_wav_bytes(waveform: object, sample_rate: int) -> bytes:
    """float32/int16 波形を int16 PCM の WAV バイト列にする。"""
    arr = np.asarray(waveform)
    if arr.ndim > 1:
        arr = arr.reshape(-1)
    if arr.dtype != np.int16:
        scaled = np.clip(arr.astype(np.float32) * _INT16_MAX, _INT16_MIN, _INT16_MAX)
        arr = scaled.astype(np.int16)
    return wrap_wav16(arr.tobytes(), sample_rate)


class LocalTTSStage:
    """VoxCPM2 によるローカル多言語音声合成ステージ（VRAM Broker 調停下）。"""

    name = "local"

    def __init__(
        self, engine: object | None = None, broker: object | None = None
    ) -> None:
        """
        Args:
            engine: 合成エンジン（テスト用に注入可能）。未注入時は遅延ロードする。
            broker: VRAM Broker（未指定時はモジュール既定 broker を共有）。
        """
        self._engine = engine
        self._broker = broker or default_broker

    def _load_engine(self) -> object:
        """VoxCPM エンジンを生成する（loader）。注入 engine があればそれを返す。"""
        if self._engine is not None:
            return self._engine
        from voxcpm import VoxCPM  # 遅延 import（先頭 import 禁止）

        # load_denoiser=False で 8GB 級 GPU に収める。
        return VoxCPM.from_pretrained(
            settings.local_tts_model,
            load_denoiser=False,
        )

    @staticmethod
    def _synthesize_blocking(engine: object, text: str, language: str) -> object:
        """ブロッキング合成本体（to_thread で実行）。波形（配列）を返す。

        VoxCPM2 は言語タグ不要。generate / synthesize のいずれかを受け入れる。
        """
        if hasattr(engine, "generate"):
            return engine.generate(text)
        if hasattr(engine, "synthesize"):
            # 旧 Kokoro 互換・テストフェイク向け。
            return engine.synthesize(text, voice=language)
        raise RuntimeError("TTS エンジンに generate/synthesize がありません")

    async def synthesize(self, text: str, language: str) -> bytes | None:
        """テキストを合成し WAV バイト列を返す（失敗時は None）。"""
        if not text or not text.strip():
            return None
        loader: Callable[[], object] = self._load_engine
        try:
            async with self._broker.use(
                key=ENGINE_CACHE_KEY,
                loader=loader,
                size_mb=settings.local_tts_size_mb,
                priority=PRIORITY_TTS,
                version=settings.local_tts_model,
            ) as engine:
                waveform = await asyncio.to_thread(
                    self._synthesize_blocking, engine, text, language
                )
            return _to_wav_bytes(waveform, VOXCPM_SAMPLE_RATE)
        except VRAMCapacityError as exc:
            logger.warning("[TTS:local] VRAM 確保不能のため合成中止: %s", exc)
            return None
        except Exception as exc:  # noqa: BLE001 - TTS 失敗は字幕継続のため握り潰す
            logger.warning("[TTS:local] 合成失敗のため None を返却: %s", exc)
            return None
