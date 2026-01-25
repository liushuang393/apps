"""
LAMS 翻訳プロキシAPIルート
クライアントからの翻訳リクエストを処理し、結果をキャッシュ

目的:
- クライアント側で翻訳を行うが、APIキーは公開しない
- サーバー側でキャッシュし、同じテキストの重複翻訳を防ぐ
"""

import hashlib
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.config import settings
from app.db.models import User

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


class TranslateRequest(BaseModel):
    """翻訳リクエスト"""

    text: str
    source_language: str  # ja, en, zh, vi
    target_language: str  # ja, en, zh, vi


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
            return TranslateResponse(
                original_text=req.text,
                translated_text=cached,
                source_language=req.source_language,
                target_language=req.target_language,
                cached=True,
            )
    except Exception as e:
        logger.warning(f"[Translate] キャッシュ取得エラー: {e}")

    # OpenAI APIで翻訳
    translated_text = await _call_openai_translate(
        req.text, req.source_language, req.target_language
    )

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
    text: str, source_language: str, target_language: str
) -> str:
    """
    OpenAI APIでテキスト翻訳を実行

    Args:
        text: 翻訳対象テキスト
        source_language: 元言語コード
        target_language: 翻訳先言語コード

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

    try:
        response = await client.chat.completions.create(
            model=settings.openai_translate_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are a professional simultaneous interpreter specializing in "
                        f"{src_name}-{tgt_name} translation for business meetings.\n\n"
                        f"Translate the following {src_name} speech into natural, fluent {tgt_name}.\n\n"
                        "Translation Guidelines:\n"
                        "- Maintain the speaker's original meaning and intent precisely\n"
                        "- Use natural, idiomatic expressions in the target language\n"
                        "- Preserve technical terms, proper nouns, and numbers accurately\n"
                        "- Keep the same level of formality as the source\n"
                        f"{lang_specific_hints}"
                        "- Do NOT add explanations, notes, or extra context\n"
                        "- Do NOT translate literally word-by-word\n"
                        "- Output ONLY the translated text, nothing else"
                    ),
                },
                {"role": "user", "content": text},
            ],
            max_tokens=500,
            temperature=0.1,  # 更低的温度提高翻译一致性
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
