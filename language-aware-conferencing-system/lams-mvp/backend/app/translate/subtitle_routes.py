"""
字幕IDベースの翻訳API（最小遅延設計）

目的:
- 字幕IDで翻訳を取得し、Redis キャッシュ命中時は即返却する
- 翻訳中は wait=true で完了を待機、未リクエストなら即時翻訳を開始する
注意点:
- 翻訳本体は routes.translate_text_simple に委譲する（実装の単一ソース）。
  テストの monkeypatch 互換のため、モジュール名 translate_text_simple で束縛する。
- 失敗（空文字/例外）は原文をキャッシュ固定化せず claim を解放して再試行に委ねる。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db.models import User
from app.languages import LANGUAGE_DISPLAY_NAMES as LANGUAGE_NAMES
from app.translate import subtitle_cache
from app.translate.routes import translate_text_simple

logger = logging.getLogger(__name__)
router = APIRouter()


class SubtitleTranslationResponse(BaseModel):
    """字幕翻訳レスポンス"""

    subtitle_id: str
    target_language: str
    translated_text: str | None
    status: str  # "ready" | "pending" | "not_found" | "error"


@router.get(
    "/subtitle/{subtitle_id}/{target_lang}", response_model=SubtitleTranslationResponse
)
async def get_subtitle_translation(
    subtitle_id: str,
    target_lang: str,
    wait: bool = Query(default=True, description="翻訳中の場合に待機するか"),
    _user: User = Depends(get_current_user),
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
            # 翻訳結果が空: 原文を ready でキャッシュ固定化しない（欠陥 #15）。
            # マーカーを解放し、次回リクエストで再試行させる。
            logger.warning(f"[SubtitleTranslate] 翻訳結果が空: {subtitle_id}")
            await subtitle_cache.release_claim(subtitle_id, target_lang)
            return SubtitleTranslationResponse(
                subtitle_id=subtitle_id,
                target_language=target_lang,
                translated_text=original_text,  # 表示用フォールバック（非キャッシュ）
                status="error",
            )
        except Exception as e:
            logger.error(f"[SubtitleTranslate] 翻訳エラー: {e}")
            await subtitle_cache.release_claim(subtitle_id, target_lang)
            return SubtitleTranslationResponse(
                subtitle_id=subtitle_id,
                target_language=target_lang,
                translated_text=original_text,  # 表示用フォールバック（非キャッシュ）
                status="error",
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
