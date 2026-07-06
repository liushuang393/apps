"""
LAMS Google プロバイダー（Mode B 基幹：ASR → MT + 用語集 → 字幕）

目的:
    改善.md 2.2 / 6.2 の Mode B を担う。Google Cloud Speech-to-Text Chirp 3 で
    高精度 ASR を行い、Google Cloud Translation（用語集 / Adaptive Translation）
    で翻訳字幕を生成する。
入力:
    WAV 音声（LINEAR16 想定）/ 言語コード（ja, en, zh, vi）。
出力:
    TranslationResult（原文・翻訳・audio_data=None：Mode B は字幕が主役）。
注意点:
    - Mode A（OpenAI S2S）とコードパスを共有しない（絶対原則）。
    - GOOGLE 認証 / ライブラリ未整備時は factory が既存 provider へフォールバック
      する（起動エラーにしない）。
    - google-cloud-translate 未導入・翻訳失敗時は翻訳のみ OpenAI へフォールバック。
"""

import asyncio
import logging
import os
from typing import Any

from app.ai_pipeline.providers.base import (
    LANGUAGE_NAMES,
    AIProvider,
    TranslationResult,
    check_api_key,
)
from app.config import settings

logger = logging.getLogger(__name__)

# ja -> ja-JP 等の BCP-47 変換（Chirp 3 / Cloud Translation 用）
GOOGLE_BCP47_MAP: dict[str, str] = {
    "ja": "ja-JP",
    "en": "en-US",
    "zh": "zh-CN",
    "vi": "vi-VN",
}


def to_bcp47(language: str) -> str:
    """内部言語コード（ja 等）を Google の BCP-47（ja-JP 等）へ変換する"""
    return GOOGLE_BCP47_MAP.get(language, language)


def from_bcp47(code: str) -> str:
    """Google の BCP-47（ja-JP 等）を内部言語コード（ja 等）へ正規化する"""
    if not code:
        return ""
    return code.split("-")[0].lower()


def _speech_lib_available() -> bool:
    """google-cloud-speech が import 可能かを判定する"""
    import importlib.util

    return importlib.util.find_spec("google.cloud.speech") is not None


def google_runtime_available() -> bool:
    """
    Google プロバイダーを起動可能かを判定する（factory のフォールバック判断用）。

    条件: google-cloud-speech が導入済 かつ 認証情報（GOOGLE_APPLICATION_CREDENTIALS
    もしくは GOOGLE_PROJECT_ID）が存在すること。未整備なら False を返す。
    """
    if not _speech_lib_available():
        return False
    return bool(
        settings.google_project_id or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    )


def extract_transcript(results: Any) -> tuple[str, str]:
    """
    Speech-to-Text V2 のレスポンス results から (テキスト, 検出言語) を抽出する純粋関数。

    各 result は alternatives[0].transcript と language_code を持つ前提。SDK 型に依存
    せず getattr で読むため、テストではスタブを渡せる。
    """
    text_parts: list[str] = []
    detected = ""
    for r in results or []:
        alts = getattr(r, "alternatives", None) or []
        if alts:
            transcript = getattr(alts[0], "transcript", "") or ""
            if transcript.strip():
                text_parts.append(transcript.strip())
        lang = getattr(r, "language_code", "") or ""
        if lang and not detected:
            detected = lang
    return " ".join(text_parts).strip(), detected


