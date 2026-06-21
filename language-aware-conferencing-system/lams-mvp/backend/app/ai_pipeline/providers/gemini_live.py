"""
Gemini Live S2S プロバイダー（音声直接翻訳）

Google Gemini Live API（models/gemini-3.5-live-translate-preview）を用いた
Speech-to-Speech 翻訳。1 セッションで以下を同時取得する:
- 翻訳音声（24kHz PCM → WAV）
- 原文文字起こし（input_audio_transcription、言語自動検出付き）
- 翻訳文字起こし（output_audio_transcription）

入力:
    WAV 音声（16kHz mono 16bit PCM 想定。フロントエンドの送信形式と一致）。
出力:
    TranslationResult（原文・翻訳・audio_data=翻訳音声 WAV）。
注意点:
    - Mode A（OpenAI S2S）とコードパスを共有しない（絶対原則）。
    - GEMINI_API_KEY 未設定時は factory 側で gpt4o_transcribe へフォールバックする。
    - 音声出力は 24kHz PCM のため WAV ヘッダーを付与して返す。
"""

import asyncio
import logging
import struct
from dataclasses import dataclass, field

from app.ai_pipeline.providers.base import (
    AIProvider,
    TranslationResult,
    check_api_key,
)
from app.config import settings

logger = logging.getLogger(__name__)

# WAV ヘッダーサイズ（標準 44 バイト）
WAV_HEADER_SIZE = 44
# Gemini Live の入出力サンプルレート（公式仕様: 16kHz in / 24kHz out）
GEMINI_INPUT_SAMPLE_RATE = 16000
GEMINI_OUTPUT_SAMPLE_RATE = 24000
GEMINI_INPUT_MIME = f"audio/pcm;rate={GEMINI_INPUT_SAMPLE_RATE}"
# 最小音声サイズ（44 + 8000 バイト ≒ 250ms）。これ未満は処理しない。
MIN_AUDIO_SIZE = WAV_HEADER_SIZE + 8000
# レスポンス収集タイムアウト（秒）
RESPONSE_TIMEOUT_SEC = 15.0
# 言語検出セッションの翻訳ターゲット（出力音声は破棄するため固定で良い）
DETECTION_TARGET_LANG = "en"

# 内部コード -> Gemini Live 翻訳ターゲット（BCP-47。簡易コードで受理される）
GEMINI_TARGET_LANG: dict[str, str] = {
    "ja": "ja",
    "en": "en",
    "zh": "zh",
    "vi": "vi",
}


def to_gemini_target(language: str) -> str:
    """内部言語コードを Gemini Live 翻訳ターゲット（BCP-47）へ変換する"""
    return GEMINI_TARGET_LANG.get(language, language)


def normalize_lang(code: str) -> str:
    """Gemini の BCP-47（ja-JP 等）を内部コード（ja 等）へ正規化する"""
    if not code:
        return ""
    return code.split("-")[0].lower()


def pcm16_to_wav(
    pcm_data: bytes, sample_rate: int = GEMINI_OUTPUT_SAMPLE_RATE
) -> bytes:
    """PCM16 モノラルデータに WAV ヘッダーを付与する"""
    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(pcm_data)
    file_size = 36 + data_size
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        file_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    return header + pcm_data


@dataclass
class LiveResult:
    """Gemini Live セッションの解析結果"""

    original: str = ""
    translated: str = ""
    detected_language: str = ""
    audio_chunks: list[bytes] = field(default_factory=list)

    @property
    def audio(self) -> bytes:
        """結合済み PCM 音声バイト列"""
        return b"".join(self.audio_chunks)


def parse_live_messages(messages: object) -> LiveResult:
    """
    Gemini Live の LiveServerMessage 列から原文・翻訳・音声・検出言語を抽出する純粋関数。

    SDK 型に依存せず getattr で読むため、テストではスタブメッセージを渡せる。
    """
    result = LiveResult()
    for msg in messages or []:
        sc = getattr(msg, "server_content", None)
        if sc is None:
            continue
        it = getattr(sc, "input_transcription", None)
        if it is not None:
            text = getattr(it, "text", None)
            if text:
                result.original += text
            lang = getattr(it, "language_code", None)
            if lang:
                result.detected_language = lang
        ot = getattr(sc, "output_transcription", None)
        if ot is not None and getattr(ot, "text", None):
            result.translated += ot.text
        mt = getattr(sc, "model_turn", None)
        if mt is not None:
            for part in getattr(mt, "parts", None) or []:
                inline = getattr(part, "inline_data", None)
                if inline is not None and getattr(inline, "data", None):
                    result.audio_chunks.append(inline.data)
    return result


def gemini_live_runtime_available() -> bool:
    """gemini_live プロバイダーを起動可能か判定する（factory のフォールバック判断用）"""
    import importlib.util

    if importlib.util.find_spec("google.genai") is None:
        return False
    return bool(settings.gemini_api_key)


