"""
LAMS AIプロバイダー抽象化
Gemini 2.5 Flash Native Audio / OpenAI GPT Realtime の切り替えに対応

機能:
- 音声→音声翻訳 (Speech-to-Speech Translation)
- 音声→字幕翻訳 (Speech-to-Translated-Text)
- 原声→字幕 (ASR/Transcription)
- TTS (Text-to-Speech)

設定ファイルで AI_PROVIDER を指定:
- gemini: Gemini 2.5 Flash Native Audio（推奨・デフォルト）
  モデル: models/gemini-2.5-flash-native-audio-preview-12-2025
- openai_realtime: OpenAI GPT Realtime API
  モデル: gpt-realtime-2025-08-28 または gpt-realtime-mini-2025-10-06

SDK バージョン:
- google-genai >= 1.0.0 (新SDK、google-generativeaiは廃止)
- openai >= 2.0.0
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.config import settings

logger = logging.getLogger(__name__)

# 対応言語マッピング（AIへの指示用）
LANGUAGE_NAMES: dict[str, str] = {
    "ja": "日本語",
    "en": "English",
    "zh": "中文",
    "vi": "Tiếng Việt",
}


@dataclass
class TranslationResult:
    """翻訳結果データクラス"""

    source_language: str
    target_language: str
    original_text: str
    translated_text: str
    audio_data: bytes | None = None  # TTS音声データ（オプション）


class AIProvider(ABC):
    """
    AIプロバイダー基底クラス

    すべてのAIプロバイダーはこのクラスを継承し、
    translate_audio と transcribe_audio メソッドを実装する必要がある。
    """

    @abstractmethod
    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        """
        音声を翻訳

        Args:
            audio_data: 入力音声データ（WAV形式）
            source_language: 元言語コード（ja, en, zh, vi）
            target_language: 翻訳先言語コード

        Returns:
            翻訳結果（テキスト + 音声）
        """

    @abstractmethod
    async def transcribe_audio(
        self,
        audio_data: bytes,
        language: str,
    ) -> str:
        """
        音声をテキストに変換（ASR）

        Args:
            audio_data: 入力音声データ（WAV形式）
            language: 言語コード

        Returns:
            認識されたテキスト
        """


class GeminiProvider(AIProvider):
    """
    Gemini 2.5 Flash Native Audio プロバイダー

    google-genai SDK v1.0+ を使用。
    公式ドキュメント: https://ai.google.dev/gemini-api/docs

    対応モデル:
    - models/gemini-2.5-flash-native-audio-preview-12-2025

    機能:
    - 音声認識（ASR）: Native Audio のマルチモーダル機能
    - テキスト翻訳: Gemini 2.5 Flash
    - リアルタイム音声処理: Live API
    """

    def __init__(self) -> None:
        """プロバイダー初期化（クライアントは遅延初期化）"""
        self._client = None

    async def _get_client(self):
        """
        Geminiクライアント取得（遅延初期化）

        Returns:
            genai.Client インスタンス

        Raises:
            ImportError: google-genai パッケージ未インストール時
        """
        if self._client is None:
            try:
                # google-genai SDK v1.0+ の正しいインポート方法
                from google import genai
                from google.genai import types as genai_types

                # base_url は http_options で設定（カスタムエンドポイント対応）
                http_options = None
                if settings.gemini_base_url:
                    http_options = genai_types.HttpOptions(
                        base_url=settings.gemini_base_url
                    )

                self._client = genai.Client(
                    api_key=settings.gemini_api_key,
                    http_options=http_options,
                )
            except ImportError as err:
                logger.error("google-genai パッケージがインストールされていません")
                raise ImportError(
                    "google-genai パッケージが必要です: pip install google-genai"
                ) from err
        return self._client

    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        """
        Gemini 2.5 Flashで音声翻訳

        処理フロー:
        1. ASRで音声をテキスト化
        2. テキストを翻訳（同一言語の場合はスキップ）

        Args:
            audio_data: WAV形式の音声データ
            source_language: 元言語コード
            target_language: 翻訳先言語コード

        Returns:
            翻訳結果
        """
        # ASRでテキスト化
        original_text = await self.transcribe_audio(audio_data, source_language)

        # 同一言語の場合は翻訳不要
        if source_language == target_language:
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=original_text,
            )

        # テキスト翻訳
        client = await self._get_client()
        src_name = LANGUAGE_NAMES.get(source_language, source_language)
        tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

        prompt = (
            f"以下の{src_name}のテキストを{tgt_name}に翻訳してください。\n"
            "翻訳結果のみを返してください。説明は不要です。\n\n"
            f"テキスト: {original_text}"
        )

        try:
            # google-genai SDK v1.0+ の正しい使用方法
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=settings.gemini_model,  # 設定から取得
                contents=prompt,
            )
            translated_text = response.text.strip() if response.text else original_text
        except Exception as e:
            logger.error("Gemini翻訳エラー: %s", e)
            translated_text = original_text

        return TranslationResult(
            source_language=source_language,
            target_language=target_language,
            original_text=original_text,
            translated_text=translated_text,
        )

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """
        Gemini 2.5 FlashでASR（音声認識）

        google-genai SDK v1.0+ の types.Part.from_bytes() を使用。

        Args:
            audio_data: WAV形式の音声データ
            language: 言語コード

        Returns:
            認識されたテキスト
        """
        if not settings.gemini_api_key:
            return "[Gemini APIキーが設定されていません]"

        try:
            # google-genai SDK v1.0+ の正しいインポート
            from google.genai import types

            client = await self._get_client()
            lang_name = LANGUAGE_NAMES.get(language, language)

            # types.Part.from_bytes() を使用（推奨方法）
            audio_part = types.Part.from_bytes(
                data=audio_data,
                mime_type="audio/wav",
            )

            # Gemini で音声認識（モデル名は設定から取得）
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=settings.gemini_model,
                contents=[
                    audio_part,
                    f"この音声を{lang_name}でテキストに変換してください。"
                    "テキストのみを返してください。",
                ],
            )
            return response.text.strip() if response.text else "[認識結果なし]"
        except Exception as e:
            logger.error("Gemini ASRエラー: %s", e)
            return "[音声認識エラー]"


class OpenAIRealtimeProvider(AIProvider):
    """
    OpenAI GPT Realtime プロバイダー

    openai SDK v2.x を使用。
    公式ドキュメント: https://platform.openai.com/docs/guides/realtime

    対応モデル:
    - gpt-realtime-2025-08-28
    - gpt-realtime-mini-2025-10-06

    機能:
    - Realtime API による音声認識・翻訳
    - WebSocket ベースのリアルタイム通信
    """

    def __init__(self) -> None:
        """プロバイダー初期化（クライアントは遅延初期化）"""
        self._client = None

    async def _get_client(self):
        """
        OpenAIクライアント取得（遅延初期化）

        Returns:
            AsyncOpenAI インスタンス

        Raises:
            ImportError: openai パッケージ未インストール時
        """
        if self._client is None:
            try:
                # openai SDK v2.x の正しいインポート方法
                from openai import AsyncOpenAI

                # base_url は設定から取得（カスタムエンドポイント対応）
                self._client = AsyncOpenAI(
                    api_key=settings.openai_api_key,
                    base_url=settings.openai_base_url,  # None の場合はデフォルト
                )
            except ImportError as err:
                logger.error("openai パッケージがインストールされていません")
                raise ImportError(
                    "openai パッケージが必要です: pip install openai"
                ) from err
        return self._client

    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        """
        OpenAI GPT Realtime で音声翻訳

        処理フロー:
        1. Realtime API で音声認識・翻訳を一括処理

        Args:
            audio_data: WAV形式の音声データ
            source_language: 元言語コード
            target_language: 翻訳先言語コード

        Returns:
            翻訳結果
        """
        # ASRでテキスト化
        original_text = await self.transcribe_audio(audio_data, source_language)

        # 同一言語の場合は翻訳不要
        if source_language == target_language:
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=original_text,
            )

        client = await self._get_client()
        src_name = LANGUAGE_NAMES.get(source_language, source_language)
        tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

        try:
            # GPT Realtime モデルでテキスト翻訳
            # (Realtime APIのテキストモードを使用)
            async with client.realtime.connect(
                model=settings.openai_realtime_model
            ) as connection:
                await connection.session.update(session={"output_modalities": ["text"]})
                await connection.conversation.item.create(
                    item={
                        "type": "message",
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": (
                                    f"{src_name}を{tgt_name}に翻訳してください。"
                                    f"翻訳結果のみ返してください:\n{original_text}"
                                ),
                            }
                        ],
                    }
                )
                await connection.response.create()

                translated_text = ""
                async for event in connection:
                    if event.type == "response.output_text.delta":
                        translated_text += event.delta
                    elif event.type == "response.done":
                        break
                translated_text = translated_text.strip() or original_text
        except Exception as e:
            logger.error("OpenAI Realtime翻訳エラー: %s", e)
            translated_text = original_text

        return TranslationResult(
            source_language=source_language,
            target_language=target_language,
            original_text=original_text,
            translated_text=translated_text,
        )

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """
        OpenAI GPT Realtime でASR（音声認識）

        openai SDK v2.x の Realtime API を使用。

        Args:
            audio_data: WAV形式の音声データ
            language: 言語コード

        Returns:
            認識されたテキスト
        """
        if not settings.openai_api_key:
            return "[OpenAI APIキーが設定されていません]"

        try:
            import base64

            client = await self._get_client()
            lang_name = LANGUAGE_NAMES.get(language, language)

            # Realtime API でリアルタイム音声認識
            async with client.realtime.connect(
                model=settings.openai_realtime_model
            ) as connection:
                await connection.session.update(session={"output_modalities": ["text"]})
                # 音声データをBase64エンコードして送信
                audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                await connection.conversation.item.create(
                    item={
                        "type": "message",
                        "role": "user",
                        "content": [
                            {"type": "input_audio", "audio": audio_b64},
                            {
                                "type": "input_text",
                                "text": f"この音声を{lang_name}でテキストに変換してください。",
                            },
                        ],
                    }
                )
                await connection.response.create()

                result_text = ""
                async for event in connection:
                    if event.type == "response.output_text.delta":
                        result_text += event.delta
                    elif event.type == "response.done":
                        break

            return result_text.strip() if result_text else "[認識結果なし]"
        except Exception as e:
            logger.error("OpenAI Realtime ASRエラー: %s", e)
            return "[音声認識エラー]"


def get_ai_provider() -> AIProvider:
    """
    設定に基づいてAIプロバイダーを取得

    環境変数 AI_PROVIDER で切り替え:
    - gemini: Gemini 2.5 Flash（デフォルト）
    - openai_realtime: OpenAI GPT Realtime

    Returns:
        AIProvider: 設定されたプロバイダーインスタンス
    """
    if settings.ai_provider == "openai_realtime":
        logger.info("OpenAI Realtime プロバイダーを使用")
        return OpenAIRealtimeProvider()
    logger.info("Gemini プロバイダーを使用")
    return GeminiProvider()
