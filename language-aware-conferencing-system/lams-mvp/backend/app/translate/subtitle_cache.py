"""
LAMS 字幕翻訳キャッシュサービス
字幕IDベースの翻訳結果をRedisで管理

設計思想:
- 字幕IDをキーとして翻訳結果をキャッシュ
- クライアントはIDで翻訳を取得（HTTP不要でWebSocket経由も可）
- 翻訳は購読者の言語のみ実行（リソース節約）
- 翻訳中の場合は待機可能
"""

import asyncio
import json
import logging

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

# Redis接続
_redis: aioredis.Redis | None = None

# キャッシュ設定
TRANSLATION_TTL = 3600  # 1時間（会議終了後も参照可能）
TRANSLATION_PENDING_TTL = 60  # 翻訳中マーカーのTTL
MAX_WAIT_TIME = 5.0  # 最大待機時間（秒）
POLL_INTERVAL = 0.1  # ポーリング間隔（秒）


async def _get_redis() -> aioredis.Redis:
    """Redis接続取得"""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _cache_key(subtitle_id: str, target_lang: str) -> str:
    """キャッシュキー生成"""
    return f"subtitle_trans:{subtitle_id}:{target_lang}"


def _pending_key(subtitle_id: str, target_lang: str) -> str:
    """翻訳中マーカーキー"""
    return f"subtitle_trans_pending:{subtitle_id}:{target_lang}"


def _original_key(subtitle_id: str) -> str:
    """原文キャッシュキー"""
    return f"subtitle_original:{subtitle_id}"


async def store_original(
    subtitle_id: str,
    original_text: str,
    source_language: str,
) -> None:
    """
    原文をキャッシュに保存
    翻訳リクエスト時に原文を取得するため
    """
    try:
        r = await _get_redis()
        data = json.dumps(
            {"text": original_text, "lang": source_language}, ensure_ascii=False
        )
        await r.setex(_original_key(subtitle_id), TRANSLATION_TTL, data)
    except Exception as e:
        logger.warning(f"[SubtitleCache] 原文保存エラー: {e}")


async def get_original(subtitle_id: str) -> tuple[str, str] | None:
    """
    原文を取得

    Returns:
        (original_text, source_language) or None
    """
    try:
        r = await _get_redis()
        data = await r.get(_original_key(subtitle_id))
        if data:
            parsed = json.loads(data)
            return parsed["text"], parsed["lang"]
        return None
    except Exception as e:
        logger.warning(f"[SubtitleCache] 原文取得エラー: {e}")
        return None


async def store_translation(
    subtitle_id: str,
    target_lang: str,
    translated_text: str,
) -> None:
    """
    翻訳結果をキャッシュに保存
    """
    try:
        r = await _get_redis()
        key = _cache_key(subtitle_id, target_lang)
        await r.setex(key, TRANSLATION_TTL, translated_text)
        # 翻訳中マーカーを削除
        await r.delete(_pending_key(subtitle_id, target_lang))
        logger.debug(f"[SubtitleCache] 翻訳保存: {subtitle_id} -> {target_lang}")
    except Exception as e:
        logger.warning(f"[SubtitleCache] 翻訳保存エラー: {e}")


async def get_translation(
    subtitle_id: str,
    target_lang: str,
    wait: bool = True,
) -> str | None:
    """
    翻訳結果を取得

    Args:
        subtitle_id: 字幕ID
        target_lang: 目標言語
        wait: 翻訳中の場合に待機するか

    Returns:
        翻訳テキスト or None（タイムアウト/未存在）
    """
    try:
        r = await _get_redis()
        key = _cache_key(subtitle_id, target_lang)

        # まずキャッシュをチェック
        cached = await r.get(key)
        if cached:
            return cached

        if not wait:
            return None

        # 翻訳中かチェック
        pending_key = _pending_key(subtitle_id, target_lang)
        is_pending = await r.exists(pending_key)

        if not is_pending:
            # 翻訳がリクエストされていない
            return None

        # 翻訳完了を待機
        elapsed = 0.0
        while elapsed < MAX_WAIT_TIME:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            cached = await r.get(key)
            if cached:
                return cached

        logger.warning(
            f"[SubtitleCache] 翻訳待機タイムアウト: {subtitle_id}:{target_lang}"
        )
        return None

    except Exception as e:
        logger.warning(f"[SubtitleCache] 翻訳取得エラー: {e}")
        return None


async def mark_translation_pending(subtitle_id: str, target_lang: str) -> bool:
    """
    翻訳中マーカーを設定（重複翻訳防止）

    Returns:
        True: マーカー設定成功（翻訳を開始すべき）
        False: 既に翻訳中または完了済み
    """
    try:
        r = await _get_redis()

        # 既にキャッシュにあれば不要
        if await r.exists(_cache_key(subtitle_id, target_lang)):
            return False

        # 翻訳中マーカーをセット（NXで重複防止）
        pending_key = _pending_key(subtitle_id, target_lang)
        result = await r.set(pending_key, "1", ex=TRANSLATION_PENDING_TTL, nx=True)
        return result is not None

    except Exception as e:
        logger.warning(f"[SubtitleCache] マーカー設定エラー: {e}")
        return False


async def get_all_translations(subtitle_id: str) -> dict[str, str]:
    """
    字幕IDの全翻訳結果を取得

    Returns:
        {lang: translated_text, ...}
    """
    try:
        r = await _get_redis()
        pattern = f"subtitle_trans:{subtitle_id}:*"
        keys = []
        async for key in r.scan_iter(match=pattern):
            keys.append(key)

        if not keys:
            return {}

        values = await r.mget(keys)
        result = {}
        for key, value in zip(keys, values):
            if value:
                # キーから言語を抽出: subtitle_trans:{id}:{lang}
                lang = key.split(":")[-1]
                result[lang] = value

        return result

    except Exception as e:
        logger.warning(f"[SubtitleCache] 全翻訳取得エラー: {e}")
        return {}
