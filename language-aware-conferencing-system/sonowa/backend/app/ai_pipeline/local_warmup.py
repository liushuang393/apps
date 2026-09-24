"""local ASR/MT（と結線済みの local TTS）を、発話を受け付ける前に準備する。

起動時の保存設定を入力とし、準備成功をboolで返す。失敗時も管理APIを維持し、
クラウドへ切り替えない。ウォームアップ音声は配信・保存しない。
"""

import logging

from app.ai_pipeline.effective_config import PipelineSettingsValues
from app.ai_pipeline.providers import local_tts
from app.ai_pipeline.providers.local_multimodal import (
    MODEL_SIZE_MB,
    LocalMultimodalStage,
)
from app.ai_pipeline.vram_broker import broker
from app.audio.pcm import wrap_wav16

logger = logging.getLogger(__name__)
WARMUP_SAMPLE_RATE = 16000
WARMUP_SAMPLE_WIDTH = 2


async def prepare_local_pipeline(values: PipelineSettingsValues) -> bool:
    """ASR/MT が local のとき Gemma を事前ロードし、結線済みなら local TTS も温める。"""
    if values.asr_provider != "local" or values.mt_provider != "local":
        return False
    with_tts = values.tts_provider == "local" and local_tts.available()
    required = MODEL_SIZE_MB + (local_tts.MODEL_SIZE_MB if with_tts else 0)
    if broker.budget_mb < required:
        logger.warning(
            "[LOCAL] 同時常駐の予算不足: required=%sMB budget=%sMB",
            required,
            broker.budget_mb,
        )
        return False
    try:
        asr = LocalMultimodalStage()
        await asr.prepare()
        # 1秒の無音を使い、音声エンコーダーの初回初期化を発話経路から外す。
        silence = wrap_wav16(
            bytes(WARMUP_SAMPLE_RATE * WARMUP_SAMPLE_WIDTH), WARMUP_SAMPLE_RATE
        )
        await asr.transcribe_audio(silence, "en")
        if with_tts:
            tts = local_tts.create_stage()
            await tts.prepare()
            if not await tts.synthesize("Ready.", "en"):
                logger.warning("[LOCAL] TTSウォームアップ未完了。字幕へ縮退します")
                return False
        logger.info("[LOCAL] モデル準備完了: %s", broker.resident_keys())
        return True
    except Exception:
        logger.exception("[LOCAL] モデル準備失敗。クラウドへの切替は行いません")
        return False
