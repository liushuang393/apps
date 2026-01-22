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
    ASRはOpenAI Whisperを使用（Gemini ASRが不安定なため）。
    翻訳とTTSはGemini Live APIを使用。
    """

    # ノイズとして認識されやすいパターン（Whisperの誤認識）
    NOISE_PATTERNS = [
        "by h", "by h.", "bye", "by.", "h.", "h", "the", "a", "i", "you",
        "uh", "um", "ah", "oh", "hmm", "hm", "mm", "mhm",
        "thank you", "thanks", "okay", "ok", "yes", "no", "yeah", "yep",
        "ming pao", "ming pao canada", "ming pao toronto",
        "...", "。。。", "・・・", "…", "、", "。", ".", ",", "-", "—",
        "ご視聴ありがとうございました", "チャンネル登録", "高評価",
        "見てくれてありがとう", "ありがとうございました",
        "谢谢", "再见", "好的", "是的", "感谢观看", "订阅", "点赞",
    ]

    def __init__(self) -> None:
        """プロバイダー初期化（クライアントは遅延初期化）"""
        self._client = None

    def _is_noise_transcription(self, text: str) -> bool:
        """ノイズ認識結果かどうかを判定"""
        if not text or len(text) <= 3:
            return True
        import re
        text_clean = re.sub(r'^[\s\.\,\!\?\-\—]+|[\s\.\,\!\?\-\—]+$', '', text.lower())
        for pattern in self.NOISE_PATTERNS:
            if pattern.lower() in text_clean:
                return True
        if len(set(text.replace(" ", ""))) <= 2:
            return True
        # メディア系ノイズキーワード
        media_keywords = ["amara.org", "社群提供", "字幕", "チャンネル登録", "ご視聴", "感謝收看"]
        for kw in media_keywords:
            if kw.lower() in text_clean:
                return True
        return False

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
        OpenAI Whisper + GPT-4o-mini + TTS で音声翻訳

        Gemini Live APIは不安定なため、OpenAI APIを使用。

        処理フロー:
        1. Whisper で音声認識
        2. GPT-4o-mini でテキスト翻訳
        3. TTS で翻訳音声生成

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

        # OpenAI APIキーチェック
        if not settings.openai_api_key:
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text="[OpenAI APIキーが設定されていません]",
                translated_text="[OpenAI APIキーが設定されていません]",
            )

        try:
            from openai import AsyncOpenAI

            # 1. Whisper で音声認識
            original_text = await self.transcribe_audio(audio_data, source_language)
            if not original_text or original_text.startswith("["):
                return TranslationResult(
                    source_language=source_language,
                    target_language=target_language,
                    original_text=original_text or "",
                    translated_text="",
                    audio_data=None,
                )

            # OpenAIクライアント作成
            base_url = settings.openai_base_url if settings.openai_base_url else "https://api.openai.com/v1"
            client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=base_url)
            tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

            # 2. GPT-4o-mini でテキスト翻訳
            logger.info(f"[翻訳] GPT-4o-mini翻訳開始: '{original_text}' -> {tgt_name}")
            chat_response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": f"You are a translator. Translate the text to {tgt_name}. Output only the translated text.",
                    },
                    {"role": "user", "content": original_text},
                ],
                max_tokens=500,
                temperature=0.3,
            )
            translated_text = chat_response.choices[0].message.content
            if translated_text:
                translated_text = translated_text.strip()
            else:
                translated_text = "[翻訳失敗]"
            logger.info(f"[翻訳] GPT-4o-mini完了: '{original_text}' -> '{translated_text}'")

            # 3. TTS で翻訳音声を生成
            translated_audio = None
            try:
                tts_response = await client.audio.speech.create(
                    model="tts-1",
                    voice="alloy",
                    input=translated_text,
                    response_format="wav",
                )
                translated_audio = tts_response.content
                logger.info(f"[翻訳] TTS完了: {len(translated_audio)} bytes")
            except Exception as tts_err:
                logger.warning(f"[翻訳] TTS失敗（字幕のみ）: {tts_err}")

            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=translated_text,
                audio_data=translated_audio,
            )

        except Exception as e:
            logger.error("音声翻訳エラー: %s", e, exc_info=True)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=f"[エラー: {type(e).__name__}]",
                translated_text=f"[エラー: {type(e).__name__}]",
                audio_data=None,
            )

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """
        OpenAI Whisper APIでASR（音声認識）

        GeminiのASRは不安定なため、OpenAI Whisperを使用。

        Args:
            audio_data: WAV形式の音声データ
            language: 言語コード

        Returns:
            認識されたテキスト
        """
        logger.info(f"[ASR] transcribe_audio開始: language={language}, data_size={len(audio_data)}")

        # OpenAI APIキーチェック
        if not settings.openai_api_key:
            logger.warning("[ASR] OpenAI APIキーが設定されていません")
            return "[APIキー未設定]"

        # 最小音声データサイズチェック（WAVヘッダー44 + 0.5秒分のPCMデータ）
        min_size = 44 + 16000  # 16kHz, 16bit, mono: 0.5秒
        if len(audio_data) < min_size:
            logger.info("[ASR] 音声データが短すぎます: %d bytes", len(audio_data))
            return ""

        try:
            from openai import AsyncOpenAI
            import io

            # base_urlが空文字列の場合はOpenAI公式URLを使用
            base_url = settings.openai_base_url if settings.openai_base_url else "https://api.openai.com/v1"
            client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=base_url)
            logger.info(f"[ASR] OpenAI client created with base_url: {base_url}")

            # BytesIOでファイルオブジェクトを作成
            audio_file = io.BytesIO(audio_data)
            audio_file.name = "audio.wav"

            logger.info(f"[ASR] Whisper API呼び出し: language={language}")
            response = await client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language=language if language != "zh" else "zh",
            )

            result = response.text.strip() if response.text else ""

            # ノイズフィルタリング
            if result and self._is_noise_transcription(result):
                logger.info(f"[ASR] ノイズとして除外: '{result}'")
                return ""

            if not result:
                logger.info("[ASR] ASR結果が空です")
            else:
                logger.info(f"[ASR] ASR成功: '{result}'")
            return result
        except Exception as e:
            logger.error("[ASR] Whisper ASRエラー: %s", e, exc_info=True)
            return f"[ASRエラー: {type(e).__name__}]"


class OpenAIRealtimeProvider(AIProvider):
    """
    OpenAI プロバイダー（Whisper + GPT-4 + TTS）

    openai SDK v2.x を使用。
    処理フロー:
    1. Whisper API で音声認識（ASR）
    2. GPT-4o-mini でテキスト翻訳
    3. TTS API で音声合成（オプション）

    これにより安定したリアルタイム翻訳を実現。
    """

    # ノイズとして認識されやすいパターン（Whisperの誤認識）
    NOISE_PATTERNS = [
        # 英語ノイズ
        "by h", "by h.", "bye", "by.", "h.", "h", "the", "a", "i", "you",
        "uh", "um", "ah", "oh", "hmm", "hm", "mm", "mhm",
        "thank you", "thanks", "okay", "ok", "yes", "no", "yeah", "yep",
        "so", "and", "but", "or", "it", "is", "was", "be", "to", "of",
        "ming pao", "ming pao canada", "ming pao toronto",  # 広告系
        # 記号・無意味
        "...", "。。。", "・・・", "…", "、", "。", ".", ",", "-", "—",
        "//", "/", "\\", "|",
        # 日本語ノイズ（YouTube字幕自動生成系）
        "ご視聴ありがとうございました", "チャンネル登録", "高評価",
        "お疲れ様", "お願いします", "はい", "うん", "ええ", "あー", "えー",
        "んー", "ん", "あ", "え", "お",
        "見てくれてありがとう", "ありがとうございました", "ありがとう",
        "ばいばい", "さようなら", "ダウンロード", "少々お待ちください",
        "最後まで視聴", "本日はご視聴",
        # 中国語ノイズ
        "谢谢", "再见", "好的", "是的", "嗯", "哦", "啊",
        "感谢观看", "订阅", "点赞",
    ]

    def __init__(self) -> None:
        """プロバイダー初期化（クライアントは遅延初期化）"""
        self._client = None

    def _is_noise_transcription(self, text: str) -> bool:
        """
        ノイズ認識結果かどうかを判定

        Args:
            text: ASR結果テキスト

        Returns:
            ノイズと判定された場合True
        """
        if not text:
            return True

        # 短すぎるテキストはノイズ（3文字以下）
        if len(text) <= 3:
            return True

        # 既知のノイズパターンと一致（前後の記号を除去して比較）
        import re
        # 前後の記号・空白を除去
        text_clean = re.sub(r'^[\s\.\,\!\?\-\—]+|[\s\.\,\!\?\-\—]+$', '', text.lower())

        # 完全一致チェック
        for pattern in self.NOISE_PATTERNS:
            pattern_clean = pattern.lower().strip()
            if text_clean == pattern_clean:
                return True
            # 部分一致チェック（ノイズパターンを含む場合）
            if pattern_clean in text_clean:
                return True

        # 同じ文字の繰り返し（例：「あああ」）
        if len(set(text.replace(" ", ""))) <= 2:
            return True

        # YouTube/メディア系ノイズ（部分一致で検出）
        media_noise_keywords = [
            "amara.org", "社群提供", "字幕", "订阅", "点赞", "关注",
            "チャンネル登録", "高評価", "コメント", "再會", "再见",
            "ご視聴", "視聴", "ありがとう", "感谢观看", "感謝收看",
        ]
        for keyword in media_noise_keywords:
            if keyword.lower() in text_clean:
                return True

        return False

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
                from openai import AsyncOpenAI

                # base_urlは明示的にOpenAI APIエンドポイントを設定
                # 空文字列やNoneの場合はデフォルトURLを使用
                base_url = settings.openai_base_url or "https://api.openai.com/v1"
                self._client = AsyncOpenAI(
                    api_key=settings.openai_api_key,
                    base_url=base_url,
                )
                logger.info(f"OpenAI client initialized with base_url: {base_url}")
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
        OpenAI Whisper + GPT-4o-mini + TTS で音声翻訳

        処理フロー:
        1. Whisper API で音声認識（ASR）
        2. GPT-4o-mini でテキスト翻訳
        3. TTS API で翻訳音声を生成

        Args:
            audio_data: WAV形式の音声データ
            source_language: 元言語コード
            target_language: 翻訳先言語コード

        Returns:
            翻訳結果（音声データ + テキスト）
        """
        # 同一言語の場合はASRのみ（翻訳不要）
        if source_language == target_language:
            original_text = await self.transcribe_audio(audio_data, source_language)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=original_text,
                audio_data=None,  # 原音を使うのでNone
            )

        if not settings.openai_api_key:
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text="[APIキー未設定]",
                translated_text="[APIキー未設定]",
            )

        try:
            # 1. Whisper で音声認識
            original_text = await self.transcribe_audio(audio_data, source_language)
            if not original_text or original_text.startswith("["):
                return TranslationResult(
                    source_language=source_language,
                    target_language=target_language,
                    original_text=original_text or "",
                    translated_text="",
                    audio_data=None,
                )

            client = await self._get_client()
            tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

            # 2. GPT-4o-mini でテキスト翻訳
            chat_response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": f"You are a translator. Translate the text to {tgt_name}. Output only the translated text.",
                    },
                    {"role": "user", "content": original_text},
                ],
                max_tokens=500,
                temperature=0.3,
            )
            translated_text = chat_response.choices[0].message.content.strip()
            logger.info(f"[OpenAI] 翻訳完了: '{original_text}' -> '{translated_text}'")

            # 3. TTS で翻訳音声を生成（オプション）
            translated_audio = None
            try:
                tts_response = await client.audio.speech.create(
                    model="tts-1",
                    voice="alloy",
                    input=translated_text,
                    response_format="wav",
                )
                translated_audio = tts_response.content
                logger.info(f"[OpenAI] TTS完了: {len(translated_audio)} bytes")
            except Exception as tts_err:
                logger.warning(f"[OpenAI] TTS失敗（字幕のみ）: {tts_err}")

            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=translated_text,
                audio_data=translated_audio,
            )

        except Exception as e:
            logger.error("OpenAI翻訳エラー: %s", e, exc_info=True)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=f"[エラー: {type(e).__name__}]",
                translated_text=f"[エラー: {type(e).__name__}]",
                audio_data=None,
            )

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """
        OpenAI Whisper API で音声認識（ASR）

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
            return ""

        try:
            import io
            client = await self._get_client()

            # Whisper API で音声認識
            # BytesIOをファイルライクオブジェクトとして渡す
            audio_file = io.BytesIO(audio_data)
            audio_file.name = "audio.wav"

            response = await client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language=language if language != "zh" else "zh",  # 中国語
                response_format="text",
            )

            result = response.strip() if response else ""

            # ノイズフィルタリング: 短すぎる結果や無意味なテキストを除外
            if result and self._is_noise_transcription(result):
                logger.debug(f"[OpenAI Whisper] ノイズ除外: '{result}'")
                return ""

            if result:
                logger.info(f"[OpenAI Whisper] ASR成功: '{result}'")
            return result

        except Exception as e:
            logger.error("OpenAI Whisper ASRエラー: %s", e, exc_info=True)
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
