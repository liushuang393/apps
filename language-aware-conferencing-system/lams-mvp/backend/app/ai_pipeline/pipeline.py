"""
LAMS AI処理パイプライン
音声の翻訳処理を統括

設計方針:
- 並列処理で遅延最小化
- QoSで品質監視
"""

import asyncio
import logging
from dataclasses import dataclass

from app.ai_pipeline.providers import get_ai_provider
from app.ai_pipeline.qos import QoSController, QoSMetrics

logger = logging.getLogger(__name__)


@dataclass
class ProcessedAudio:
    """処理済み音声データ"""

    speaker_id: str
    source_language: str
    target_language: str
    original_text: str
    translated_text: str
    audio_data: bytes | None
    metrics: QoSMetrics


class AIPipeline:
    """
    AI処理パイプライン

    機能:
    - 音声認識（ASR）
    - テキスト翻訳
    - 音声合成（TTS）※オプション
    - QoS監視
    """

    def __init__(self) -> None:
        self._qos = QoSController()
        self._provider = get_ai_provider()

    async def detect_language(
        self,
        audio_data: bytes,
        hint_language: str = "multi",
    ) -> tuple[str, str]:
        """
        音声から言語を検出

        Args:
            audio_data: 入力音声データ
            hint_language: ヒント言語（検出の補助、デフォルトは自動検出）

        Returns:
            (認識テキスト, 検出された言語コード)
        """
        return await self._provider.transcribe_with_detection(audio_data, hint_language)

    async def process_audio(
        self,
        audio_data: bytes,
        source_language: str,
        target_language: str,
        speaker_id: str = "unknown",
    ) -> ProcessedAudio:
        """
        音声を処理（翻訳）

        Args:
            audio_data: 入力音声データ
            source_language: 話者の言語
            target_language: 翻訳先言語
            speaker_id: 話者ID

        Returns:
            処理済み音声データ
        """
        metrics = self._qos.start_measurement()

        # 同じ言語の場合は翻訳不要
        if source_language == target_language:
            result = await self._provider.transcribe_audio(audio_data, source_language)
            metrics = self._qos.end_measurement(metrics)
            return ProcessedAudio(
                speaker_id=speaker_id,
                source_language=source_language,
                target_language=target_language,
                original_text=result,
                translated_text=result,
                audio_data=None,
                metrics=metrics,
            )

        # AI翻訳実行（キャッシュなし: 生PCMのMD5一致は実運用でほぼ発生せず、
        # 空結果汚染・音声消失の温床だったため撤去。テキスト翻訳キャッシュは
        # translate_text_simple 層に存在する）
        try:
            result = await self._provider.translate_audio(
                audio_data, source_language, target_language
            )
            metrics = self._qos.end_measurement(metrics)
            return ProcessedAudio(
                speaker_id=speaker_id,
                source_language=source_language,
                target_language=target_language,
                original_text=result.original_text,
                translated_text=result.translated_text,
                audio_data=result.audio_data,
                metrics=metrics,
            )
        except Exception as e:
            logger.error(f"AI処理エラー: {e}")
            metrics = self._qos.end_measurement(metrics)
            # 失敗 = 空文字列（センチネル禁止）。orchestrator の縮退判定が依存する。
            return ProcessedAudio(
                speaker_id=speaker_id,
                source_language=source_language,
                target_language=target_language,
                original_text="",
                translated_text="",
                audio_data=None,
                metrics=metrics,
            )

    async def process_for_multiple_targets(
        self,
        audio_data: bytes,
        source_language: str,
        target_languages: list[str],
        speaker_id: str = "unknown",
    ) -> dict[str, ProcessedAudio]:
        """
        複数言語に並列翻訳（遅延最適化）

        Args:
            audio_data: 入力音声
            source_language: 元言語
            target_languages: 翻訳先言語リスト
            speaker_id: 話者ID

        Returns:
            言語別の処理結果辞書
        """
        tasks = [
            self.process_audio(audio_data, source_language, tgt, speaker_id)
            for tgt in target_languages
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        output: dict[str, ProcessedAudio] = {}
        for tgt, result in zip(target_languages, results, strict=True):
            if isinstance(result, Exception):
                logger.error("%sへの翻訳エラー: %s", tgt, result)
                continue
            output[tgt] = result

        return output


# シングルトンインスタンス
ai_pipeline = AIPipeline()