class GeminiLiveProvider(AIProvider):
    """
    Gemini Live S2S プロバイダー

    特徴:
    - 音声→翻訳音声を直接変換（S2S）し、原文・翻訳字幕も同時取得
    - 言語自動検出（input_audio_transcription の language_code）
    """

    def __init__(self, client: object | None = None) -> None:
        """プロバイダー初期化（client はテスト用に注入可能）"""
        self._client = client
        if client is None:
            check_api_key(settings.gemini_api_key, "Gemini")

    def _ensure_client(self) -> object:
        """google-genai クライアントを遅延初期化する"""
        if self._client is None:
            from google import genai
            from google.genai import types as genai_types

            http_options = None
            base_url = settings.gemini_base_url
            if base_url and base_url != "https://gemini.googleapis.com":
                http_options = genai_types.HttpOptions(base_url=base_url)
            self._client = genai.Client(
                api_key=settings.gemini_api_key, http_options=http_options
            )
            logger.info("[Gemini Live] クライアント初期化")
        return self._client

    def _wav_to_pcm16(self, wav_data: bytes) -> bytes:
        """WAV データから PCM16 データを抽出（44 バイトヘッダーをスキップ）"""
        if len(wav_data) < WAV_HEADER_SIZE:
            return b""
        return wav_data[WAV_HEADER_SIZE:]

    def _build_config(self, target_language: str) -> object:
        """LiveConnectConfig を構築する（翻訳 + 入出力文字起こし）

        注意: Developer API（api_key）モードでは input_audio_transcription の
        language_codes が未サポート（Enterprise 専用）のため、言語ヒントは
        指定せず Gemini の自動言語検出に委ねる。検出結果は応答の
        input_transcription.language_code から取得する。
        """
        from google.genai import types

        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            translation_config=types.TranslationConfig(
                target_language_code=to_gemini_target(target_language),
                echo_target_language=False,
            ),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
        )

    async def _collect_messages(self, session: object) -> list:
        """turn_complete まで（またはストリーム終了まで）メッセージを収集する"""
        messages: list = []
        async for msg in session.receive():
            messages.append(msg)
            sc = getattr(msg, "server_content", None)
            if sc is not None and getattr(sc, "turn_complete", False):
                break
        return messages

    async def _run_live(self, pcm_data: bytes, config: object) -> LiveResult:
        """Live セッションを開始し、音声送信〜レスポンス収集〜解析を行う"""
        from google.genai import types

        client = self._ensure_client()
        async with client.aio.live.connect(
            model=settings.gemini_live_model, config=config
        ) as session:
            await session.send_realtime_input(
                audio=types.Blob(data=pcm_data, mime_type=GEMINI_INPUT_MIME)
            )
            await session.send_realtime_input(audio_stream_end=True)
            messages = await asyncio.wait_for(
                self._collect_messages(session), timeout=RESPONSE_TIMEOUT_SEC
            )
        return parse_live_messages(messages)

    async def transcribe_with_detection(
        self,
        audio_data: bytes,
        hint_language: str = "multi",
    ) -> tuple[str, str]:
        """音声認識 + 言語検出（Gemini Live の input_transcription を利用）"""
        fallback_lang = hint_language if hint_language != "multi" else ""
        if len(audio_data) < MIN_AUDIO_SIZE:
            logger.debug(f"[Gemini Live] 音声が短すぎる: {len(audio_data)} bytes")
            return "", fallback_lang

        try:
            pcm_data = self._wav_to_pcm16(audio_data)
            if not pcm_data:
                return "", fallback_lang
            config = self._build_config(DETECTION_TARGET_LANG)
            result = await self._run_live(pcm_data, config)
            text = result.original.strip()
            detected = normalize_lang(result.detected_language) or fallback_lang
            if text and self._is_noise_transcription(text):
                logger.debug(f"[Gemini Live] ノイズ除外: '{text}'")
                return "", detected
            if text:
                logger.info(
                    f"[Gemini Live] ASR+言語検出: '{text[:30]}...' "
                    f"(detected={detected})"
                )
            return text, detected
        except Exception as e:
            logger.error(f"[Gemini Live] 言語検出ASRエラー: {e}", exc_info=True)
            return "", fallback_lang

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """音声認識（transcribe_with_detection を利用しテキストのみ返す）"""
        text, _ = await self.transcribe_with_detection(audio_data, language)
        return text

    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        """Speech-to-Speech 翻訳（Gemini Live API）"""
        if source_language == target_language:
            text = await self.transcribe_audio(audio_data, source_language)
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=text,
                translated_text=text,
                audio_data=None,
            )

        empty = TranslationResult(
            source_language=source_language,
            target_language=target_language,
            original_text="",
            translated_text="",
            audio_data=None,
        )
        if len(audio_data) < MIN_AUDIO_SIZE:
            logger.debug(f"[Gemini Live] 音声が短すぎる: {len(audio_data)} bytes")
            return empty

        try:
            pcm_data = self._wav_to_pcm16(audio_data)
            if not pcm_data:
                return empty
            logger.info(
                f"[Gemini Live] S2S翻訳開始: {source_language} -> {target_language}, "
                f"pcm_size={len(pcm_data)} bytes"
            )
            config = self._build_config(target_language)
            result = await self._run_live(pcm_data, config)

            translated_text = result.translated.strip()
            original_text = result.original.strip()
            if translated_text and self._is_noise_transcription(translated_text):
                logger.debug(f"[Gemini Live] ノイズ除外: '{translated_text}'")
                return empty

            translated_audio = pcm16_to_wav(result.audio) if result.audio else None
            if translated_text:
                logger.info(f"[Gemini Live] S2S翻訳完了: '{translated_text}'")
            else:
                logger.info("[Gemini Live] 翻訳結果が空（無音または認識失敗）")
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=translated_text,
                audio_data=translated_audio,
            )
        except Exception as e:
            logger.error(f"[Gemini Live] S2S翻訳エラー: {e}", exc_info=True)
            return empty
