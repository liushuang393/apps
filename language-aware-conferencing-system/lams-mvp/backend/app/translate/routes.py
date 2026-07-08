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

import hashlib
import json
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.ai_pipeline.providers.base import dynamic_max_tokens
from app.ai_pipeline.providers.correction import (
    CorrectionRequest,
    get_correction_provider,
)
from app.ai_pipeline.qos import number_retention
from app.auth.dependencies import get_current_user
from app.config import settings
from app.db.models import User
from app.languages import LANGUAGE_DISPLAY_NAMES
from app.translate import glossary, translation_memory

logger = logging.getLogger(__name__)
router = APIRouter()

# 言語名マッピング（backend の単一ソース）
LANGUAGE_NAMES = LANGUAGE_DISPLAY_NAMES

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


_GLOSSARY_VERSION_KEY = "glossary:version"


def _cache_key(text: str, src: str, tgt: str, glossary_version: str) -> str:
    """キャッシュキー生成（用語集世代を含む。世代更新で旧訳を一括無効化）"""
    text_hash = hashlib.md5(text.encode()).hexdigest()
    return f"text_translate:v{glossary_version}:{src}:{tgt}:{text_hash}"


async def _glossary_version() -> str:
    """現在の用語集バージョン（未設定/障害時は "0"）"""
    try:
        r = await _get_redis()
        return await r.get(_GLOSSARY_VERSION_KEY) or "0"
    except Exception:
        return "0"


async def bump_glossary_version() -> None:
    """用語集 CRUD 後に呼び、text_translate キャッシュを世代ごと無効化する"""
    try:
        r = await _get_redis()
        await r.incr(_GLOSSARY_VERSION_KEY)
    except Exception as e:
        logger.warning(f"[Translate] 用語集バージョン更新エラー: {e}")


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

    # 空文字の base_url=None は環境変数 OPENAI_BASE_URL="" を拾い接続エラーになるため、
    # 他プロバイダーと同様に公式URLを明示する（他3箇所と統一）。
    client = AsyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url or "https://api.openai.com/v1",
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

    # ★用語集ヒントを追加（指定訳の強制／翻訳禁止語の保持）
    # 取得失敗時は空文字へフォールバックし、既存翻訳を壊さない
    glossary_hint = await glossary.build_hint_for_text(
        text, source_language, target_language
    )

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
                        "- Strictly follow the glossary below when present\n"
                        f"{glossary_hint}"
                        f"{context_str}\n"
                        "FORBIDDEN: Any response that is not a direct translation."
                    ),
                },
                {"role": "user", "content": text},
            ],
            max_tokens=dynamic_max_tokens(text),  # 改善点 Q3: 長文の訳文切れ防止
            temperature=0.1,  # 低温度で翻訳一致性向上
        )

        translated = response.choices[0].message.content
        translated = translated.strip() if translated else ""

        if not translated:
            logger.warning(f"[Translate] 翻訳結果が空: {text[:30]}...")
            # 失敗 = 空文字列の契約（欠陥 #8）。センチネル文字列は返さない。
            return ""

        # ★LLM 補正（任意・既定OFF）。失敗時は暫定訳を維持し既存挙動を壊さない
        translated = await _maybe_correct_translation(
            text,
            translated,
            source_language,
            target_language,
            glossary_hint,
            context_str,
        )

        # 数字・日付・金額の保持を後処理検証（改善点 Q5）。原文に数字があり最終訳で
        # 欠落した場合は WARNING を残す（訳文は改変しない＝純観測）。補正後の最終訳を
        # 対象とし配信内容と一致させる。集計指標は persistence 側が別途担う。
        rate = number_retention(text, translated)
        if rate is not None and rate < 1.0:
            logger.warning(
                "[Translate] 数字保持率<1.0 (%.2f) %s->%s: '%s' -> '%s'",
                rate,
                source_language,
                target_language,
                text[:40],
                translated[:40],
            )

        logger.info(f"[Translate] 翻訳完了: '{text[:20]}...' -> '{translated[:20]}...'")
        return translated

    except Exception as e:
        logger.error(f"[Translate] OpenAI APIエラー: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"翻訳エラー: {e!s}",
        )


async def _maybe_correct_translation(
    source_text: str,
    translated_text: str,
    source_language: str,
    target_language: str,
    glossary_hint: str,
    context_str: str,
) -> str:
    """
    LLM 補正を任意適用する（改善.md 11章）。

    settings.llm_correction_provider が "off"（既定）の場合は get_correction_provider
    が None を返すため、補正は一切行われず暫定訳をそのまま返す（後方互換）。
    補正中に例外が発生しても暫定訳へフォールバックし、翻訳フローを止めない。
    """
    provider = get_correction_provider()
    if provider is None:
        return translated_text
    try:
        result = await provider.correct_translation(
            CorrectionRequest(
                source_text=source_text,
                translated_text=translated_text,
                source_language=source_language,
                target_language=target_language,
                glossary_hint=glossary_hint,
                context=context_str,
            )
        )
        return result.corrected_text or translated_text
    except Exception as e:
        logger.warning(f"[Translate] LLM補正をスキップし暫定訳を使用: {e}")
        return translated_text


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

    # キャッシュチェック（用語集世代付き md5 完全一致）
    glossary_version = await _glossary_version()
    cache_key = _cache_key(text, source_language, target_language, glossary_version)
    try:
        r = await _get_redis()
        cached = await r.get(cache_key)
        if cached:
            logger.debug(f"[PreTranslate] キャッシュヒット: {text[:20]}...")
            return cached
    except Exception as e:
        logger.warning(f"[PreTranslate] キャッシュ取得エラー: {e}")

    # 翻訳記憶（TM）チェック（正規化完全一致 + fuzzy。表記ゆれの跨会議再利用。§4.3）
    tm_hit = await translation_memory.lookup(
        text, source_language, target_language, version=glossary_version
    )
    if tm_hit:
        logger.debug(f"[PreTranslate] TMヒット: {text[:20]}...")
        return tm_hit

    # 翻訳実行
    try:
        translated = await _call_openai_translate(
            text, source_language, target_language
        )

        # キャッシュ保存（空訳=失敗は保存しない）
        if translated:
            try:
                r = await _get_redis()
                await r.setex(cache_key, CACHE_TTL, translated)
            except Exception as e:
                logger.warning(f"[PreTranslate] キャッシュ保存エラー: {e}")
            # TM へも登録（跨会議再利用の蓄積）
            await translation_memory.store(
                text, source_language, target_language, translated,
                version=glossary_version,
            )

        return translated
    except Exception as e:
        logger.warning(f"[PreTranslate] 翻訳エラー: {e}")
        return ""