class GoogleProvider(AIProvider):
    """
    Google Cloud（Chirp 3 ASR + Cloud Translation）プロバイダー（Mode B）。

    テスト容易性のため speech_client / openai_client を注入可能とする
    （未注入時は遅延初期化）。翻訳ライブラリ未導入時は OpenAI へフォールバックする。
    """

    name = "google"

    def __init__(
        self,
        speech_client: object | None = None,
        openai_client: object | None = None,
    ) -> None:
        self._speech_client = speech_client
        self._openai_client = openai_client
        self._project_id = settings.google_project_id
        self._speech_location = settings.google_speech_location
        if speech_client is None and not google_runtime_available():
            check_api_key(None, "Google Cloud")

    def _recognizer_path(self) -> str:
        """Speech V2 の recognizer リソースパス（既定認識器 `_`）を返す"""
        return (
            f"projects/{self._project_id}"
            f"/locations/{self._speech_location}/recognizers/_"
        )

    def _ensure_speech_client(self) -> object:
        """Speech-to-Text V2 クライアントを遅延初期化する"""
        if self._speech_client is None:
            from google.cloud.speech_v2 import SpeechClient

            self._speech_client = SpeechClient()
            logger.info("[Google] Speech V2 クライアント初期化")
        return self._speech_client

    async def _get_openai_client(self) -> object:
        """翻訳フォールバック用 OpenAI クライアントを遅延初期化する"""
        if self._openai_client is None:
            from openai import AsyncOpenAI

            check_api_key(settings.openai_api_key, "OpenAI")
            base_url = settings.openai_base_url or "https://api.openai.com/v1"
            self._openai_client = AsyncOpenAI(
                api_key=settings.openai_api_key, base_url=base_url
            )
            logger.info(f"[Google] 翻訳フォールバック用 OpenAI 初期化: {base_url}")
        return self._openai_client

    def _recognize_sync(self, audio_data: bytes, language: str) -> tuple[str, str]:
        """Chirp 3 同期認識（to_thread から呼ぶ）。(テキスト, 検出言語BCP47) を返す"""
        from google.cloud.speech_v2.types import cloud_speech

        # multi はヒントなし自動検出（Chirp の auto）
        language_codes = ["auto"] if language == "multi" else [to_bcp47(language)]
        config = cloud_speech.RecognitionConfig(
            auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
            language_codes=language_codes,
            model=settings.google_speech_model,
        )
        request = cloud_speech.RecognizeRequest(
            recognizer=self._recognizer_path(),
            config=config,
            content=audio_data,
        )
        client = self._ensure_speech_client()
        response = client.recognize(request=request)
        return extract_transcript(getattr(response, "results", None))

    async def _transcribe_with_lang_detection(
        self, audio_data: bytes, language: str
    ) -> tuple[str, str]:
        """Chirp 3 ASR の内部実装（音声認識 + 言語検出）"""
        min_size = 44 + 8000  # WAVヘッダー + 0.25秒分
        if len(audio_data) < min_size:
            logger.debug(f"[Google] 音声が短すぎる: {len(audio_data)} bytes")
            return "", "" if language == "multi" else language
        try:
            text, detected_bcp47 = await asyncio.to_thread(
                self._recognize_sync, audio_data, language
            )
            detected = from_bcp47(detected_bcp47) or (
                "" if language == "multi" else language
            )
            if text and self._is_noise_transcription(text):
                logger.debug(f"[Google] ノイズ除外: '{text}'")
                return "", detected
            if text:
                logger.info(f"[Google] ASR成功: '{text}' (lang={detected})")
            return text, detected
        except Exception as e:
            logger.error(f"[Google] ASRエラー: {e}", exc_info=True)
            # 失敗 = 空文字列の契約（欠陥 #8）。センチネル文字列は返さない。
            return "", language

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """Chirp 3 で音声認識（テキストのみ返す）"""
        text, _ = await self._transcribe_with_lang_detection(audio_data, language)
        return text

    async def transcribe_with_detection(
        self, audio_data: bytes, hint_language: str = "multi"
    ) -> tuple[str, str]:
        """音声認識 + 言語自動検出（Chirp 3 auto 対応）"""
        return await self._transcribe_with_lang_detection(audio_data, hint_language)

    def _translate_sync_google(
        self, text: str, source_language: str, target_language: str
    ) -> str:
        """Google Cloud Translation v3（用語集 / adaptive 任意）。lib 未導入時は ImportError"""
        from google.cloud.translate_v3 import TranslationServiceClient

        client = TranslationServiceClient()
        location = settings.google_translate_location
        parent = f"projects/{self._project_id}/locations/{location}"
        request: dict[str, Any] = {
            "parent": parent,
            "contents": [text],
            "mime_type": "text/plain",
            "source_language_code": to_bcp47(source_language),
            "target_language_code": to_bcp47(target_language),
        }
        if settings.google_glossary_id:
            request["glossary_config"] = {
                "glossary": f"{parent}/glossaries/{settings.google_glossary_id}",
            }
            response = client.translate_text(request=request)
            translations = getattr(response, "glossary_translations", None) or []
        else:
            response = client.translate_text(request=request)
            translations = getattr(response, "translations", None) or []
        if translations:
            return (getattr(translations[0], "translated_text", "") or "").strip()
        return ""

    async def _translate_via_openai(
        self, text: str, source_language: str, target_language: str
    ) -> str:
        """翻訳フォールバック（OpenAI）。Google Translation 不可時に使用する"""
        client = await self._get_openai_client()
        src_name = LANGUAGE_NAMES.get(source_language, source_language)
        tgt_name = LANGUAGE_NAMES.get(target_language, target_language)
        system_prompt = (
            "[CRITICAL] You are a TRANSLATION MACHINE for multilingual meetings.\n"
            f"Translate the following {src_name} text into {tgt_name}.\n"
            "Output ONLY the direct translation. Never add comments or greetings."
        )
        response = await client.chat.completions.create(
            model=settings.openai_translate_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            max_tokens=500,
            temperature=0.2,
        )
        translated = response.choices[0].message.content
        return translated.strip() if translated else ""

    async def _translate_text(
        self, text: str, source_language: str, target_language: str
    ) -> str:
        """Google Cloud Translation を試行し、失敗時は OpenAI へフォールバックする"""
        try:
            result = await asyncio.to_thread(
                self._translate_sync_google, text, source_language, target_language
            )
            if result:
                return result
            logger.warning("[Google] Cloud Translation 空応答、OpenAI へフォールバック")
        except Exception as e:
            logger.warning(
                f"[Google] Cloud Translation 利用不可のため OpenAI へフォールバック: {e}"
            )
        return await self._translate_via_openai(text, source_language, target_language)

    async def translate_text(
        self, text: str, source_language: str, target_language: str
    ) -> str:
        """
        テキストのみ翻訳する公開 API（MT ステージ用）。

        Cloud Translation を試行し失敗時は OpenAI へフォールバックする内部処理を
        そのまま利用する。Composite 構成で MT ステージとして再利用するための窓口。
        """
        if not text or not text.strip():
            return ""
        return await self._translate_text(text, source_language, target_language)

    async def translate_audio(
        self, audio_data: bytes, source_language: str, target_language: str
    ) -> TranslationResult:
        """
        Mode B 音声翻訳（Chirp 3 ASR → Cloud Translation）。

        Mode B は字幕が主役のため audio_data は付与しない（S2S は Mode A の責務）。
        同一言語時は ASR のみ。
        """
        if source_language == target_language:
            original_text = await self.transcribe_audio(audio_data, source_language)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=original_text,
                audio_data=None,
            )
        original_text = await self.transcribe_audio(audio_data, source_language)
        if not original_text:
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text="",
                translated_text="",
                audio_data=None,
            )
        translated_text = await self._translate_text(
            original_text, source_language, target_language
        )
        logger.info(f"[Google] 翻訳完了: '{original_text}' -> '{translated_text}'")
        # 失敗 = 空文字列の契約（欠陥 #8）。翻訳失敗時もセンチネルを返さない。
        return TranslationResult(
            source_language=source_language,
            target_language=target_language,
            original_text=original_text,
            translated_text=translated_text or "",
            audio_data=None,
        )
