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

import gc
import importlib.util
import logging
import sys
import threading
from collections.abc import Callable
from pathlib import Path

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

# VoxCPM2 の出力サンプルレート（Hz）。
VOXCPM_SAMPLE_RATE = 48000

# 後方互換エイリアス（旧テスト名・参照用）。
KOKORO_SAMPLE_RATE = VOXCPM_SAMPLE_RATE

_INT16_MAX = 32767
_INT16_MIN = -32768

# 単一エンジンの VRAM Broker キー。
ENGINE_CACHE_KEY = "tts:voxcpm2"
OMNIVOICE_MODEL_ID = "k2-fsa/OmniVoice"
OMNIVOICE_SIZE_MB = 2400


def model_label() -> str:
    """設定されたローカル音声モデルの表示名を返す。"""
    return "OmniVoice" if settings.local_tts_model == OMNIVOICE_MODEL_ID else "VoxCPM2"


def model_size_mb() -> int:
    """付属コーデックを含むモデルのVRAM予算を返す。"""
    if settings.local_tts_model == OMNIVOICE_MODEL_ID:
        return OMNIVOICE_SIZE_MB
    return settings.local_tts_size_mb


def create_stage(broker: object | None = None) -> "LocalTTSStage":
    """既存のlocal設定から選択されたモデルの実体を生成する。"""
    if settings.local_tts_model == OMNIVOICE_MODEL_ID:
        from app.ai_pipeline.providers.local_omnivoice import LocalOmniVoiceTTSStage

        return LocalOmniVoiceTTSStage(broker=broker)
    return LocalTTSStage(broker=broker)


class _SerializedEngine:
    """共有 VoxCPM の推論と解放を排他し、退避時に GPU キャッシュも戻す。"""

    def __init__(self, model: object) -> None:
        self.model: object | None = model
        self.lock = threading.Lock()

    def synthesize(self, text: str, voice: str) -> object:
        """同一モデルの生成を直列化し、波形を返す。"""
        with self.lock:
            if self.model is None:
                raise RuntimeError("TTS モデルは解放済みです")
            if hasattr(self.model, "generate"):
                return self.model.generate(text)
            return self.model.synthesize(text, voice=voice)

    def close(self) -> None:
        """モデル参照を破棄し、次の ASR/MT が CUDA 領域を再利用できるようにする。"""
        with self.lock:
            self.model = None
            gc.collect()
            torch = sys.modules.get("torch")
            if torch is not None and torch.cuda.is_available():
                torch.cuda.empty_cache()


def available() -> bool:
    """選択されたローカルTTSの依存が導入済みかを返す。"""
    package = (
        "omnivoice" if settings.local_tts_model == OMNIVOICE_MODEL_ID else "voxcpm"
    )
    return importlib.util.find_spec(package) is not None


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
    CAPACITY_WAIT_SECONDS = 120
    CACHE_KEY = ENGINE_CACHE_KEY
    SAMPLE_RATE = VOXCPM_SAMPLE_RATE

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

    @property
    def size_mb(self) -> int:
        """VRAM Brokerへ申告するモデル常駐サイズを返す。"""
        return settings.local_tts_size_mb

    @property
    def version(self) -> str:
        """キャッシュの再利用判定に使うモデル識別子を返す。"""
        return settings.local_tts_model

    async def prepare(self) -> None:
        """発話受付前にモデルを事前ロードする。失敗は呼び出し元へ伝える。"""
        await self._broker.warmup(
            self.CACHE_KEY,
            loader=self._load_engine,
            size_mb=self.size_mb,
            priority=PRIORITY_TTS,
            version=self.version,
        )

    def _load_engine(self) -> object:
        """VoxCPM エンジンを生成する（loader）。注入 engine があればそれを返す。"""
        if self._engine is not None:
            return _SerializedEngine(self._engine)
        from huggingface_hub import snapshot_download
        from voxcpm import VoxCPM  # 遅延 import（先頭 import 禁止）

        model_path = settings.local_tts_model
        if not Path(model_path).is_dir():
            model_path = snapshot_download(model_path, local_files_only=True)

        # load_denoiser=False で 8GB 級 GPU に収める。
        return _SerializedEngine(
            VoxCPM.from_pretrained(
                model_path,
                load_denoiser=False,
                optimize=False,
                device=settings.local_tts_device,
            )
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
                key=self.CACHE_KEY,
                loader=loader,
                size_mb=self.size_mb,
                priority=PRIORITY_TTS,
                version=self.version,
                wait_timeout=self.CAPACITY_WAIT_SECONDS,
            ) as engine:
                waveform = await run_model_worker(
                    self._synthesize_blocking, engine, text, language
                )
            return _to_wav_bytes(waveform, self.SAMPLE_RATE)
        except VRAMCapacityError as exc:
            logger.warning("[TTS:local] VRAM 確保不能のため合成中止: %s", exc)
            return None
        except Exception as exc:  # noqa: BLE001 - TTS 失敗は字幕継続のため握り潰す
            logger.warning("[TTS:local] 合成失敗のため None を返却: %s", exc)
            return None
