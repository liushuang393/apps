"""
LAMS 翻訳プロキシAPIルート
クライアントからの翻訳リクエストを処理し、結果をキャッシュ

目的:
- クライアント側で翻訳を行うが、APIキーは公開しない
- サーバー側でキャッシュし、同じテキストの重複翻訳を防ぐ
- ★改善: 会話コンテキストを考慮した翻訳で一貫性向上

注意:
    字幕IDベースの翻訳取得API（最小遅延）は subtitle_routes.py へ分離した
    （ファイルサイズ規約: 500行推奨）。本モジュールは翻訳プロキシ本体に専念する。
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db.models import User
from app.translate import engine as translation_engine

logger = logging.getLogger(__name__)
router = APIRouter()

# 翻訳エンジンの公開面を後方互換のため再エクスポートする。
LANGUAGE_NAMES = translation_engine.LANGUAGE_NAMES
CACHE_TTL = translation_engine.CACHE_TTL
_get_redis = translation_engine._get_redis
_cache_key = translation_engine._cache_key
_glossary_version = translation_engine._glossary_version
bump_glossary_version = translation_engine.bump_glossary_version
_call_openai_translate = translation_engine._call_openai_translate
translate_text_simple = translation_engine.translate_text

# ★会話コンテキスト設定
CONTEXT_MAX_ITEMS = 5  # 保持する翻訳履歴の最大数
CONTEXT_TTL = 1800  # 30分（会議中のコンテキスト有効期限）


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
    glossary_version = await _glossary_version()
    cache_key = _cache_key(
        req.text, req.source_language, req.target_language, glossary_version
    )
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

    # キャッシュ保存（文脈付き訳文は共有キャッシュへ入れない。欠陥 #14: 部屋間流出防止）
    if not context:
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
