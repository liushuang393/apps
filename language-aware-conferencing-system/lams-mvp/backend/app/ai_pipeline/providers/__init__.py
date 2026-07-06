"""
AIプロバイダーパッケージ

利用可能なプロバイダー:
- gpt4o_transcribe: GPT-4o-transcribe (ASR 300-500ms) + GPT-4o-mini翻訳 + TTS
- gpt_realtime: GPT-Realtime S2S (音声直接翻訳 200-400ms)
- deepgram: Deepgram Nova-3 (ASR <300ms) + GPT-4o-mini翻訳 + TTS
- gemini_live: Gemini Live S2S (音声直接翻訳 + 原文/翻訳字幕同時取得)

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
from app.ai_pipeline.providers.correction import (
    CorrectionRequest,
    CorrectionResult,
    LLMCorrectionProvider,
    get_correction_provider,
)
from app.config import settings

logger = logging.getLogger(__name__)

__all__ = [
    "AIProvider",
    "APIKeyError",
    "LANGUAGE_NAMES",
    "CorrectionRequest",
    "CorrectionResult",
    "LLMCorrectionProvider",
    "TranslationResult",
    "get_ai_provider",
    "get_correction_provider",
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
    # ステージ別スロット（ASR/MT/TTS）はカスケード（Mode B 系）専用。
    # S2S プリセットとはコードパスを共有しない（registry.py の絶対原則。欠陥 #13）。
    from app.ai_pipeline.registry import build_composite_provider, composite_enabled

    provider = settings.ai_provider
    _S2S_PRESETS = ("gpt_realtime", "gemini_live")

    if composite_enabled():
        if provider in _S2S_PRESETS:
            logger.warning(
                "[AI Provider] ASR/MT/TTS スロット指定は S2S プリセット(%s)では"
                "無効です（無視して S2S を維持します）",
                provider,
            )
        else:
            logger.info("[AI Provider] ステージ別スロット指定により Composite を使用")
            return build_composite_provider()

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

    elif provider == "gemini_live":
        # Gemini Live S2S（音声直接翻訳）。GEMINI_API_KEY/ライブラリ未整備時は
        # 起動エラーにせず既存 provider（gpt4o_transcribe）へフォールバックする。
        from app.ai_pipeline.providers.gemini_live import (
            GeminiLiveProvider,
            gemini_live_runtime_available,
        )

        if not gemini_live_runtime_available():
            from app.ai_pipeline.providers.gpt4o_transcribe import (
                GPT4oTranscribeProvider,
            )

            logger.warning(
                "[AI Provider] gemini_live 指定だが GEMINI_API_KEY/ライブラリ未整備の"
                "ため gpt4o_transcribe へフォールバックします"
            )
            return GPT4oTranscribeProvider()

        logger.info(
            f"[AI Provider] Gemini Live S2S を使用 (model={settings.gemini_live_model})"
        )
        return GeminiLiveProvider()

    elif provider == "google":
        # Mode B（Chirp 3 ASR + Cloud Translation）。認証/ライブラリ未整備時は
        # 起動エラーにせず既存 provider（gpt4o_transcribe）へフォールバックする。
        from app.ai_pipeline.providers.google import (
            GoogleProvider,
            google_runtime_available,
        )

        if not google_runtime_available():
            from app.ai_pipeline.providers.gpt4o_transcribe import (
                GPT4oTranscribeProvider,
            )

            logger.warning(
                "[AI Provider] google 指定だが Google Cloud 認証/ライブラリ未整備の"
                "ため gpt4o_transcribe へフォールバックします"
            )
            return GPT4oTranscribeProvider()

        logger.info(
            f"[AI Provider] Google Chirp 3 を使用 "
            f"(model={settings.google_speech_model})"
        )
        return GoogleProvider()

    else:
        # 未知のプロバイダー
        valid_providers = [
            "gpt4o_transcribe",
            "gpt_realtime",
            "deepgram",
            "google",
            "gemini_live",
        ]
        raise ValueError(
            f"不明なAIプロバイダー: {provider}. 有効な値: {', '.join(valid_providers)}"
        )
