"""
Deepgram Nova-3 プロバイダー

Deepgram Nova-3 を使用した超高速ASR（200-400ms）
翻訳は GPT-4o-mini、TTSは OpenAI tts-1 を使用

処理フロー:
1. Deepgram Nova-3 で音声認識（超低遅延ASR）
2. GPT-4o-mini でテキスト翻訳
3. TTS-1 で音声合成（オプション）

特徴:
- ASR遅延: <300ms（業界最速クラス）
- 多言語自動検出対応
- ストリーミング対応（将来拡張用）
"""

import logging
from typing import Any

import httpx

from app.ai_pipeline.providers.base import (
    LANGUAGE_NAMES,
    AIProvider,
    TranslationResult,
    check_api_key,
)
from app.config import settings

logger = logging.getLogger(__name__)

# Deepgram 言語コードマッピング
DEEPGRAM_LANGUAGE_MAP: dict[str, str] = {
    "ja": "ja",
    "en": "en",
    "zh": "zh",
    "vi": "vi",
}


class DeepgramProvider(AIProvider):
    """
    Deepgram Nova-3 プロバイダー

    特徴:
    - ASR遅延: <300ms（業界最速クラス）
    - Nova-3: 最新の高精度・低遅延モデル
    - 多言語自動検出: language=multi で自動判別
    """

    def __init__(self) -> None:
        """プロバイダー初期化"""
        self._openai_client = None
        check_api_key(settings.deepgram_api_key, "Deepgram")
        # OpenAI APIキーも必要（翻訳・TTS用）
        check_api_key(settings.openai_api_key, "OpenAI")

    async def _get_openai_client(self):
        """OpenAIクライアント取得（翻訳・TTS用）"""
        if self._openai_client is None:
            from openai import AsyncOpenAI

            base_url = settings.openai_base_url or "https://api.openai.com/v1"
            self._openai_client = AsyncOpenAI(
                api_key=settings.openai_api_key,
                base_url=base_url,
            )
            logger.info(f"[Deepgram] OpenAIクライアント初期化: {base_url}")
        return self._openai_client

    async def _call_deepgram_api(
        self,
        audio_data: bytes,
        language: str,
    ) -> dict[str, Any]:
        """
        Deepgram REST API を呼び出し

        Args:
            audio_data: 音声データ（WAV形式）
            language: 言語コード（multiで自動検出）

        Returns:
            APIレスポンス
        """
        base_url = settings.deepgram_base_url or "https://api.deepgram.com/v1"
        model = settings.deepgram_model

        # Deepgram言語コードに変換
        dg_lang = DEEPGRAM_LANGUAGE_MAP.get(language, "multi")
        if language == "multi":
            dg_lang = "multi"

        # クエリパラメータ
        params = {
            "model": model,
            "language": dg_lang,
            "punctuate": "true",
            "smart_format": "true",
        }

        # 多言語自動検出の場合
        if dg_lang == "multi":
            params["detect_language"] = "true"

        url = f"{base_url}/listen"
        headers = {
            "Authorization": f"Token {settings.deepgram_api_key}",
            "Content-Type": "audio/wav",
        }

        logger.debug(
            f"[Deepgram] API呼び出し: model={model}, lang={dg_lang}, "
            f"size={len(audio_data)} bytes"
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                params=params,
                headers=headers,
                content=audio_data,
            )
            response.raise_for_status()
            return response.json()

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """
        Deepgram Nova-3 で音声認識

        Args:
            audio_data: WAV形式の音声データ
            language: 言語コード

        Returns:
            認識されたテキスト
        """
        # 最小音声データサイズチェック
        min_size = 44 + 8000  # WAVヘッダー + 0.25秒分
        if len(audio_data) < min_size:
            logger.debug(f"[Deepgram] 音声が短すぎる: {len(audio_data)} bytes")
            return ""

        try:
            result = await self._call_deepgram_api(audio_data, language)

            # レスポンスからテキストを抽出
            text = ""
            if "results" in result:
                channels = result["results"].get("channels", [])
                if channels:
                    alternatives = channels[0].get("alternatives", [])
                    if alternatives:
                        text = alternatives[0].get("transcript", "").strip()

                # 検出された言語をログ
                detected_lang = result["results"].get("detected_language")
                if detected_lang:
                    logger.debug(f"[Deepgram] 検出言語: {detected_lang}")

            # ノイズフィルタリング
            if text and self._is_noise_transcription(text):
                logger.debug(f"[Deepgram] ノイズ除外: '{text}'")
                return ""

            if text:
                logger.info(f"[Deepgram] ASR成功: '{text}'")
            return text

        except httpx.HTTPStatusError as e:
            logger.error(
                f"[Deepgram] API HTTPエラー: {e.response.status_code} - "
                f"{e.response.text}"
            )
            return f"[APIエラー: {e.response.status_code}]"
        except Exception as e:
            logger.error(f"[Deepgram] ASRエラー: {e}", exc_info=True)
            return f"[ASRエラー: {type(e).__name__}]"

    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        """
        音声翻訳（Deepgram ASR → GPT翻訳 → TTS）

        Args:
            audio_data: WAV形式の音声データ
            source_language: 元言語コード
            target_language: 翻訳先言語コード

        Returns:
            翻訳結果
        """
        # 同一言語の場合はASRのみ
        if source_language == target_language:
            original_text = await self.transcribe_audio(audio_data, source_language)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=original_text,
                audio_data=None,
            )

        try:
            # 1. Deepgram ASR
            original_text = await self.transcribe_audio(audio_data, source_language)
            if not original_text or original_text.startswith("["):
                return TranslationResult(
                    source_language=source_language,
                    target_language=target_language,
                    original_text=original_text or "",
                    translated_text="",
                    audio_data=None,
                )

            # 2. GPT-4o-mini でテキスト翻訳
            openai_client = await self._get_openai_client()
            tgt_name = LANGUAGE_NAMES.get(target_language, target_language)
            translate_model = settings.openai_translate_model

            logger.debug(f"[Deepgram] 翻訳開始: '{original_text}' -> {tgt_name}")

            chat_response = await openai_client.chat.completions.create(
                model=translate_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            f"You are a translator. Translate to {tgt_name}. "
                            "Output only the translated text."
                        ),
                    },
                    {"role": "user", "content": original_text},
                ],
                max_tokens=500,
                temperature=0.3,
            )
            translated_text = chat_response.choices[0].message.content
            translated_text = translated_text.strip() if translated_text else ""

            if not translated_text:
                translated_text = "[翻訳失敗]"

            logger.info(
                f"[Deepgram] 翻訳完了: '{original_text}' -> '{translated_text}'"
            )

            # 3. TTS（オプション）
            translated_audio = None
            try:
                tts_response = await openai_client.audio.speech.create(
                    model=settings.openai_tts_model,
                    voice=settings.openai_tts_voice,
                    input=translated_text,
                    response_format="wav",
                )
                translated_audio = tts_response.content
                logger.debug(f"[Deepgram] TTS完了: {len(translated_audio)} bytes")
            except Exception as tts_err:
                logger.warning(f"[Deepgram] TTS失敗: {tts_err}")

            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=translated_text,
                audio_data=translated_audio,
            )

        except Exception as e:
            logger.error(f"[Deepgram] 翻訳エラー: {e}", exc_info=True)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=f"[エラー: {type(e).__name__}]",
                translated_text=f"[エラー: {type(e).__name__}]",
                audio_data=None,
            )
