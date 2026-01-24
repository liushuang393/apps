"""
LAMS AIプロバイダー

このモジュールは後方互換性のためのリダイレクト。
実際の実装は app.ai_pipeline.providers パッケージにある。

利用可能なプロバイダー:
- gpt4o_transcribe: GPT-4o-transcribe ASR (300-500ms) + 翻訳 + TTS
- gpt_realtime: GPT-Realtime S2S (200-400ms, 音声直接翻訳)
- deepgram: Deepgram Nova-3 ASR (<300ms) + 翻訳 + TTS

設定は .env ファイルで管理（ハードコードなし）:
- AI_PROVIDER: プロバイダー選択
- OPENAI_API_KEY, OPENAI_TRANSCRIBE_MODEL など: OpenAI設定
- DEEPGRAM_API_KEY, DEEPGRAM_MODEL など: Deepgram設定
"""

# 後方互換性のため、providers パッケージから再エクスポート
from app.ai_pipeline.providers import (
    LANGUAGE_NAMES,
    AIProvider,
    APIKeyError,
    TranslationResult,
    get_ai_provider,
)

__all__ = [
    "AIProvider",
    "APIKeyError",
    "LANGUAGE_NAMES",
    "TranslationResult",
    "get_ai_provider",
]


# 旧プロバイダー名のエイリアス（後方互換性用）
# 新規コードでは直接 providers パッケージを使用すること
def check_openai_api_key() -> None:
    """後方互換性用: APIKeyErrorを使用してください"""
    from app.ai_pipeline.providers.base import check_api_key
    from app.config import settings

    check_api_key(settings.openai_api_key, "OpenAI")
