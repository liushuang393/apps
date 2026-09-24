"""
ローカル TTS ステージ（方式3・Qwen3-TTS 0.6B CustomVoice・ja/en/zh）

目的:
    方式3（ローカル）の翻訳音声スロット。OpenAITTSStage と同じ
    `synthesize(text, language) -> bytes | None` 契約と VRAM Broker 調停を持ち、
    モデルは `_load_model` と定数だけで差し替えられる（差し替え口）。
採用モデル: Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice（Apache-2.0）を faster-qwen3-tts（MIT、
    CUDA グラフ）で実行。RTX 3060 で実時間の約0.25〜0.5倍、Gemma と同時常駐で約9.6GB。
    vi は商用可のローカル TTS が無いため対象外（None を返し字幕のみ）。
入力 / 出力:
    text・language → 24kHz mono int16 WAV(RIFF) バイト列 or None（未導入・失敗・未対応言語）。
注意点:
    - faster_qwen3_tts / torch は遅延 import（未導入環境でもモジュール import 可）。
    - 固定 revision のキャッシュのみを読む。クラウドへは切り替えない。
    - 生成は1モデルを直列化し、空・無音・非有限の波形は成功扱いにしない。
    - 初回生成は CUDA グラフの記録で約9秒かかるため、起動時のウォームアップで済ませる。
"""

import gc
import importlib.util
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
from app.config import settings

logger = logging.getLogger(__name__)

# 結線するモデル。revision は scripts/prepare_local_models.py と一致させる。
MODEL_ID: str | None = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
MODEL_REVISION: str | None = "85e237c12c027371202489a0ec509ded67b5e4b5"
MODEL_LABEL = "Qwen3-TTS 0.6B"
# 音声コーデック・CUDA グラフ込みの実測（Gemma 常駐時の増分 約2.4GB）+ 余裕。
MODEL_SIZE_MB = 2500
ENGINE_CACHE_KEY = "tts:local"
SAMPLE_RATE = 24000
# 言語コード → (モデルの言語名, 母語話者のプリセット音声)。vi は非対応（字幕のみ）。
VOICES = {
    "ja": ("Japanese", "Ono_Anna"),
    "en": ("English", "Ryan"),
    "zh": ("Chinese", "Vivian"),
}
LANGUAGES = frozenset(VOICES)

_INT16_MAX = 32767
_INT16_MIN = -32768


def create_stage(broker: object | None = None) -> "LocalTTSStage":
    """registry / warmup 共通のステージ生成口。"""
    return LocalTTSStage(broker=broker)


def available() -> bool:
    """モデルが結線済みで、実行ランタイムが導入済みかを返す。"""
    return (
        MODEL_ID is not None
        and importlib.util.find_spec("faster_qwen3_tts") is not None
    )


class _QwenVoice:
    """faster-qwen3-tts を `synthesize(text, language) -> 波形` 契約へ合わせる。"""

    def __init__(self, model: object) -> None:
        self._model = model

    def synthesize(self, text: str, language: str) -> np.ndarray:
        """言語ごとの母語話者で合成し、1次元 float 波形を返す。"""
        name, speaker = VOICES[language]
        wavs, rate = self._model.generate_custom_voice(
            text=text, speaker=speaker, language=name
        )
        if rate != SAMPLE_RATE:
            raise ValueError(f"想定外のサンプルレート: {rate}")
        return np.asarray(wavs[0]).reshape(-1)


def _load_model() -> object:
    """固定 revision のキャッシュから Qwen3-TTS を読み込む（ネットワークに出ない）。"""
    from faster_qwen3_tts import FasterQwen3TTS
    from huggingface_hub import snapshot_download

    path = snapshot_download(MODEL_ID, revision=MODEL_REVISION, local_files_only=True)
    return _QwenVoice(
        FasterQwen3TTS.from_pretrained(
            path, device=settings.local_tts_device, local_files_only=True
        )
    )


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
