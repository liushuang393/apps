"""
読む主線向けテキスト翻訳エンジン。

目的:
    FastAPI ルートからキャッシュ、翻訳記憶、OpenAI 翻訳、補正、QoS 記録を分離し、
    WebSocket・Composite MT・オーケストレーターで共通利用できるようにする。
"""

import hashlib
import logging

import redis.asyncio as aioredis
from fastapi import HTTPException, status

from app.ai_pipeline.providers.base import dynamic_max_tokens
from app.ai_pipeline.providers.correction import (
    CorrectionRequest,
    get_correction_provider,
)
from app.ai_pipeline.qos import (
    HybridQoSMonitor,
    number_retention,
    record_glossary_if_bound,
)
from app.config import settings
from app.languages import LANGUAGE_DISPLAY_NAMES
from app.translate import glossary, translation_memory

logger = logging.getLogger(__name__)

# 言語名マッピング（backend の単一ソース）
LANGUAGE_NAMES = LANGUAGE_DISPLAY_NAMES

# Redis キャッシュ
_redis: aioredis.Redis | None = None
CACHE_TTL = 3600 * 24
_GLOSSARY_VERSION_KEY = "glossary:version"


async def _get_redis() -> aioredis.Redis:
    """Redis 接続を取得する。入力はなく、共有非同期クライアントを返す。"""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _cache_key(text: str, src: str, tgt: str, glossary_version: str) -> str:
    """用語集世代を含む翻訳キャッシュキーを生成して返す。"""
    text_hash = hashlib.md5(text.encode()).hexdigest()
    return f"text_translate:v{glossary_version}:{src}:{tgt}:{text_hash}"


async def _glossary_version() -> str:
    """現在の用語集世代を返し、Redis 障害時は世代 ``0`` へフォールバックする。"""
    try:
        redis = await _get_redis()
        return await redis.get(_GLOSSARY_VERSION_KEY) or "0"
    except Exception:
        return "0"


async def bump_glossary_version() -> None:
    """用語集 CRUD 後に世代を進め、既存翻訳キャッシュを論理的に無効化する。"""
    try:
        redis = await _get_redis()
        await redis.incr(_GLOSSARY_VERSION_KEY)
    except Exception as exc:
        logger.warning("[Translate] 用語集バージョン更新エラー: %s", exc)


async def _call_openai_translate(
    text: str,
    source_language: str,
    target_language: str,
    context: list[dict] | None = None,
) -> str:
    """
    OpenAI API でテキストを翻訳する。

    入力は原文、言語コード、任意の会話履歴で、補正後の訳文を返す。
    API 未設定・呼び出し失敗時は従来契約どおり HTTP 503 を送出する。
    """
    from openai import AsyncOpenAI

    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="翻訳サービスが設定されていません",
        )

    # 空文字の base_url=None は環境変数 OPENAI_BASE_URL="" を拾うため公式URLを明示する。
    client = AsyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url or "https://api.openai.com/v1",
    )

    src_name = LANGUAGE_NAMES[source_language]
    tgt_name = LANGUAGE_NAMES[target_language]

    lang_specific_hints = ""
    if target_language == "ja":
        lang_specific_hints = "- Use polite Japanese (です/ます form)\n"
    elif target_language == "zh":
        lang_specific_hints = "- Use simplified Chinese characters\n"
    elif target_language == "vi":
        lang_specific_hints = "- Use standard Vietnamese with proper diacritics\n"

    context_str = ""
    if context:
        context_str = (
            "\n\nRecent conversation for context (maintain terminology consistency):\n"
        )
        for index, item in enumerate(context[-3:], 1):
            context_str += f'{index}. "{item["src"]}" → "{item["tgt"]}"\n'
        context_str += "\n"

    # 用語集取得失敗時は glossary 側が空ヒントへフォールバックする。
    glossary_hint = await glossary.build_hint_for_text(
        text, source_language, target_language
    )

    try:
        response = await client.chat.completions.create(
            model=settings.openai_translate_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "【警告】あなたは翻訳機です。翻訳以外は絶対禁止です。\n\n"
                        "[CRITICAL WARNING] You are a TRANSLATION MACHINE, "
                        "not a conversational AI.\n\n"
                        f"You are a professional interpreter for "
                        f"{src_name}-{tgt_name} translation.\n"
                        f"Translate the following {src_name} text into natural "
                        f"{tgt_name}.\n\n"
                        "ABSOLUTE RULES - VIOLATION IS FORBIDDEN:\n"
                        "- Output ONLY the direct translation of the input\n"
                        "- NEVER add comments, greetings, or acknowledgments\n"
                        "- NEVER say 'I understand', 'OK', 'Sure', "
                        "'はい、承知しました', etc.\n"
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
            max_tokens=dynamic_max_tokens(text),
            temperature=0.1,
        )

        translated = response.choices[0].message.content
        translated = translated.strip() if translated else ""

        if not translated:
            logger.warning("[Translate] 翻訳結果が空: %s...", text[:30])
            return ""

        translated = await _maybe_correct_translation(
            text,
            translated,
            source_language,
            target_language,
            glossary_hint,
            context_str,
        )

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

        logger.info(
            "[Translate] 翻訳完了: '%s...' -> '%s...'",
            text[:20],
            translated[:20],
        )
        return translated
    except Exception as exc:
        logger.error("[Translate] OpenAI APIエラー: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"翻訳エラー: {exc!s}",
        ) from exc


