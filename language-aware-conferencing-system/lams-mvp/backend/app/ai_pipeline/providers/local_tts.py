"""
Lite ローカル TTS ステージ（Kokoro-82M / Apache-2.0 / 低遅延）

目的:
    雲 TTS（OpenAI）に依存せず、GPU/CPU 上の軽量 Kokoro-82M で音声合成する
    「local」ステージを提供する。VRAM Broker 経由でモデル常駐を調停し、
    OpenAITTSStage と同じ `synthesize(text, language) -> bytes | None` 契約に従う。
入力 / 出力:
    text（合成テキスト）・language（ja/en/zh/vi）→ WAV(RIFF) バイト列 or None。
注意点:
    - kokoro / GPU が無い環境でも import・単体テスト可能とするため、
      `from kokoro import KPipeline` は _load_engine 内での遅延 import に限定する。
    - TTS 失敗は字幕継続のため握り潰す（例外・VRAMCapacityError → warning して None）。
    - 合成は同期ブロッキングのため asyncio.to_thread でオフロードする。
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

# Kokoro の既定サンプルレート（Hz）。float32 波形はこのレートで返る。
KOKORO_SAMPLE_RATE = 24000

# int16 PCM への変換定数（float32[-1,1] → int16）。マジックナンバー回避。
_INT16_MAX = 32767
_INT16_MIN = -32768

# 言語 → Kokoro voice の対応表。既定は settings.local_tts_voice を用いる。
# Kokoro voice 命名: 先頭 a=American/b=British/j=Japanese/z=Mandarin 等。
# vi(ベトナム語) は Kokoro に専用 voice が無いため英語 voice で代替する。
_VOICE_BY_LANGUAGE: dict[str, str] = {
    "ja": "jf_alpha",
    "en": "af_heart",
    "zh": "zf_xiaobei",
    "vi": "af_heart",
}


def available() -> bool:
    """kokoro が import 可能かを返す（本環境では未導入のため False）。"""
    return importlib.util.find_spec("kokoro") is not None


def _voice_for(language: str) -> str:
    """言語コードから Kokoro voice を決める（未対応言語は既定 voice へ）。"""
    return _VOICE_BY_LANGUAGE.get(language, settings.local_tts_voice)


def _to_wav_bytes(waveform: object, sample_rate: int) -> bytes:
    """float32/int16 波形（配列）を int16 PCM へ変換し WAV バイト列にする。

    Args:
        waveform: 1 次元の波形（float32[-1,1] 想定。int16 もそのまま扱う）。
        sample_rate: 波形のサンプルレート（Hz）。
    Returns:
        WAV(RIFF) バイト列（先頭 b"RIFF"）。
    """
    arr = np.asarray(waveform)
    if arr.dtype != np.int16:
        # float32[-1,1] を int16 域へスケール・クリップする。
        scaled = np.clip(arr.astype(np.float32) * _INT16_MAX, _INT16_MIN, _INT16_MAX)
        arr = scaled.astype(np.int16)
    return wrap_wav16(arr.tobytes(), sample_rate)


class LocalTTSStage:
    """Kokoro-82M によるローカル音声合成ステージ（VRAM Broker 調停下）。"""

    name = "local"

    def __init__(self, engine: object | None = None, broker: object | None = None) -> None:
        """
        Args:
            engine: 合成エンジン（テスト用に注入可能）。未注入時は遅延ロードする。
            broker: VRAM Broker（未指定時はモジュール既定 broker を共有）。
        """
        self._engine = engine
        self._broker = broker or default_broker

    def _load_engine(self) -> object:
        """Kokoro エンジンを生成する（loader）。注入 engine があればそれを返す。

        `from kokoro import KPipeline` はこの内部でのみ実施し、kokoro 未導入環境で
        モジュール import が失敗しないようにする（遅延 import）。
        """
        if self._engine is not None:
            return self._engine
        from kokoro import KPipeline  # 遅延 import（先頭 import 禁止）

        return KPipeline(model=settings.local_tts_model, device=settings.local_tts_device)

    @staticmethod
    def _synthesize_blocking(engine: object, text: str, voice: str) -> object:
        """ブロッキング合成本体（to_thread で実行）。波形（配列）を返す。"""
        return engine.synthesize(text, voice=voice)

    async def synthesize(self, text: str, language: str) -> bytes | None:
        """テキストを合成し WAV バイト列を返す（失敗時は None）。

        Args:
            text: 合成対象テキスト（空/空白は None）。
            language: 言語コード（ja/en/zh/vi）。voice の決定に用いる。
        Returns:
            WAV(RIFF) バイト列、または合成不能時 None。
        """
        if not text or not text.strip():
            return None
        voice = _voice_for(language)
        loader: Callable[[], object] = self._load_engine
        try:
            async with self._broker.use(
                key=f"tts:{settings.local_tts_model}",
                loader=loader,
                size_mb=settings.local_tts_size_mb,
                priority=PRIORITY_TTS,
                version=settings.local_tts_model,
            ) as engine:
                waveform = await asyncio.to_thread(
                    self._synthesize_blocking, engine, text, voice
                )
            return _to_wav_bytes(waveform, KOKORO_SAMPLE_RATE)
        except VRAMCapacityError as exc:
            logger.warning("[TTS:local] VRAM 確保不能のため合成中止: %s", exc)
            return None
        except Exception as exc:  # TTS 失敗は字幕継続のため握り潰す
            logger.warning("[TTS:local] 合成失敗のため None を返却: %s", exc)
            return None
