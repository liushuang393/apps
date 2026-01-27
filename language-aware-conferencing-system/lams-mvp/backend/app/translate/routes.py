"""
LAMS 翻訳プロキシAPIルート
クライアントからの翻訳リクエストを処理し、結果をキャッシュ

目的:
- クライアント側で翻訳を行うが、APIキーは公開しない
- サーバー側でキャッシュし、同じテキストの重複翻訳を防ぐ
- ★改善: 会話コンテキストを考慮した翻訳で一貫性向上
- ★改善: 字幕IDベースの翻訳取得（最小遅延）
"""

import hashlib
import json
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.config import settings
from app.db.models import User
from app.translate import subtitle_cache

logger = logging.getLogger(__name__)
router = APIRouter()

# 言語名マッピング
LANGUAGE_NAMES = {
    "ja": "Japanese",
    "en": "English",
    "zh": "Chinese",
    "vi": "Vietnamese",
}

# Redisキャッシュ
_redis: aioredis.Redis | None = None
CACHE_TTL = 3600 * 24  # 24時間キャッシュ

# ★会話コンテキスト設定
CONTEXT_MAX_ITEMS = 5  # 保持する翻訳履歴の最大数
CONTEXT_TTL = 1800  # 30分（会議中のコンテキスト有効期限）


async def _get_redis() -> aioredis.Redis:
    """Redis接続取得"""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _cache_key(text: str, src: str, tgt: str) -> str:
    """キャッシュキー生成（テキストハッシュベース）"""
    text_hash = hashlib.md5(text.encode()).hexdigest()
    return f"text_translate:{src}:{tgt}:{text_hash}"


def _context_key(user_id: str, room_id: str | None) -> str:
    """★会話コンテキストキー生成"""
    if room_id:
        return f"translate_context:{room_id}:{user_id}"
    return f"translate_context:global:{user_id}"


async def _get_context(user_id: str, room_id: str | None) -> list[dict]:
    """
    ★会話コンテキストを取得
    最近の翻訳履歴を返却（翻訳の一貫性向上に使用）
    """
    try:
        r = await _get_redis()
        key = _context_key(user_id, room_id)
        data = await r.get(key)
        return json.loads(data) if data else []
    except Exception as e:
        logger.warning(f"[Context] 取得エラー: {e}")
        return []


async def _add_context(user_id: str, room_id: str | None, src: str, tgt: str) -> None:
    """
    ★翻訳をコンテキストに追加
    最新N件を保持し、古いものは削除
    """
    try:
        r = await _get_redis()
        key = _context_key(user_id, room_id)
        context = await _get_context(user_id, room_id)
        context.append({"src": src, "tgt": tgt})
        # 最新N件のみ保持
        context = context[-CONTEXT_MAX_ITEMS:]
        await r.setex(key, CONTEXT_TTL, json.dumps(context, ensure_ascii=False))
    except Exception as e:
        logger.warning(f"[Context] 保存エラー: {e}")


class TranslateRequest(BaseModel):
    """翻訳リクエスト"""

    text: str
    source_language: str  # ja, en, zh, vi
    target_language: str  # ja, en, zh, vi
    room_id: str | None = None  # ★会話コンテキスト用（オプション）


class TranslateResponse(BaseModel):
    """翻訳レスポンス"""

    original_text: str
    translated_text: str
    source_language: str
    target_language: str
    cached: bool = False


@router.post("", response_model=TranslateResponse)
async def translate_text(
    req: TranslateRequest,
    user: User = Depends(get_current_user),
) -> TranslateResponse:
    """
    テキスト翻訳プロキシAPI

    クライアントはAPIキー不要でこのエンドポイントを呼び出し、
    サーバーがOpenAI APIを使って翻訳を実行する。
    結果はRedisにキャッシュされ、同じテキストの重複翻訳を防ぐ。
    """
    # バリデーション
    if req.source_language not in LANGUAGE_NAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"未対応の言語: {req.source_language}",
        )
    if req.target_language not in LANGUAGE_NAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"未対応の言語: {req.target_language}",
        )

    # 同じ言語なら翻訳不要
    if req.source_language == req.target_language:
        return TranslateResponse(
            original_text=req.text,
            translated_text=req.text,
            source_language=req.source_language,
            target_language=req.target_language,
            cached=True,
        )

    # 空文字チェック
    if not req.text.strip():
        return TranslateResponse(
            original_text=req.text,
            translated_text=req.text,
            source_language=req.source_language,
            target_language=req.target_language,
            cached=True,
        )

    # キャッシュチェック
    cache_key = _cache_key(req.text, req.source_language, req.target_language)
    try:
        r = await _get_redis()
        cached = await r.get(cache_key)
        if cached:
            logger.debug(f"[Translate] キャッシュヒット: {req.text[:20]}...")
            # ★コンテキストに追加（キャッシュヒットでも一貫性のため）
            await _add_context(user.id, req.room_id, req.text, cached)
            return TranslateResponse(
                original_text=req.text,
                translated_text=cached,
                source_language=req.source_language,
                target_language=req.target_language,
                cached=True,
            )
    except Exception as e:
        logger.warning(f"[Translate] キャッシュ取得エラー: {e}")

    # ★会話コンテキストを取得
    context = await _get_context(user.id, req.room_id)

    # OpenAI APIで翻訳（★コンテキスト付き）
    translated_text = await _call_openai_translate(
        req.text, req.source_language, req.target_language, context
    )

    # ★コンテキストに追加
    await _add_context(user.id, req.room_id, req.text, translated_text)

    # キャッシュ保存
    try:
        r = await _get_redis()
        await r.setex(cache_key, CACHE_TTL, translated_text)
    except Exception as e:
        logger.warning(f"[Translate] キャッシュ保存エラー: {e}")

    return TranslateResponse(
        original_text=req.text,
        translated_text=translated_text,
        source_language=req.source_language,
        target_language=req.target_language,
        cached=False,
    )


