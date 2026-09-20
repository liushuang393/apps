"""Gemma 4 E2B を ASR/MT で共有するローカルステージ。

入力: 16-bit WAV または原文・言語。出力: 原文、検出言語、訳文。
モデルは取得済みキャッシュからのみ読み、失敗時は空値へ縮退する。
VoxCPM2 と合わせて2モデル構成とし、音声エンコーダーは量子化しない。
"""

from __future__ import annotations

import asyncio
import gc
import importlib.util
import json
import logging
import threading
from collections.abc import Callable

import numpy as np

from app.ai_pipeline.providers.local_asr import _decode_wav
from app.ai_pipeline.vram_broker import PRIORITY_ASR, VRAMBroker, run_model_worker
from app.ai_pipeline.vram_broker import broker as default_broker

MODEL_ID = "google/gemma-4-E2B-it"
MODEL_REVISION = "3e22461f65e89153144f8adb70e3b8c2cc9845a7"
ENGINE_CACHE_KEY = "asr-mt:gemma4-e2b"
MODEL_SIZE_MB = 7300
SAMPLE_RATE = 16000
MAX_AUDIO_SECONDS = 30
MAX_NEW_TOKENS = 256
LANGUAGES = {"ja": "Japanese", "en": "English", "zh": "Chinese", "vi": "Vietnamese"}
QUANTIZATION_EXCLUSIONS = (
    "model.audio_tower",
    "model.vision_tower",
    "model.embed_audio",
    "model.embed_vision",
    "lm_head",
)
logger = logging.getLogger(__name__)
Inference = Callable[[str, np.ndarray | None], str]
TranslationKey = tuple[asyncio.AbstractEventLoop, int, int, str]
_pending_translations: dict[TranslationKey, asyncio.Task[str]] = {}


def available() -> bool:
    """重量依存をロードせず local ASR/MT の実行ライブラリを確認する。"""
    try:
        return all(
            importlib.util.find_spec(name) is not None
            for name in (
                "torch",
                "transformers",
                "bitsandbytes",
                "accelerate",
                "torchvision",
            )
        )
    except (ImportError, ValueError):
        return False


class LocalInferenceEngine:
    """共有モデルの推論と解放を直列化し、解放済み参照を拒否する。"""

    def __init__(self, infer: Inference, unload: Callable[[], None]) -> None:
        self._infer: Inference | None = infer
        self._unload: Callable[[], None] | None = unload
        self._lock = threading.Lock()

    def generate(self, prompt: str, audio: np.ndarray | None) -> str:
        """同一モデルの KV キャッシュを競合させず1要求を処理する。"""
        with self._lock:
            if self._infer is None:
                raise RuntimeError("ローカルモデルは解放済みです")
            return self._infer(prompt, audio)

    def close(self) -> None:
        """モデルの強参照と CUDA キャッシュを解放する。繰り返し呼出し可能。"""
        with self._lock:
            self._infer = None
            unload, self._unload = self._unload, None
            if unload is not None:
                unload()


def _load_engine() -> LocalInferenceEngine:
    """固定 revision をネットワーク取得せずロードし、推論/解放境界を返す。"""
    import torch
    from transformers import (
        AutoProcessor,
        BitsAndBytesConfig,
        Gemma4ForConditionalGeneration,
    )

    processor = AutoProcessor.from_pretrained(
        MODEL_ID, revision=MODEL_REVISION, local_files_only=True
    )
    model = Gemma4ForConditionalGeneration.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        local_files_only=True,
        device_map={"": 0},
        dtype=torch.bfloat16,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
            llm_int8_skip_modules=list(QUANTIZATION_EXCLUSIONS),
        ),
    ).eval()
    if any(type(m).__name__ == "Linear4bit" for m in model.model.audio_tower.modules()):
        raise RuntimeError("音声エンコーダーの量子化は禁止です")

    def infer(prompt: str, audio: np.ndarray | None) -> str:
        """CPU 上の正規化済み音声を含むプロンプトから、回答本文だけを得る。"""
        content: list[dict[str, object]] = [{"type": "text", "text": prompt}]
        if audio is not None:
            content.append({"type": "audio", "audio": audio})
        inputs = processor.apply_chat_template(
            [{"role": "user", "content": content}],
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
            add_generation_prompt=True,
            enable_thinking=False,
        ).to(model.device)
        with torch.inference_mode():
            output = model.generate(
                **inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False
            )
        return processor.decode(
            output[0][inputs["input_ids"].shape[-1] :], skip_special_tokens=True
        ).strip()

    def unload() -> None:
        """推論クロージャの参照を破棄し、次の TTS 用に CUDA 領域を戻す。"""
        nonlocal model, processor
        model = None
        processor = None
        gc.collect()
        torch.cuda.empty_cache()

    return LocalInferenceEngine(infer, unload)


