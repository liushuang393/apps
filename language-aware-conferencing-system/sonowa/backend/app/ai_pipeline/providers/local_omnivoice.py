"""固定キャッシュのOmniVoiceを使うローカルTTS。失敗時は字幕継続する。

入力は4言語のテキスト、出力は24kHz mono int16 WAVまたはNone。
補助ASRをロードせず、音声コーデックを含めて1つのTTSとして管理する。
モデル重みはCC-BY-NC。商用用途への採用には利用条件の確認が必要。
"""

import logging
from pathlib import Path

import numpy as np

from app.ai_pipeline.providers.local_tts import (
    OMNIVOICE_MODEL_ID,
    OMNIVOICE_SIZE_MB,
    LocalTTSStage,
    _SerializedEngine,
)
from app.config import settings

logger = logging.getLogger(__name__)
MODEL_ID = OMNIVOICE_MODEL_ID
MODEL_REVISION = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
ENGINE_CACHE_KEY = "tts:omnivoice"
LANGUAGES = frozenset({"ja", "en", "zh", "vi"})


class _OmniVoiceEngine(_SerializedEngine):
    """生成と解放を直列化し、言語指定と補助ASR禁止を検査する。"""

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


class LocalOmniVoiceTTSStage(LocalTTSStage):
    """Gemmaと常駐可能なOmniVoice TTSを既存local契約で提供する。"""

    CACHE_KEY = ENGINE_CACHE_KEY
    SAMPLE_RATE = 24000

    @property
    def size_mb(self) -> int:
        """音声コーデック込みのVRAM予算を返す。"""
        return OMNIVOICE_SIZE_MB

    @property
    def version(self) -> str:
        """固定revisionをキャッシュ世代として返す。"""
        return MODEL_REVISION

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
        """対応する4言語だけを合成する。未知言語は字幕のみへ縮退する。"""
        if language not in LANGUAGES:
            logger.warning("[TTS:local] 未対応言語のため合成しません: %s", language)
            return None
        return await super().synthesize(text, language)