async def _call_openai_translate(
    text: str,
    source_language: str,
    target_language: str,
    context: list[dict] | None = None,
) -> str:
    """
    OpenAI APIでテキスト翻訳を実行

    Args:
        text: 翻訳対象テキスト
        source_language: 元言語コード
        target_language: 翻訳先言語コード
        context: ★会話コンテキスト（最近の翻訳履歴）

    Returns:
        翻訳されたテキスト
    """
    from openai import AsyncOpenAI

    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="翻訳サービスが設定されていません",
        )

    client = AsyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url if settings.openai_base_url else None,
    )

    src_name = LANGUAGE_NAMES[source_language]
    tgt_name = LANGUAGE_NAMES[target_language]

    # 言語ペア別の翻訳指示を追加（翻訳品質向上）
    lang_specific_hints = ""
    if target_language == "ja":
        lang_specific_hints = "- Use polite Japanese (です/ます form)\n"
    elif target_language == "zh":
        lang_specific_hints = "- Use simplified Chinese characters\n"
    elif target_language == "vi":
        lang_specific_hints = "- Use standard Vietnamese with proper diacritics\n"

    # ★会話コンテキストを追加（翻訳の一貫性向上）
    context_str = ""
    if context:
        context_str = (
            "\n\nRecent conversation for context (maintain terminology consistency):\n"
        )
        for i, item in enumerate(context[-3:], 1):  # 直近3件のみ
            context_str += f'{i}. "{item["src"]}" → "{item["tgt"]}"\n'
        context_str += "\n"

    try:
        # ★★★ 強化された翻訳プロンプト（AI乱話防止）★★★
        response = await client.chat.completions.create(
            model=settings.openai_translate_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"【警告】あなたは翻訳機です。翻訳以外は絶対禁止です。\n\n"
                        f"[CRITICAL WARNING] You are a TRANSLATION MACHINE, not a conversational AI.\n\n"
                        f"You are a professional interpreter for {src_name}-{tgt_name} translation.\n"
                        f"Translate the following {src_name} text into natural {tgt_name}.\n\n"
                        "ABSOLUTE RULES - VIOLATION IS FORBIDDEN:\n"
                        "- Output ONLY the direct translation of the input\n"
                        "- NEVER add comments, greetings, or acknowledgments\n"
                        "- NEVER say 'I understand', 'OK', 'Sure', 'はい、承知しました', etc.\n"
                        "- NEVER engage in conversation or respond to the content\n"
                        "- Preserve the speaker's meaning, tone, and formality\n"
                        "- Keep technical terms and proper nouns intact\n"
                        f"{lang_specific_hints}"
                        "- Maintain consistency with previous translations\n"
                        f"{context_str}\n"
                        "FORBIDDEN: Any response that is not a direct translation."
                    ),
                },
                {"role": "user", "content": text},
            ],
            max_tokens=500,
            temperature=0.1,  # 低温度で翻訳一致性向上
        )

        translated = response.choices[0].message.content
        translated = translated.strip() if translated else ""

        if not translated:
            logger.warning(f"[Translate] 翻訳結果が空: {text[:30]}...")
            return "[翻訳失敗]"

        logger.info(f"[Translate] 翻訳完了: '{text[:20]}...' -> '{translated[:20]}...'")
        return translated

    except Exception as e:
        logger.error(f"[Translate] OpenAI APIエラー: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"翻訳エラー: {e!s}",
        )