class LocalMultimodalStage:
    """同じ Broker キーで ASR、言語検出、MT を提供するステージ。"""

    name = "local"
    CAPACITY_WAIT_SECONDS = 120

    def __init__(
        self,
        engine: LocalInferenceEngine | None = None,
        broker: VRAMBroker | None = None,
    ) -> None:
        self._engine = engine
        self._broker = broker or default_broker

    async def prepare(self) -> None:
        """発話受付前に共有ASR/MTモデルを読み込む。失敗は上位へ伝える。"""
        await self._broker.warmup(
            ENGINE_CACHE_KEY,
            loader=lambda: self._engine or _load_engine(),
            size_mb=MODEL_SIZE_MB,
            priority=PRIORITY_ASR,
            version=MODEL_REVISION,
        )

    async def _run(self, prompt: str, audio: np.ndarray | None = None) -> str:
        """共有モデルを保持して推論し、容量不足・欠損・例外は空値へ縮退する。"""
        try:
            async with self._broker.use(
                key=ENGINE_CACHE_KEY,
                loader=lambda: self._engine or _load_engine(),
                size_mb=MODEL_SIZE_MB,
                priority=PRIORITY_ASR,
                version=MODEL_REVISION,
                wait_timeout=self.CAPACITY_WAIT_SECONDS,
            ) as engine:
                return await run_model_worker(engine.generate, prompt, audio)
        except Exception as exc:
            logger.warning(
                "[ASR/MT:local] Gemma 推論失敗（クラウド再試行なし）: %s", exc
            )
            return ""

    @staticmethod
    def _audio(wav: bytes) -> np.ndarray | None:
        """WAV を16kHz monoへ正規化し、空・不正・30秒超過を拒否する。"""
        audio = _decode_wav(wav)
        if not audio.size or audio.size > SAMPLE_RATE * MAX_AUDIO_SECONDS:
            return None
        return audio

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """指定言語の音声を原文へ変換する。未知言語は検出経路を使う。"""
        if language not in LANGUAGES:
            return (await self.transcribe_with_detection(audio_data, language))[0]
        audio = self._audio(audio_data)
        if audio is None:
            return ""
        name = LANGUAGES[language]
        return await self._run(
            f"Transcribe the following speech segment in {name} into {name} text. "
            "Only output the transcription, with no newlines. Write numbers as digits.",
            audio,
        )

    async def transcribe_with_detection(
        self, audio_data: bytes, hint_language: str = "multi"
    ) -> tuple[str, str]:
        """言語と原文を構造化応答から検証して返す。失敗時は空原文とヒント。"""
        audio = self._audio(audio_data)
        if audio is None:
            return "", hint_language
        response = await self._run(
            "Identify the language of this speech and transcribe it accurately. "
            "Return only JSON with keys language and text. "
            "language must be one of ja, en, zh, vi. Write numbers as digits. "
            'Example format: {"language":"en","text":"Hello."}',
            audio,
        )
        try:
            if response.startswith("```"):
                response = response.split("\n", 1)[1].rsplit("```", 1)[0]
            value = json.loads(response)
            if not isinstance(value, dict):
                return "", hint_language
            text, detected = value.get("text"), value.get("language")
            if (
                not isinstance(text, str)
                or not isinstance(detected, str)
                or detected not in LANGUAGES
            ):
                return "", hint_language
            return text.strip(), detected
        except (ValueError, IndexError):
            logger.warning("[ASR:local] 言語検出の JSON が不正です")
            return "", hint_language

    async def translate_text(
        self, text: str, source_language: str, target_language: str
    ) -> str:
        """原文から訳文のみを返す。同言語・空文はモデルをロードしない。"""
        if not text.strip():
            return ""
        if source_language == target_language:
            return text
        if source_language not in LANGUAGES or target_language not in LANGUAGES:
            return ""
        prompt = (
            f"Translate the following {LANGUAGES[source_language]} text into "
            f"{LANGUAGES[target_language]}. Only output the translation. "
            "Preserve numbers and negation. Do not add facts, explanations, "
            "or causal relationships. Keep independent statements separate.\n"
            f"{text}"
        )
        key = (asyncio.get_running_loop(), id(self._broker), id(self._engine), prompt)
        task = _pending_translations.get(key)
        if task is None:

            async def infer_once() -> str:
                """同時要求だけを共有し、完了・失敗時に原文を保持するキーを破棄する。"""
                try:
                    return await self._run(prompt)
                finally:
                    _pending_translations.pop(key, None)

            task = asyncio.create_task(infer_once())
            _pending_translations[key] = task
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            # 共有推論と他の主線を止めず、GPU worker の終了までは保護を維持する。
            await asyncio.shield(task)
            raise
