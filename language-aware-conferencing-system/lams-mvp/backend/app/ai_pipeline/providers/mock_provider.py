"""
E2E / Aレーン向け Mock AI プロバイダー

目的:
    外部 API キー無しで ASR・MT・TTS を決定論的に返す。
    Playwright 等の Aレーン（モック AI）でネットワーク依存を排除する。

入力 / 出力:
    - transcribe_audio: WAV バイト列 → 固定日本語テキスト（長さ帯域で決定）
    - translate_audio: WAV + 言語 → TranslationResult（辞書 MT + 無音 TTS）
    - TTS: 短い無音 PCM を WAV で返す（サンプルレート 24kHz）

注意点:
    - 本番品質検証（Bレーン）では使用しない。
    - API キー検査は行わない。
"""

from __future__ import annotations

import logging
import os

from app.ai_pipeline.providers.base import AIProvider, TranslationResult
from app.audio.pcm import wrap_wav16

logger = logging.getLogger(__name__)

# TTS 出力サンプルレート（OpenAI TTS / hearing 系と揃える）
_TTS_SAMPLE_RATE_HZ = 24_000
# 無音 TTS の長さ（秒）— 短い固定長で決定論を保つ
_TTS_DURATION_SEC = 0.1
# WAV ヘッダー長（短すぎ判定の下限）
_WAV_HEADER_BYTES = 44
# 音声が短すぎるとみなす PCM 下限（約 0.05 秒 @16kHz int16）
_MIN_PCM_BYTES = 1600

# 音声バイト長帯域 → 固定日本語 ASR 結果（決定論）
_ASR_BY_LENGTH: tuple[tuple[int, str], ...] = (
    (2_000, "こんにちは"),
    (8_000, "本日の議題を確認します"),
    (32_000, "来週の予定について話し合いましょう"),
    (128_000, "以上で本日の会議を終了します"),
)
_ASR_FALLBACK = "モック認識テキスト"

# ja → 各言語の簡易辞書（未登録はプレフィックス付き原文）
_MT_DICT: dict[str, dict[str, str]] = {
    "en": {
        "こんにちは": "Hello",
        "本日の議題を確認します": "Let's review today's agenda",
        "来週の予定について話し合いましょう": "Let's discuss next week's schedule",
        "以上で本日の会議を終了します": "That concludes today's meeting",
        "モック認識テキスト": "Mock recognition text",
    },
    "zh": {
        "こんにちは": "你好",
        "本日の議題を確認します": "确认今天的议题",
        "来週の予定について話し合いましょう": "讨论下周的安排",
        "以上で本日の会議を終了します": "今天的会议到此结束",
        "モック認識テキスト": "模拟识别文本",
    },
    "vi": {
        "こんにちは": "Xin chào",
        "本日の議題を確認します": "Hãy xác nhận chương trình họp hôm nay",
        "来週の予定について話し合いましょう": "Hãy thảo luận lịch tuần tới",
        "以上で本日の会議を終了します": "Cuộc họp hôm nay kết thúc tại đây",
        "モック認識テキスト": "Văn bản nhận dạng giả",
    },
}


def e2e_mock_ai_enabled() -> bool:
    """環境変数 LAMS_E2E_MOCK_AI=1 で Mock AI 強制が有効かを返す。"""
    return os.environ.get("LAMS_E2E_MOCK_AI", "").strip() == "1"


def translate_text_mock(text: str, target_language: str) -> str:
    """
    決定論的な簡易 MT。

    Args:
        text: 原文（主に日本語）
        target_language: 翻訳先言語コード

    Returns:
        辞書ヒット時は訳文、それ以外は "[mock-{lang}] {text}"
    """
    if not text:
        return ""
    if target_language == "ja":
        return text
    table = _MT_DICT.get(target_language)
    if table and text in table:
        return table[text]
    return f"[mock-{target_language}] {text}"


def build_silent_tts_wav(
    *,
    sample_rate: int = _TTS_SAMPLE_RATE_HZ,
    duration_sec: float = _TTS_DURATION_SEC,
) -> bytes:
    """
    無音 int16 PCM を WAV で返す。

    Args:
        sample_rate: サンプルレート（Hz）
        duration_sec: 長さ（秒）

    Returns:
        WAV バイト列（ゼロ埋め PCM）
    """
    num_samples = max(1, int(sample_rate * duration_sec))
    pcm = b"\x00\x00" * num_samples
    return wrap_wav16(pcm, sample_rate)


def asr_text_for_audio_length(audio_len: int) -> str:
    """
    音声バイト長から固定日本語 ASR 結果を返す。

    Args:
        audio_len: 入力音声のバイト長

    Returns:
        認識テキスト。短すぎる場合は空文字。
    """
    if audio_len < _WAV_HEADER_BYTES + _MIN_PCM_BYTES:
        return ""
    for threshold, text in _ASR_BY_LENGTH:
        if audio_len < threshold:
            return text
    return _ASR_FALLBACK


class MockAIProvider(AIProvider):
    """
    外部 API 不要の決定論 Mock プロバイダー（E2E Aレーン用）。
    """

    def __init__(self) -> None:
        """初期化（API キー不要）。"""
        logger.info("[MockAI] MockAIProvider を初期化（外部 API 不使用）")

    async def transcribe_audio(self, audio_data: bytes, language: str) -> str:
        """
        音声長に基づく決定論 ASR。

        Args:
            audio_data: WAV 形式の音声データ
            language: 言語コード（結果選択には未使用・インターフェース互換）

        Returns:
            固定日本語テキスト、または空文字
        """
        _ = language
        text = asr_text_for_audio_length(len(audio_data))
        if text and self._is_noise_transcription(text):
            return ""
        return text

    async def translate_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
        original_text: str | None = None,
    ) -> TranslationResult:
        """
        ASR（必要時）→ 辞書 MT → 無音 TTS。

        Args:
            audio_data: WAV 形式の音声データ
            source_language: 元言語コード
            target_language: 翻訳先言語コード
            original_text: 上流 ASR 済み原文（あれば再 ASR しない）

        Returns:
            翻訳結果（audio_data は無音 WAV）
        """
        if original_text is None:
            original_text = await self.transcribe_audio(audio_data, source_language)
        if not original_text:
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text="",
                translated_text="",
                audio_data=None,
            )

        if source_language == target_language:
            return TranslationResult(
                source_language=source_language,
                target_language=target_language,
                original_text=original_text,
                translated_text=original_text,
                audio_data=build_silent_tts_wav(),
            )

        translated = translate_text_mock(original_text, target_language)
        return TranslationResult(
            source_language=source_language,
            target_language=target_language,
            original_text=original_text,
            translated_text=translated,
            audio_data=build_silent_tts_wav(),
        )
