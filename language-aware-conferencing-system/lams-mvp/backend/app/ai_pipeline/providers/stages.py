"""
ステージ別プロバイダー実装（ASR / MT / TTS）

目的:
    Phase 2-T5.5「Provider 集中管理」の構成要素。既存の一体型 provider を壊さず、
    ASR・MT・TTS を独立スロットとして組み合わせられるよう各ステージの実体を提供する。
入力 / 出力:
    各ステージの Protocol（registry.py 参照）に準拠する。
注意点:
    - 既存 provider（gpt4o_transcribe / google / deepgram）を再利用し重複実装を避ける。
    - OpenAI SDK 呼び出しはテスト容易性のため client を注入可能とする（未注入時は遅延初期化）。
    - 鍵未設定時の無効化判定は registry の available() が担うため、本モジュールは
      実体生成のみに集中する。
"""

import logging

from app.ai_pipeline.providers.base import (
    LANGUAGE_NAMES,
    AIProvider,
    check_api_key,
    dynamic_max_tokens,
)
from app.config import settings

logger = logging.getLogger(__name__)

# 翻訳用 system プロンプト（AI 乱話防止）。gpt4o_transcribe と同方針を踏襲する。
_MT_SYSTEM_PROMPT = (
    "[CRITICAL] You are a TRANSLATION MACHINE for multilingual meetings.\n"
    "Translate the following {src} text into {tgt}.\n"
    "Output ONLY the direct translation. Never add comments, greetings, or "
    "acknowledgments. Keep technical terms and proper nouns intact."
)


async def _new_openai_client() -> object:
    """AsyncOpenAI クライアントを生成する（base_url は設定に従う）"""
    from openai import AsyncOpenAI

    base_url = settings.openai_base_url or "https://api.openai.com/v1"
    return AsyncOpenAI(api_key=settings.openai_api_key, base_url=base_url)


class AIProviderASRStage:
    """既存 AIProvider を ASR ステージとして包むアダプター"""

    def __init__(self, provider: AIProvider, name: str) -> None:
        self._provider = provider
        self.name = name

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        return await self._provider.transcribe_audio(audio_data, language)

    async def transcribe_with_detection(
        self, audio_data: bytes, hint_language: str = "multi"
    ) -> tuple[str, str]:
        return await self._provider.transcribe_with_detection(audio_data, hint_language)


class OpenAIMTStage:
    """OpenAI Chat Completions によるテキスト翻訳（MT）ステージ"""

    name = "openai"

    def __init__(self, client: object | None = None, model: str | None = None) -> None:
        self._client = client
        self._model = model or settings.openai_translate_model
        if client is None:
            check_api_key(settings.openai_api_key, "OpenAI")

    async def _get_client(self) -> object:
        if self._client is None:
            self._client = await _new_openai_client()
            logger.info("[MT:openai] クライアント初期化")
        return self._client

    async def translate_text(
        self, text: str, source_language: str, target_language: str
    ) -> str:
        if not text or not text.strip():
            return ""
        src_name = LANGUAGE_NAMES.get(source_language, source_language)
        tgt_name = LANGUAGE_NAMES.get(target_language, target_language)
        system_prompt = _MT_SYSTEM_PROMPT.format(src=src_name, tgt=tgt_name)
        client = await self._get_client()
        response = await client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            max_tokens=dynamic_max_tokens(text),  # 改善点 Q3: 長文の訳文切れ防止
            temperature=0.2,
        )
        out = response.choices[0].message.content
        return out.strip() if out else ""


class OpenAITTSStage:
    """OpenAI TTS による音声合成ステージ"""

    name = "openai"

    def __init__(
        self,
        client: object | None = None,
        model: str | None = None,
        voice: str | None = None,
    ) -> None:
        self._client = client
        self._model = model or settings.openai_tts_model
        self._voice = voice or settings.openai_tts_voice
        if client is None:
            check_api_key(settings.openai_api_key, "OpenAI")

    async def _get_client(self) -> object:
        if self._client is None:
            self._client = await _new_openai_client()
            logger.info("[TTS:openai] クライアント初期化")
        return self._client

    async def synthesize(self, text: str, language: str) -> bytes | None:  # noqa: ARG002
        if not text or not text.strip():
            return None
        client = await self._get_client()
        response = await client.audio.speech.create(
            model=self._model,
            voice=self._voice,
            input=text,
            response_format="wav",
        )
        return response.content


class GoogleMTStage:
    """Google Cloud Translation を MT ステージとして再利用するアダプター"""

    name = "google"

    def __init__(self, provider: object | None = None) -> None:
        if provider is None:
            from app.ai_pipeline.providers.google import GoogleProvider

            provider = GoogleProvider()
        self._provider = provider

    async def translate_text(
        self, text: str, source_language: str, target_language: str
    ) -> str:
        return await self._provider.translate_text(
            text, source_language, target_language
        )


class NullTTSStage:
    """TTS を行わないステージ（Mode B / 字幕のみ運用）"""

    name = "none"

    async def synthesize(self, text: str, language: str) -> bytes | None:  # noqa: ARG002
        return None
