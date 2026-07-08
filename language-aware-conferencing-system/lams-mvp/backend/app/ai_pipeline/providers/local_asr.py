"""
Lite ローカル ASR ステージ（faster-whisper / CTranslate2）

目的:
    改善案の「ローカル ASR（GPU 常駐 Whisper）」スロット。雲 ASR の代替として
    GPU 上の faster-whisper を用い、字幕の一次認識と言語自動検出を担う。
    VRAM Broker（vram_broker.py）に常駐調停を委ねる。予算逼迫・推論失敗は "" を
    返し、当該セグメントは字幕欠落となる（orchestrator が原文プレースホルダで
    発話の存在を保証）。雲への自動再試行は行わない（registry の fallback は
    ランタイム未導入＝構築時のみ有効）。
入力 / 出力:
    入力は wrap_wav16 が生成する 16kHz モノ int16 WAV バイト列。
    transcribe_audio は認識テキスト、transcribe_with_detection は
    (認識テキスト, 検出言語) を返す。
注意点:
    - faster_whisper / GPU が無い環境でも import・単体テスト可能とするため、
      重量依存は _load_model 内で「遅延 import」する（モジュール先頭で import 禁止）。
    - 失敗はセンチネル文字列を返さず必ず空文字列（＝当該発話の字幕欠落）。
    - 実推論はブロッキングのため asyncio.to_thread でイベントループを塞がない。
"""

import asyncio
import io
import logging
import wave

import numpy as np

from app.ai_pipeline.vram_broker import (
    PRIORITY_ASR,
    VRAMCapacityError,
)
from app.ai_pipeline.vram_broker import (
    broker as default_broker,
)
from app.config import settings

logger = logging.getLogger(__name__)

# faster-whisper の言語コードと一致する対応言語（"multi"/不明は自動検出）。
_SUPPORTED_LANGUAGES = frozenset({"ja", "en", "zh", "vi"})

# int16 → float32 正規化係数（[-1.0, 1.0] へ写像）。
_INT16_FULL_SCALE = 32768.0
_WAV_SAMPLE_WIDTH_BYTES = 2  # int16 = 2 バイト/標本


def available() -> bool:
    """faster_whisper が import 可能かを判定する（この環境では False）。"""
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False
    return True


def _decode_wav(audio_data: bytes) -> np.ndarray:
    """16bit int16 WAV バイト列を float32 モノ numpy 配列（[-1,1]）へデコードする。

    標準ライブラリ wave + numpy のみを用いる（追加依存なし）。空・不正・非 16bit は
    空配列を返し、呼び出し側は "" へ縮退する。多 ch は平均でモノ化する。
    """
    if not audio_data:
        return np.empty(0, dtype=np.float32)
    try:
        with wave.open(io.BytesIO(audio_data), "rb") as wav:
            if wav.getsampwidth() != _WAV_SAMPLE_WIDTH_BYTES:
                return np.empty(0, dtype=np.float32)
            channels = wav.getnchannels()
            frames = wav.readframes(wav.getnframes())
    except (wave.Error, EOFError, OSError):
        return np.empty(0, dtype=np.float32)
    if not frames:
        return np.empty(0, dtype=np.float32)
    pcm = np.frombuffer(frames, dtype=np.int16)
    if channels > 1:
        usable = (len(pcm) // channels) * channels
        if usable == 0:
            return np.empty(0, dtype=np.float32)
        pcm = pcm[:usable].reshape(-1, channels).mean(axis=1)
    return (pcm.astype(np.float32) / _INT16_FULL_SCALE).astype(np.float32)


class FasterWhisperASRStage:
    """faster-whisper（CTranslate2）を ASR ステージとして包むローカル実装。"""

    name = "local"

    def __init__(self, model: object | None = None, broker: object | None = None) -> None:
        # model/broker はテスト用に注入可能。未注入時は遅延ロード・既定 broker を使う。
        self._model = model
        self._broker = broker

    def _load_model(self) -> object:
        """WhisperModel を遅延生成する（VRAM Broker から未常駐時のみ呼ばれる）。

        注入 model があればそれを返す（テスト時は実 import を発生させない）。
        """
        if self._model is not None:
            return self._model
        # 重量依存はここでのみ import（モジュール先頭 import 禁止＝GPU 無しでも import 可能）。
        from faster_whisper import WhisperModel

        return WhisperModel(
            settings.local_asr_model,
            device=settings.local_asr_device,
            compute_type=settings.local_asr_compute_type,
        )

    def _transcribe_sync(
        self, model: object, samples: np.ndarray, language: str | None
    ) -> tuple[str, str]:
        """同期推論本体（to_thread から呼ぶ）。(結合テキスト, 検出言語) を返す。"""
        segments, info = model.transcribe(samples, language=language)
        text = "".join(getattr(seg, "text", "") for seg in segments).strip()
        detected = getattr(info, "language", "") or ""
        return text, detected

    async def _infer(
        self, audio_data: bytes, language: str | None
    ) -> tuple[str, str]:
        """WAV → 推論の共通経路。失敗・空は ("", "") を返す（雲フォールバック契機）。"""
        samples = _decode_wav(audio_data)
        if samples.size == 0:
            return "", ""
        broker = self._broker or default_broker
        try:
            async with broker.use(
                key=f"asr:{settings.local_asr_model}",
                loader=self._load_model,
                size_mb=settings.local_asr_size_mb,
                priority=PRIORITY_ASR,
                version=settings.local_asr_model,
            ) as model:
                return await asyncio.to_thread(
                    self._transcribe_sync, model, samples, language
                )
        except VRAMCapacityError as exc:
            # VRAM 確保不能: 雲/CPU へ縮退できるよう "" を返す。
            logger.warning("[ASR:local] VRAM 確保不能のため空返却: %s", exc)
            return "", ""
        except Exception as exc:  # noqa: BLE001 - 推論例外は握り潰し雲へ縮退
            logger.warning("[ASR:local] 推論失敗のため空返却: %s", exc)
            return "", ""

    @staticmethod
    def _normalize_language(language: str) -> str | None:
        """対応言語のみ強制指定、"multi"/不明は None（自動検出）へ正規化する。"""
        return language if language in _SUPPORTED_LANGUAGES else None

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """音声を認識してテキストを返す（失敗・空は ""）。"""
        text, _ = await self._infer(audio_data, self._normalize_language(language))
        return text

    async def transcribe_with_detection(
        self, audio_data: bytes, hint_language: str = "multi"
    ) -> tuple[str, str]:
        """音声を認識し (テキスト, 検出言語) を返す。

        auto 検出優先（language 指定なし）で info.language を検出言語とする。
        検出不能・空音声時のみ hint_language を採用する。
        """
        text, detected = await self._infer(audio_data, None)
        return text, (detected or hint_language)
