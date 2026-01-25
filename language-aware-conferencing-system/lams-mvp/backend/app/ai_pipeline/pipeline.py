"""
LAMS AI処理パイプライン
音声の翻訳処理を統括

設計方針:
- 並列処理で遅延最小化
- キャッシュで重複処理回避
- QoSで品質監視
"""

import asyncio
import hashlib
import logging
from dataclasses import dataclass

import redis.asyncio as aioredis

from app.ai_pipeline.providers import get_ai_provider
from app.ai_pipeline.qos import QoSController, QoSMetrics
from app.config import settings

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
    - 結果キャッシュ
    - QoS監視
    """

    def __init__(self) -> None:
        self._qos = QoSController()
        self._provider = get_ai_provider()
        self._redis: aioredis.Redis | None = None
        self._cache_ttl = 3600  # 1時間

    async def _get_redis(self) -> aioredis.Redis:
        """Redis接続取得"""
        if self._redis is None:
            self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        return self._redis

    def _cache_key(self, audio_hash: str, src: str, tgt: str) -> str:
        """キャッシュキー生成"""
        return f"translate:{src}:{tgt}:{audio_hash}"

    async def _get_cached(self, cache_key: str) -> str | None:
        """キャッシュから取得"""
        try:
            r = await self._get_redis()
            return await r.get(cache_key)
        except Exception:
            return None

    async def _set_cached(self, cache_key: str, value: str) -> None:
        """キャッシュに保存"""
        try:
            r = await self._get_redis()
            await r.setex(cache_key, self._cache_ttl, value)
        except Exception as e:
            logger.warning(f"キャッシュ保存エラー: {e}")

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

        # キャッシュチェック
        audio_hash = hashlib.md5(audio_data).hexdigest()
        cache_key = self._cache_key(audio_hash, source_language, target_language)
        cached = await self._get_cached(cache_key)

        if cached:
            # キャッシュヒット
            original, translated = cached.split("|||", 1)
            metrics = self._qos.end_measurement(metrics)
            return ProcessedAudio(
                speaker_id=speaker_id,
                source_language=source_language,
                target_language=target_language,
                original_text=original,
                translated_text=translated,
                audio_data=None,
                metrics=metrics,
            )

        # AI翻訳実行
        try:
            result = await self._provider.translate_audio(
                audio_data, source_language, target_language
            )

            # キャッシュ保存
            await self._set_cached(
                cache_key, f"{result.original_text}|||{result.translated_text}"
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
            return ProcessedAudio(
                speaker_id=speaker_id,
                source_language=source_language,
                target_language=target_language,
                original_text="[処理エラー]",
                translated_text="[処理エラー]",
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
