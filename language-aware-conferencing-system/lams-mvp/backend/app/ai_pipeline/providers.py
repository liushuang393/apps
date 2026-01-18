"""
LAMS AIプロバイダー抽象化
Gemini 2.5 Flash Native Audio / OpenAI GPT Realtime の切り替えに対応

機能:
- 音声→音声+字幕 翻訳 (Speech-to-Speech+Text Translation)
- 音声→字幕 (ASR/Transcription) - 原声モード用

設定ファイルで AI_PROVIDER を指定:
- gemini: Gemini 2.5 Flash Native Audio（推奨・デフォルト）
  モデル: models/gemini-2.5-flash-preview-native-audio-dialog
- openai_realtime: OpenAI GPT Realtime API
  モデル: gpt-4o-realtime-preview

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
                # 空文字列の場合はデフォルト（None）を使用
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
        Gemini Native Audio Live API で音声→音声翻訳（底線）

        処理フロー:
        1. Live API で音声→音声翻訳（必須）
        2. 字幕が取得できない場合は非同期でテキスト翻訳

        Args:
            audio_data: WAV形式の音声データ
            source_language: 元言語コード
            target_language: 翻訳先言語コード

        Returns:
            翻訳結果（音声データ + テキスト）
        """
        # 同一言語の場合はASRのみ
        if source_language == target_language:
            original_text = await self.transcribe_audio(audio_data, source_language)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=original_text,
                audio_data=audio_data,
            )

        if not settings.gemini_api_key:
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text="[Gemini APIキーが設定されていません]",
                translated_text="[Gemini APIキーが設定されていません]",
            )

        try:
            from google.genai import types

            client = await self._get_client()
            src_name = LANGUAGE_NAMES.get(source_language, source_language)
            tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

            # Live API で音声+テキスト同時翻訳（音声と字幕の言語一致を保証）
            model = settings.gemini_model
            config = types.LiveConnectConfig(
                responseModalities=["AUDIO", "TEXT"],
                speechConfig=types.SpeechConfig(
                    voiceConfig=types.VoiceConfig(
                        prebuiltVoiceConfig=types.PrebuiltVoiceConfig(
                            voiceName="Aoede"
                        )
                    )
                ),
                systemInstruction=types.Content(
                    parts=[types.Part(text=(
                        f"You are a translator. Translate {src_name} audio to {tgt_name}. "
                        f"Speak the translation naturally and also provide the text."
                    ))]
                ),
            )

            translated_audio = b""
            translated_text = ""
            async with client.aio.live.connect(model=model, config=config) as session:
                # 音声データを送信
                await session.send(input=audio_data, mime_type="audio/wav")
                await session.send(end_of_turn=True)

                # 翻訳音声+テキストを受信
                async for response in session.receive():
                    if response.server_content:
                        sc = response.server_content
                        if sc.model_turn:
                            for part in sc.model_turn.parts:
                                if part.inline_data:
                                    translated_audio += part.inline_data.data
                                if part.text:
                                    translated_text += part.text
                        if sc.turn_complete:
                            break

            # 音声翻訳成功チェック（底線）
            if not translated_audio:
                raise RuntimeError("Live APIから音声が返されませんでした")

            # 原文は非同期で取得（翻訳済み音声+字幕は既に一致）
            original_text = await self.transcribe_audio(audio_data, source_language)

            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=translated_text or "[翻訳テキスト取得失敗]",
                audio_data=translated_audio,
            )

        except Exception as e:
            logger.error("Gemini Live API音声翻訳エラー: %s", e)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text="[音声翻訳エラー]",
                translated_text="[音声翻訳エラー]",
                audio_data=audio_data,
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
            logger.warning("Gemini APIキーが設定されていません")
            return "[APIキー未設定]"

        # 最小音声データサイズチェック（WAVヘッダー44 + 0.25秒分のPCMデータ）
        min_size = 44 + 8000  # 16kHz, 16bit, mono: 0.25秒
        if len(audio_data) < min_size:
            logger.debug("音声データが短すぎます: %d bytes", len(audio_data))
            return ""  # 空文字を返す（短すぎるデータは無視）

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

            # Gemini で音声認識（generateContent API用モデルを使用）
            # NOTE: Native Audioモデルは Live API専用のため、ASRにはテキストモデルを使用
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=settings.gemini_text_model,
                contents=[
                    audio_part,
                    f"この音声を{lang_name}でテキストに変換してください。"
                    "テキストのみを返してください。",
                ],
            )
            result = response.text.strip() if response.text else ""
            if not result:
                logger.debug("ASR結果が空です（無音または認識不可）")
            return result
        except Exception as e:
            logger.error("Gemini ASRエラー: %s", e)
            return f"[ASRエラー: {type(e).__name__}]"


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
                # 空文字列の場合は None を渡してデフォルトURLを使用
                self._client = AsyncOpenAI(
                    api_key=settings.openai_api_key,
                    base_url=settings.openai_base_url or None,
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
        OpenAI GPT Realtime で音声→音声+字幕翻訳

        処理フロー:
        1. Realtime API に音声を送信
        2. 翻訳済み音声+テキストを取得

        Args:
            audio_data: WAV形式の音声データ
            source_language: 元言語コード
            target_language: 翻訳先言語コード

        Returns:
            翻訳結果（音声データ + テキスト）
        """
        # 同一言語の場合はASRのみ
        if source_language == target_language:
            original_text = await self.transcribe_audio(audio_data, source_language)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=original_text,
                audio_data=audio_data,  # 原音をそのまま返す
            )

        if not settings.openai_api_key:
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text="[OpenAI APIキーが設定されていません]",
                translated_text="[OpenAI APIキーが設定されていません]",
            )

        try:
            import base64

            client = await self._get_client()
            src_name = LANGUAGE_NAMES.get(source_language, source_language)
            tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

            # Realtime API で音声翻訳（音声+テキスト出力）
            async with client.realtime.connect(
                model=settings.openai_realtime_model
            ) as connection:
                # 音声+テキスト出力を設定
                await connection.session.update(
                    session={
                        "modalities": ["text", "audio"],
                        "instructions": (
                            f"You are a real-time translator. "
                            f"Translate the {src_name} audio to {tgt_name}. "
                            f"Respond with the translation in {tgt_name} speech and text."
                        ),
                        "voice": "alloy",
                        "input_audio_format": "pcm16",
                        "output_audio_format": "pcm16",
                    }
                )

                # 音声データを送信（Base64エンコード）
                audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                await connection.input_audio_buffer.append(audio=audio_b64)
                await connection.input_audio_buffer.commit()
                await connection.response.create()

                translated_text = ""
                audio_chunks: list[bytes] = []

                async for event in connection:
                    if event.type == "response.audio_transcript.delta":
                        translated_text += event.delta
                    elif event.type == "response.audio.delta":
                        audio_chunks.append(base64.b64decode(event.delta))
                    elif event.type == "response.done":
                        break

                translated_text = translated_text.strip()

                # 音声データを結合
                translated_audio = b"".join(audio_chunks) if audio_chunks else None

            # 原文も取得（字幕表示用）
            original_text = await self.transcribe_audio(audio_data, source_language)

            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=translated_text or f"[翻訳エラー] {original_text}",
                audio_data=translated_audio,
            )

        except Exception as e:
            logger.error("OpenAI Realtime音声翻訳エラー: %s", e)
            # エラー時はASRでフォールバック
            original_text = await self.transcribe_audio(audio_data, source_language)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=f"[翻訳エラー] {original_text}",
                audio_data=audio_data,  # 原音をフォールバック
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
            logger.warning("OpenAI APIキーが設定されていません")
            return "[APIキー未設定]"

        # 最小音声データサイズチェック
        min_size = 44 + 8000  # WAVヘッダー + 0.25秒分
        if len(audio_data) < min_size:
            logger.debug("音声データが短すぎます: %d bytes", len(audio_data))
            return ""  # 空文字を返す（短すぎるデータは無視）

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

            result = result_text.strip() if result_text else ""
            if not result:
                logger.debug("ASR結果が空です（無音または認識不可）")
            return result
        except Exception as e:
            logger.error("OpenAI Realtime ASRエラー: %s", e)
            return f"[ASRエラー: {type(e).__name__}]"


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
