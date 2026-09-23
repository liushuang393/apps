"""全localの同時常駐構成を、発話を受け付ける前に準備する。

起動時の保存設定を入力とし、準備成功をboolで返す。失敗時も管理APIを維持し、
クラウドへ切り替えない。ウォームアップ音声は配信・保存しない。
"""

import logging

from app.ai_pipeline.effective_config import PipelineSettingsValues
from app.ai_pipeline.providers.local_multimodal import (
    MODEL_SIZE_MB,
    LocalMultimodalStage,
)
from app.ai_pipeline.providers.local_tts import MODEL_SIZE_MB as TTS_SIZE_MB
from app.ai_pipeline.providers.local_tts import create_stage
from app.ai_pipeline.vram_broker import broker
from app.audio.pcm import wrap_wav16

logger = logging.getLogger(__name__)
WARMUP_SAMPLE_RATE = 16000
WARMUP_SAMPLE_WIDTH = 2


async def prepare_local_pipeline(values: PipelineSettingsValues) -> bool:
    """選択された2モデルだけを事前ロードし、初回推論を温める。"""
    if any(
        provider != "local"
        for provider in (values.asr_provider, values.mt_provider, values.tts_provider)
    ):
        return False
    required = MODEL_SIZE_MB + TTS_SIZE_MB
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
        tts = create_stage()
        await tts.prepare()
        # 1秒の無音を使い、音声エンコーダーの初回初期化を発話経路から外す。
        silence = wrap_wav16(
            bytes(WARMUP_SAMPLE_RATE * WARMUP_SAMPLE_WIDTH), WARMUP_SAMPLE_RATE
        )
        await asr.transcribe_audio(silence, "en")
        if not await tts.synthesize("Ready.", "en"):
            logger.warning("[LOCAL] TTSウォームアップ未完了。字幕へ縮退します")
            return False
        logger.info("[LOCAL] 2モデル準備完了: %s", broker.resident_keys())
        return True
    except Exception:
        logger.exception("[LOCAL] モデル準備失敗。クラウドへの切替は行いません")
        return False
