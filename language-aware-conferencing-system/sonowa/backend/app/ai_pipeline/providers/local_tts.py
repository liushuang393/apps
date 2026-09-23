"""
ローカル TTS ステージ（k2-fsa/OmniVoice・ja/en/zh/vi 単一モデル）

目的:
    Gemma 4 E2B（ASR/MT）と同時常駐できる 0.6B の OmniVoice で翻訳音声を合成する。
    OpenAITTSStage と同じ `synthesize(text, language) -> bytes | None` 契約に従う。
入力 / 出力:
    text・language（ja/en/zh/vi）→ 24kHz mono int16 WAV(RIFF) バイト列 or None。
注意点:
    - omnivoice / torch は遅延 import（未導入環境でもモジュール import 可）。
    - 固定 revision のキャッシュのみを読み、補助 ASR はロードしない。
    - 合成失敗・VRAM 逼迫・未対応言語は None を返し、字幕継続を可能にする。
    - モデル重みは CC-BY-NC。商用用途への採用には利用条件の確認が必要。
"""

import gc
import importlib.util
import logging
import sys
import threading
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

MODEL_ID = "k2-fsa/OmniVoice"
MODEL_REVISION = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
MODEL_LABEL = "OmniVoice"
# 付属音声コーデックを含む VRAM Broker 会計用サイズ（実測 Gemma と合計約 9100MiB）。
MODEL_SIZE_MB = 2400
ENGINE_CACHE_KEY = "tts:omnivoice"
SAMPLE_RATE = 24000
LANGUAGES = frozenset({"ja", "en", "zh", "vi"})

_INT16_MAX = 32767
_INT16_MIN = -32768


def create_stage(broker: object | None = None) -> "LocalTTSStage":
    """registry / warmup 共通のステージ生成口。"""
    return LocalTTSStage(broker=broker)


def available() -> bool:
    """omnivoice が導入済みかを返す。"""
    return importlib.util.find_spec("omnivoice") is not None


def _to_wav_bytes(waveform: object, sample_rate: int) -> bytes:
    """float32/int16 波形を int16 PCM の WAV バイト列にする。"""
    arr = np.asarray(waveform)
    if arr.ndim > 1:
        arr = arr.reshape(-1)
    if arr.dtype != np.int16:
        scaled = np.clip(arr.astype(np.float32) * _INT16_MAX, _INT16_MIN, _INT16_MAX)
        arr = scaled.astype(np.int16)
    return wrap_wav16(arr.tobytes(), sample_rate)


class _OmniVoiceEngine:
    """生成と解放を直列化し、言語指定と補助ASR禁止を検査する。"""

    def __init__(self, model: object) -> None:
        self.model: object | None = model
        self.lock = threading.Lock()

    def synthesize(self, text: str, voice: str) -> object:
        """指定言語の有限・非無音波形を返す。異常は上位の字幕縮退へ伝える。"""
        with self.lock:
            if self.model is None:
                raise RuntimeError("OmniVoiceは解放済みです")
            if self.model._asr_pipe is not None:
                raise RuntimeError("補助ASRのロードは禁止されています")
            results = self.model.generate(text=text, language=voice)
            if self.model._asr_pipe is not None:
                raise RuntimeError("生成中に補助ASRがロードされました")
            if not isinstance(results, list) or len(results) != 1:
                raise ValueError("OmniVoiceの出力波形数が不正です")
            waveform = np.asarray(results[0])
            if (
                waveform.ndim != 1
                or not waveform.size
                or not np.isfinite(waveform).all()
                or not np.any(waveform)
            ):
                raise ValueError("OmniVoiceの音声が空・無音・非有限です")
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
    """OmniVoice によるローカル多言語音声合成ステージ（VRAM Broker 調停下）。"""

    name = "local"
    CAPACITY_WAIT_SECONDS = 120

    def __init__(
        self, engine: object | None = None, broker: object | None = None
    ) -> None:
        """
        Args:
            engine: 合成モデル（テスト用に注入可能）。未注入時は遅延ロードする。
            broker: VRAM Broker（未指定時はモジュール既定 broker を共有）。
        """
        self._engine = engine
        self._broker = broker or default_broker

    async def prepare(self) -> None:
        """発話受付前にモデルを事前ロードする。失敗は呼び出し元へ伝える。"""
        await self._broker.warmup(
            ENGINE_CACHE_KEY,
            loader=self._load_engine,
            size_mb=MODEL_SIZE_MB,
            priority=PRIORITY_TTS,
            version=MODEL_REVISION,
        )

    def _load_engine(self) -> object:
        """キャッシュのみから固定モデルを読み、追加ASRの自動取得を禁止する。"""
        if self._engine is not None:
            return _OmniVoiceEngine(self._engine)
        import torch
        from huggingface_hub import snapshot_download
        from omnivoice import OmniVoice

        path = snapshot_download(
            MODEL_ID, revision=MODEL_REVISION, local_files_only=True
        )
        if not (Path(path) / "audio_tokenizer").is_dir():
            raise FileNotFoundError("固定モデルに付属する音声コーデックがありません")
        model = OmniVoice.from_pretrained(
            path,
            local_files_only=True,
            load_asr=False,
            device_map=settings.local_tts_device,
            dtype=torch.float16,
        )
        engine = _OmniVoiceEngine(model)
        if model._asr_pipe is not None:
            engine.close()
            raise RuntimeError("OmniVoiceが補助ASRをロードしました")
        return engine

    async def synthesize(self, text: str, language: str) -> bytes | None:
        """テキストを合成し WAV バイト列を返す（失敗・未対応言語は None）。"""
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
                version=MODEL_REVISION,
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