async def translate_text_simple(
    text: str, source_language: str, target_language: str
) -> str:
    """
    ★シンプルなテキスト翻訳（内部API用）
    WebSocketハンドラーからのプリ翻訳に使用

    Args:
        text: 翻訳対象テキスト
        source_language: 元言語コード
        target_language: 翻訳先言語コード

    Returns:
        翻訳されたテキスト。エラー時は空文字列
    """
    # 同じ言語なら翻訳不要
    if source_language == target_language:
        return text

    # 空文字チェック
    if not text.strip():
        return text

    # キャッシュチェック
    cache_key = _cache_key(text, source_language, target_language)
    try:
        r = await _get_redis()
        cached = await r.get(cache_key)
        if cached:
            logger.debug(f"[PreTranslate] キャッシュヒット: {text[:20]}...")
            return cached
    except Exception as e:
        logger.warning(f"[PreTranslate] キャッシュ取得エラー: {e}")

    # 翻訳実行
    try:
        translated = await _call_openai_translate(
            text, source_language, target_language
        )

        # キャッシュ保存
        try:
            r = await _get_redis()
            await r.setex(cache_key, CACHE_TTL, translated)
        except Exception as e:
            logger.warning(f"[PreTranslate] キャッシュ保存エラー: {e}")

        return translated
    except Exception as e:
        logger.warning(f"[PreTranslate] 翻訳エラー: {e}")
        return ""


# ============================================================
# 字幕IDベースの翻訳API（最小遅延設計）
# ============================================================


class SubtitleTranslationResponse(BaseModel):
    """字幕翻訳レスポンス"""

    subtitle_id: str
    target_language: str
    translated_text: str | None
    status: str  # "ready" | "pending" | "not_found"


@router.get(
    "/subtitle/{subtitle_id}/{target_lang}", response_model=SubtitleTranslationResponse
)
async def get_subtitle_translation(
    subtitle_id: str,
    target_lang: str,
    wait: bool = Query(default=True, description="翻訳中の場合に待機するか"),
    user: User = Depends(get_current_user),
) -> SubtitleTranslationResponse:
    """
    字幕IDで翻訳を取得

    ★最小遅延設計★
    - Redisに翻訳結果があれば即返却
    - 翻訳中の場合はwait=trueで完了を待機
    - 翻訳がリクエストされていない場合は即時翻訳を開始

    Args:
        subtitle_id: 字幕の一意識別子
        target_lang: 目標言語（ja/en/zh/vi）
        wait: 翻訳中の場合に待機するか（デフォルト: true）

    Returns:
        翻訳結果とステータス
    """
    # 言語バリデーション
    if target_lang not in LANGUAGE_NAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"未対応の言語: {target_lang}",
        )

    # キャッシュから取得を試みる
    translated = await subtitle_cache.get_translation(
        subtitle_id, target_lang, wait=False
    )
    if translated:
        return SubtitleTranslationResponse(
            subtitle_id=subtitle_id,
            target_language=target_lang,
            translated_text=translated,
            status="ready",
        )

    # 原文を取得
    original = await subtitle_cache.get_original(subtitle_id)
    if not original:
        return SubtitleTranslationResponse(
            subtitle_id=subtitle_id,
            target_language=target_lang,
            translated_text=None,
            status="not_found",
        )

    original_text, source_lang = original

    # 同じ言語なら翻訳不要
    if source_lang == target_lang:
        return SubtitleTranslationResponse(
            subtitle_id=subtitle_id,
            target_language=target_lang,
            translated_text=original_text,
            status="ready",
        )

    # 翻訳中マーカーをチェック/設定
    should_translate = await subtitle_cache.mark_translation_pending(
        subtitle_id, target_lang
    )

    if should_translate:
        # このリクエストが翻訳を担当
        try:
            translated = await translate_text_simple(
                original_text, source_lang, target_lang
            )
            if translated:
                await subtitle_cache.store_translation(
                    subtitle_id, target_lang, translated
                )
                return SubtitleTranslationResponse(
                    subtitle_id=subtitle_id,
                    target_language=target_lang,
                    translated_text=translated,
                    status="ready",
                )
            else:
                # 翻訳結果が空の場合、原文を返す（フォールバック）
                logger.warning(f"[SubtitleTranslate] 翻訳結果が空: {subtitle_id}")
                return SubtitleTranslationResponse(
                    subtitle_id=subtitle_id,
                    target_language=target_lang,
                    translated_text=original_text,  # 原文をフォールバック
                    status="ready",
                )
        except Exception as e:
            logger.error(f"[SubtitleTranslate] 翻訳エラー: {e}")
            return SubtitleTranslationResponse(
                subtitle_id=subtitle_id,
                target_language=target_lang,
                translated_text=original_text,  # エラー時も原文を返す
                status="ready",
            )

    # 他のリクエストが翻訳中 → 待機
    if wait:
        translated = await subtitle_cache.get_translation(
            subtitle_id, target_lang, wait=True
        )
        if translated:
            return SubtitleTranslationResponse(
                subtitle_id=subtitle_id,
                target_language=target_lang,
                translated_text=translated,
                status="ready",
            )

    return SubtitleTranslationResponse(
        subtitle_id=subtitle_id,
        target_language=target_lang,
        translated_text=None,
        status="pending",
    )
