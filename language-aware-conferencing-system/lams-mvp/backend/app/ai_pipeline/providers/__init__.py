"""
AIプロバイダーパッケージ

利用可能なプロバイダー:
- gpt4o_transcribe: GPT-4o-transcribe (ASR 300-500ms) + GPT-4o-mini翻訳 + TTS
- gpt_realtime: GPT-Realtime S2S (音声直接翻訳 200-400ms)
- deepgram: Deepgram Nova-3 (ASR <300ms) + GPT-4o-mini翻訳 + TTS

設定は .env ファイルで管理:
- AI_PROVIDER: プロバイダー選択
- OPENAI_API_KEY, OPENAI_BASE_URL: OpenAI API設定
- DEEPGRAM_API_KEY, DEEPGRAM_BASE_URL: Deepgram API設定
- モデル名は各種 *_MODEL 変数で指定
"""

import logging

from app.ai_pipeline.providers.base import (
    LANGUAGE_NAMES,
    AIProvider,
    APIKeyError,
    TranslationResult,
)
from app.config import settings

logger = logging.getLogger(__name__)

__all__ = [
    "AIProvider",
    "APIKeyError",
    "LANGUAGE_NAMES",
    "TranslationResult",
    "get_ai_provider",
]


def get_ai_provider() -> AIProvider:
    """
    設定に基づいてAIプロバイダーを取得

    環境変数 AI_PROVIDER で切り替え:
    - gpt4o_transcribe: GPT-4o-transcribe + GPT-4o-mini + TTS（デフォルト）
    - gpt_realtime: GPT-Realtime S2S（最速、音声直接翻訳）
    - deepgram: Deepgram Nova-3 + GPT-4o-mini + TTS（高精度ASR）

    Returns:
        AIProvider: 設定されたプロバイダーインスタンス

    Raises:
        APIKeyError: 必要なAPIキーが未設定の場合
        ValueError: 不明なプロバイダーが指定された場合
    """
    provider = settings.ai_provider

    if provider == "gpt4o_transcribe":
        from app.ai_pipeline.providers.gpt4o_transcribe import GPT4oTranscribeProvider

        logger.info(
            f"[AI Provider] GPT-4o-transcribe を使用 "
            f"(model={settings.openai_transcribe_model})"
        )
        return GPT4oTranscribeProvider()

    elif provider == "gpt_realtime":
        from app.ai_pipeline.providers.gpt_realtime import GPTRealtimeProvider

        logger.info(
            f"[AI Provider] GPT-Realtime S2S を使用 "
            f"(model={settings.openai_realtime_model})"
        )
        return GPTRealtimeProvider()

    elif provider == "deepgram":
        from app.ai_pipeline.providers.deepgram import DeepgramProvider

        logger.info(
            f"[AI Provider] Deepgram Nova-3 を使用 (model={settings.deepgram_model})"
        )
        return DeepgramProvider()

    else:
        # 未知のプロバイダー
        valid_providers = ["gpt4o_transcribe", "gpt_realtime", "deepgram"]
        raise ValueError(
            f"不明なAIプロバイダー: {provider}. 有効な値: {', '.join(valid_providers)}"
        )
