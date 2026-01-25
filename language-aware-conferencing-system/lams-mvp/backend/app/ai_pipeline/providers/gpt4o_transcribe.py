"""
GPT-4o-transcribe プロバイダー

OpenAI GPT-4o-transcribe を使用した高速ASR（300-500ms）
翻訳は GPT-4o-mini、TTSは tts-1 を使用

処理フロー:
1. GPT-4o-transcribe で音声認識（高速ASR）
2. GPT-4o-mini でテキスト翻訳
3. TTS-1 で音声合成（オプション）
"""

import io
import logging

from app.ai_pipeline.providers.base import (
    LANGUAGE_NAMES,
    AIProvider,
    TranslationResult,
    check_api_key,
)
from app.config import settings

logger = logging.getLogger(__name__)


class GPT4oTranscribeProvider(AIProvider):
    """
    GPT-4o-transcribe プロバイダー

    特徴:
    - ASR遅延: 300-500ms（Whisper-1の約半分）
    - 高精度: GPT-4oベースの音声認識
    - 多言語対応: 自動言語検出も可能
    """

    def __init__(self) -> None:
        """プロバイダー初期化"""
        self._client = None
        check_api_key(settings.openai_api_key, "OpenAI")

    async def _get_client(self):
        """OpenAIクライアント取得（遅延初期化）"""
        if self._client is None:
            from openai import AsyncOpenAI

            base_url = settings.openai_base_url or "https://api.openai.com/v1"
            self._client = AsyncOpenAI(
                api_key=settings.openai_api_key,
                base_url=base_url,
            )
            logger.info(f"[GPT4o-transcribe] クライアント初期化: {base_url}")
        return self._client

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """
        GPT-4o-transcribe で音声認識

        Args:
            audio_data: WAV形式の音声データ
            language: 言語コード

        Returns:
            認識されたテキスト
        """
        # 最小音声データサイズチェック
        min_size = 44 + 8000  # WAVヘッダー + 0.25秒分
        if len(audio_data) < min_size:
            logger.debug(f"[GPT4o-transcribe] 音声が短すぎる: {len(audio_data)} bytes")
            return ""

        try:
            client = await self._get_client()

            # BytesIOでファイルオブジェクトを作成
            audio_file = io.BytesIO(audio_data)
            audio_file.name = "audio.wav"

            # ASRプロンプト
            asr_prompt = (
                "This is a real-time meeting transcription. "
                "Only transcribe actual human speech. "
                "Ignore background noise and advertisements. "
                "If no clear speech, return empty."
            )

            # GPT-4o-transcribe APIを呼び出し
            model = settings.openai_transcribe_model
            logger.debug(f"[GPT4o-transcribe] ASR開始: model={model}, lang={language}")

            response = await client.audio.transcriptions.create(
                model=model,
                file=audio_file,
                language=language if language != "zh" else "zh",
                prompt=asr_prompt,
            )

            result = response.text.strip() if response.text else ""

            # ノイズフィルタリング
            if result and self._is_noise_transcription(result):
                logger.debug(f"[GPT4o-transcribe] ノイズ除外: '{result}'")
                return ""

            if result:
                logger.info(f"[GPT4o-transcribe] ASR成功: '{result}'")
            return result

        except Exception as e:
            logger.error(f"[GPT4o-transcribe] ASRエラー: {e}", exc_info=True)
            return f"[ASRエラー: {type(e).__name__}]"

    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        """
        音声翻訳（ASR → 翻訳 → TTS）

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
            client = await self._get_client()

            # 1. ASR
            original_text = await self.transcribe_audio(audio_data, source_language)
            if not original_text or original_text.startswith("["):
                return TranslationResult(
                    source_language=source_language,
                    target_language=target_language,
                    original_text=original_text or "",
                    translated_text="",
                    audio_data=None,
                )

            # 2. テキスト翻訳
            src_name = LANGUAGE_NAMES.get(source_language, source_language)
            tgt_name = LANGUAGE_NAMES.get(target_language, target_language)
            translate_model = settings.openai_translate_model

            logger.debug(
                f"[GPT4o-transcribe] 翻訳開始: '{original_text}' -> {tgt_name}"
            )

            # 改善された翻訳プロンプト（会議シナリオに最適化）
            system_prompt = (
                f"You are a professional interpreter for multilingual meetings. "
                f"Translate the following {src_name} text into natural {tgt_name}.\n\n"
                "Guidelines:\n"
                "- Preserve the speaker's intent and tone\n"
                "- Use natural, conversational language\n"
                "- Keep technical terms accurate\n"
                "- Do NOT add explanations or notes\n"
                "- Output ONLY the translated text"
            )

            chat_response = await client.chat.completions.create(
                model=translate_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": original_text},
                ],
                max_tokens=500,
                temperature=0.2,  # 翻訳の一貫性を高める
            )
            translated_text = chat_response.choices[0].message.content
            translated_text = translated_text.strip() if translated_text else ""

            if not translated_text:
                translated_text = "[翻訳失敗]"

            logger.info(
                f"[GPT4o-transcribe] 翻訳完了: '{original_text}' -> '{translated_text}'"
            )

            # 3. TTS（オプション）
            translated_audio = None
            try:
                tts_model = settings.openai_tts_model
                tts_voice = settings.openai_tts_voice

                tts_response = await client.audio.speech.create(
                    model=tts_model,
                    voice=tts_voice,
                    input=translated_text,
                    response_format="wav",
                )
                translated_audio = tts_response.content
                logger.debug(
                    f"[GPT4o-transcribe] TTS完了: {len(translated_audio)} bytes"
                )
            except Exception as tts_err:
                logger.warning(f"[GPT4o-transcribe] TTS失敗: {tts_err}")

            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=translated_text,
                audio_data=translated_audio,
            )

        except Exception as e:
            logger.error(f"[GPT4o-transcribe] 翻訳エラー: {e}", exc_info=True)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=f"[エラー: {type(e).__name__}]",
                translated_text=f"[エラー: {type(e).__name__}]",
                audio_data=None,
            )