async def _maybe_correct_translation(
    source_text: str,
    translated_text: str,
    source_language: str,
    target_language: str,
    glossary_hint: str,
    context_str: str,
) -> str:
    """
    設定された場合だけ LLM 補正を適用し、補正後または元の暫定訳を返す。

    補正プロバイダー未設定時と補正失敗時は、翻訳主線を止めず暫定訳を維持する。
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
    except Exception as exc:
        logger.warning(
            "[Translate] LLM補正をスキップし暫定訳を使用: %s",
            exc,
        )
        return translated_text


async def translate_text(
    text: str,
    source_language: str,
    target_language: str,
    *,
    qos_monitor: HybridQoSMonitor | None = None,
) -> str:
    """
    読む主線向けにキャッシュ・TM・用語集付き翻訳を実行する。

    入力は原文と言語コード、任意の QoS モニターで、訳文を返す。
    同一言語・空白は原文を返し、翻訳処理失敗時は空文字列を返す。
    """
    if source_language == target_language:
        return text
    if not text.strip():
        return text

    glossary_version = await _glossary_version()
    cache_key = _cache_key(text, source_language, target_language, glossary_version)
    try:
        redis = await _get_redis()
        cached = await redis.get(cache_key)
        if cached:
            logger.debug("[PreTranslate] キャッシュヒット: %s...", text[:20])
            await _record_glossary_qos(
                text,
                cached,
                source_language,
                target_language,
                qos_monitor=qos_monitor,
            )
            return cached
    except Exception as exc:
        logger.warning("[PreTranslate] キャッシュ取得エラー: %s", exc)

    tm_hit = await translation_memory.lookup(
        text, source_language, target_language, version=glossary_version
    )
    if tm_hit:
        logger.debug("[PreTranslate] TMヒット: %s...", text[:20])
        await _record_glossary_qos(
            text,
            tm_hit,
            source_language,
            target_language,
            qos_monitor=qos_monitor,
        )
        return tm_hit

    try:
        translated = await _call_openai_translate(
            text, source_language, target_language
        )

        if translated:
            try:
                redis = await _get_redis()
                await redis.setex(cache_key, CACHE_TTL, translated)
            except Exception as exc:
                logger.warning("[PreTranslate] キャッシュ保存エラー: %s", exc)
            await translation_memory.store(
                text,
                source_language,
                target_language,
                translated,
                version=glossary_version,
            )
            await _record_glossary_qos(
                text,
                translated,
                source_language,
                target_language,
                qos_monitor=qos_monitor,
            )

        return translated
    except Exception as exc:
        logger.warning("[PreTranslate] 翻訳エラー: %s", exc)
        return ""


async def _record_glossary_qos(
    source_text: str,
    translated_text: str,
    source_language: str,
    target_language: str,
    *,
    qos_monitor: HybridQoSMonitor | None = None,
) -> None:
    """
    用語命中率を明示モニターまたは現在のコンテキストへ記録する。

    観測処理の失敗は翻訳結果へ影響させず、デバッグログだけを残す。
    """
    try:
        matches = await glossary.match_terms_for_text(
            source_text, source_language, target_language
        )
        hits, total = glossary.measure_glossary_hits(matches, translated_text)
        if qos_monitor is not None:
            qos_monitor.record_glossary(hits, total)
        else:
            record_glossary_if_bound(hits, total)
    except Exception as exc:  # noqa: BLE001 - 観測失敗で翻訳を止めない
        logger.debug("[PreTranslate] glossary QoS 記録をスキップ: %s", exc)
