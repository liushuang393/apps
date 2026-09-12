"""
AIプロバイダーパッケージ

利用可能なプロバイダー:
- gpt4o_transcribe: GPT-4o-transcribe (ASR 300-500ms) + GPT-4o-mini翻訳 + TTS
- gpt_realtime: GPT-Realtime S2S (音声直接翻訳 200-400ms)
- deepgram: Deepgram Nova-3 (ASR <300ms) + GPT-4o-mini翻訳 + TTS
- gemini_live: Gemini Live S2S (音声直接翻訳 + 原文/翻訳字幕同時取得)

設定の優先順位:
- 管理者 SystemConfig(ai_pipeline) 上書き > `.env` ブートストラップ既定
- 秘密情報（API キー等）は引き続き `.env` のみ
"""

import logging
import threading

from app.ai_pipeline.effective_config import (
    get_cached_pipeline_settings,
    get_revision,
)
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
    "invalidate_ai_provider_cache",
]

_provider_lock = threading.RLock()
_cached_provider: AIProvider | None = None
_cached_provider_revision: int = -1


def invalidate_ai_provider_cache() -> None:
    """管理者切替後にプロバイダインスタンスキャッシュを破棄する。"""
    global _cached_provider, _cached_provider_revision
    with _provider_lock:
        _cached_provider = None
        _cached_provider_revision = -1


def get_ai_provider() -> AIProvider:
    """
    有効設定に基づいて AI プロバイダーを取得する（revision 単位でキャッシュ）。

    Returns:
        AIProvider: 設定されたプロバイダーインスタンス

    Raises:
        APIKeyError: 必要なAPIキーが未設定の場合
        ValueError: 不明なプロバイダーが指定された場合
    """
    global _cached_provider, _cached_provider_revision
    rev = get_revision()
    with _provider_lock:
        if _cached_provider is not None and _cached_provider_revision == rev:
            return _cached_provider
        provider = _build_ai_provider()
        _cached_provider = provider
        _cached_provider_revision = rev
        return provider


def _build_ai_provider() -> AIProvider:
    """effective 設定からプロバイダーを新規構築する。"""
    # ステージ別スロット（ASR/MT/TTS）はカスケード（Mode B 系）専用。
    # S2S プリセットとはコードパスを共有しない（registry.py の絶対原則。欠陥 #13）。
    from app.ai_pipeline.registry import build_composite_provider, composite_enabled

    pipeline = get_cached_pipeline_settings()
    provider = pipeline.ai_provider
    _S2S_PRESETS = ("gpt_realtime", "gemini_live")

    # E2E Aレーン: 環境変数または ai_provider=mock で外部 API 無しの決定論 Mock を返す。
    from app.ai_pipeline.providers.mock_provider import (
        MockAIProvider,
        e2e_mock_ai_enabled,
    )

    if e2e_mock_ai_enabled() or provider == "mock":
        logger.info(
            "[AI Provider] MockAIProvider を使用 (SONOWA_E2E_MOCK_AI=%s, ai_provider=%s)",
            "1" if e2e_mock_ai_enabled() else "0",
            provider,
        )
        return MockAIProvider()

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

    if provider == "gpt_realtime":
        from app.ai_pipeline.providers.gpt_realtime import GPTRealtimeProvider

        logger.info(
            f"[AI Provider] GPT-Realtime S2S を使用 "
            f"(model={settings.openai_realtime_model})"
        )
        return GPTRealtimeProvider()

    if provider == "deepgram":
        from app.ai_pipeline.providers.deepgram import DeepgramProvider

        logger.info(
            f"[AI Provider] Deepgram Nova-3 を使用 (model={settings.deepgram_model})"
        )
        return DeepgramProvider()

    if provider == "gemini_live":
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

    if provider == "google":
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

    valid_providers = list(AI_PROVIDER_OPTIONS_SAFE)
    raise ValueError(
        f"不明なAIプロバイダー: {provider}. 有効な値: {', '.join(valid_providers)}"
    )


# effective_config と同一の許可集合（循環 import 回避のためローカル定義）
# mock は E2E Aレーン用（本番品質検証では使わない）
AI_PROVIDER_OPTIONS_SAFE = (
    "gpt4o_transcribe",
    "gpt_realtime",
    "deepgram",
    "google",
    "gemini_live",
    "mock",
)
