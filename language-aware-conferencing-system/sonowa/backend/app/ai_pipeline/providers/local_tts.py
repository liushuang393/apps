"""
ローカル TTS ステージの差し替え口（現在モデル未結線・字幕のみ運用）

目的:
    方式3（ローカル）の翻訳音声スロット。OpenAITTSStage と同じ
    `synthesize(text, language) -> bytes | None` 契約と VRAM Broker 調停を保持し、
    適合モデルが出たら `_load_model` と定数だけを差し替えて結線する。
採用条件（2026-09-24 時点で該当なし）:
    - 商用利用可のライセンス
    - ja/en/zh/vi の 4 言語を 1 モデルで合成
    - Gemma 4 E2B（約7.3GB）と 12GB GPU に同時常駐（VoxCPM2 は約12.1GB で不可）
入力 / 出力:
    text・language → int16 WAV(RIFF) バイト列 or None（未結線・失敗・未対応言語）。
注意点:
    - 未結線の間は available() が False。registry はクラウドへ切り替えず字幕のみとなる。
    - 生成は1モデルを直列化し、空・無音・非有限の波形は成功扱いにしない。
"""

import gc
import logging
import sys
import threading

import numpy as np

from app.ai_pipeline.vram_broker import (
    PRIORITY_TTS,
    VRAMCapacityError,
    run_model_worker,
)
from app.ai_pipeline.vram_broker import broker as default_broker
from app.audio.pcm import wrap_wav16

logger = logging.getLogger(__name__)

# 結線するモデル（未結線時は None）。revision は取得スクリプトと一致させる。
MODEL_ID: str | None = None
MODEL_REVISION: str | None = None
MODEL_LABEL = "未結線"
MODEL_SIZE_MB = 0
ENGINE_CACHE_KEY = "tts:local"
SAMPLE_RATE = 24000
LANGUAGES = frozenset({"ja", "en", "zh", "vi"})

_INT16_MAX = 32767
_INT16_MIN = -32768


def create_stage(broker: object | None = None) -> "LocalTTSStage":
    """registry / warmup 共通のステージ生成口。"""
    return LocalTTSStage(broker=broker)


def available() -> bool:
    """モデルが結線済みかを返す（未結線の間は常に False）。"""
    return MODEL_ID is not None


def _load_model() -> object:
    """`synthesize(text, language) -> 波形` を持つモデルを返す。結線時に実装する。"""
    raise RuntimeError("ローカル TTS モデルは未結線です（字幕のみ）")


def _to_wav_bytes(waveform: object, sample_rate: int) -> bytes:
    """float32/int16 波形を int16 PCM の WAV バイト列にする。"""
    arr = np.asarray(waveform)
    if arr.ndim > 1:
        arr = arr.reshape(-1)
    if arr.dtype != np.int16:
        scaled = np.clip(arr.astype(np.float32) * _INT16_MAX, _INT16_MIN, _INT16_MAX)
        arr = scaled.astype(np.int16)
    return wrap_wav16(arr.tobytes(), sample_rate)


class _SerializedEngine:
    """1モデルの生成と解放を直列化し、異常な波形を上位の字幕縮退へ伝える。"""

    def __init__(self, model: object) -> None:
        self.model: object | None = model
        self.lock = threading.Lock()

    def synthesize(self, text: str, language: str) -> np.ndarray:
        """指定言語の有限・非無音波形を返す。"""
        with self.lock:
            if self.model is None:
                raise RuntimeError("TTS モデルは解放済みです")
            waveform = np.asarray(self.model.synthesize(text, language))
            if (
                waveform.ndim != 1
                or not waveform.size
                or not np.isfinite(waveform).all()
                or not np.any(waveform)
            ):
                raise ValueError("TTS の音声が空・無音・非有限です")
            return waveform

    def close(self) -> None:
        """モデル参照を破棄し、次の ASR/MT が CUDA 領域を再利用できるようにする。"""
        with self.lock:
            self.model = None
            gc.collect()
            torch = sys.modules.get("torch")
            if torch is not None and torch.cuda.is_available():
                torch.cuda.empty_cache()


class LocalTTSStage:
    """ローカル多言語音声合成ステージ（VRAM Broker 調停下）。"""

    name = "local"
    CAPACITY_WAIT_SECONDS = 120

    def __init__(
        self, engine: object | None = None, broker: object | None = None
    ) -> None:
        """
        Args:
            engine: 合成モデル（テスト用に注入可能）。未注入時は _load_model を使う。
            broker: VRAM Broker（未指定時はモジュール既定 broker を共有）。
        """
        self._engine = engine
        self._broker = broker or default_broker

    def _load_engine(self) -> _SerializedEngine:
        """注入モデルまたは結線モデルを直列化ラッパーで包む（loader）。"""
        return _SerializedEngine(
            self._engine if self._engine is not None else _load_model()
        )

    async def prepare(self) -> None:
        """発話受付前にモデルを事前ロードする。失敗は呼び出し元へ伝える。"""
        await self._broker.warmup(
            ENGINE_CACHE_KEY,
            loader=self._load_engine,
            size_mb=MODEL_SIZE_MB,
            priority=PRIORITY_TTS,
            version=MODEL_REVISION or "",
        )

    async def synthesize(self, text: str, language: str) -> bytes | None:
        """テキストを合成し WAV バイト列を返す（未結線・失敗・未対応言語は None）。"""
        if not text or not text.strip():
            return None
        if language not in LANGUAGES:
            logger.warning("[TTS:local] 未対応言語のため合成しません: %s", language)
            return None
        try:
            async with self._broker.use(
                key=ENGINE_CACHE_KEY,
                loader=self._load_engine,
                size_mb=MODEL_SIZE_MB,
                priority=PRIORITY_TTS,
                version=MODEL_REVISION or "",
                wait_timeout=self.CAPACITY_WAIT_SECONDS,
            ) as engine:
                waveform = await run_model_worker(engine.synthesize, text, language)
            return _to_wav_bytes(waveform, SAMPLE_RATE)
        except VRAMCapacityError as exc:
            logger.warning("[TTS:local] VRAM 確保不能のため合成中止: %s", exc)
            return None
        except Exception as exc:  # noqa: BLE001 - TTS 失敗は字幕継続のため握り潰す
            logger.warning("[TTS:local] 合成失敗のため None を返却: %s", exc)
            return None
