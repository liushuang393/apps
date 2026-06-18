"""
LAMS 用語集（Glossary）エンジン

目的:
    Mode B（ASR→MT+用語集→字幕）の精度の核。登録済み用語を翻訳対象テキストへ照合し、
    LLM 翻訳プロンプトへ「指定訳の強制」「翻訳禁止語の保持」を注入する。
入力:
    翻訳対象テキスト、ソース/ターゲット言語コード。
出力:
    プロンプトへ追記する用語ヒント文字列（該当なし時は空文字）。
注意点:
    - provider / transport 非依存。外部 credential 不要。
    - DB アクセス失敗時は空ヒントへフォールバックし、既存翻訳を壊さない（後方互換）。
    - 照合は純粋関数 match_terms / build_prompt_hint に分離し単体テスト可能とする。
"""

import logging
import time
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import select

from app.db.database import async_session
from app.db.models import GlossaryTerm

logger = logging.getLogger(__name__)

# 用語集キャッシュ有効期限（秒）。翻訳ホットパスでの DB アクセスを抑制する。
CACHE_TTL_SECONDS = 60


class _TermLike(Protocol):
    """match_terms が要求する用語の最小インターフェース（テスト容易性のため）"""

    source_term: str
    target_term: str | None
    do_not_translate: bool
    priority: int
    enabled: bool
    source_language: str
    target_language: str


@dataclass(frozen=True)
class GlossaryMatch:
    """テキスト内で命中した用語の照合結果"""

    source_term: str
    target_term: str | None
    do_not_translate: bool
    priority: int


def _norm_lang(code: str) -> str:
    """言語コードを基底言語へ正規化（例: 'ja-JP' -> 'ja'）"""
    return code.split("-")[0].strip().lower()


def match_terms(
    text: str,
    terms: list[_TermLike],
    source_language: str,
    target_language: str,
) -> list[GlossaryMatch]:
    """
    テキストに出現する用語を抽出する（純粋関数）

    照合規則:
        - enabled かつ言語ペア一致（region 差は基底言語で吸収）の用語のみ対象。
        - source_term の大小文字を無視した部分一致で検出。
        - priority 降順 → source_term 長さ降順（より具体的な語を優先）。
        - 同一 source_term は最優先の 1 件のみ残す。
    """
    src = _norm_lang(source_language)
    tgt = _norm_lang(target_language)
    text_lower = text.lower()

    candidates: list[_TermLike] = [
        t
        for t in terms
        if t.enabled
        and t.source_term
        and _norm_lang(t.source_language) == src
        and _norm_lang(t.target_language) == tgt
        and t.source_term.lower() in text_lower
    ]
    candidates.sort(key=lambda t: (t.priority, len(t.source_term)), reverse=True)

    seen: set[str] = set()
    matches: list[GlossaryMatch] = []
    for t in candidates:
        key = t.source_term.lower()
        if key in seen:
            continue
        seen.add(key)
        matches.append(
            GlossaryMatch(
                source_term=t.source_term,
                target_term=t.target_term,
                do_not_translate=t.do_not_translate,
                priority=t.priority,
            )
        )
    return matches


def build_prompt_hint(matches: list[GlossaryMatch]) -> str:
    """命中用語から LLM プロンプトへ注入するヒント文を生成する（純粋関数）"""
    if not matches:
        return ""
    lines = ["\nGlossary (MUST follow exactly, these override your defaults):"]
    for m in matches:
        if m.do_not_translate or not m.target_term:
            lines.append(f'- "{m.source_term}" => keep unchanged (do NOT translate)')
        else:
            lines.append(
                f'- "{m.source_term}" => MUST be translated as "{m.target_term}"'
            )
    return "\n".join(lines) + "\n"


def measure_glossary_hits(
    matches: list[GlossaryMatch], translated_text: str
) -> tuple[int, int]:
    """
    命中用語が訳文に正しく反映されたかを計測する（純粋関数・命中率フック）

    判定:
        - do_not_translate / target_term 無し: source_term が訳文に保持されていれば命中。
        - それ以外: target_term が訳文に出現していれば命中。
        - 大小文字は無視。candidate（命中用語）が無ければ (0, 0) を返す。
    戻り値:
        (hits, total)。total は命中用語数、hits は訳文反映に成功した数。
    """
    total = len(matches)
    if total == 0:
        return (0, 0)
    text_lower = (translated_text or "").lower()
    hits = 0
    for m in matches:
        expected = (
            m.source_term
            if (m.do_not_translate or not m.target_term)
            else m.target_term
        )
        if expected and expected.lower() in text_lower:
            hits += 1
    return (hits, total)


# ============================================================
# DB ローダ + インメモリ TTL キャッシュ
# ============================================================
_cache: dict[tuple[str, str], tuple[float, list[GlossaryTerm]]] = {}


def invalidate_cache() -> None:
    """用語集キャッシュを全消去する（CRUD 更新時に呼び出す）"""
    _cache.clear()


async def _load_terms(source_language: str, target_language: str) -> list[GlossaryTerm]:
    """言語ペアに対応する有効用語を取得（TTL キャッシュ付き、失敗時は空）"""
    key = (_norm_lang(source_language), _norm_lang(target_language))
    hit = _cache.get(key)
    if hit and (time.monotonic() - hit[0]) < CACHE_TTL_SECONDS:
        return hit[1]
    try:
        async with async_session() as session:
            result = await session.execute(
                select(GlossaryTerm).where(GlossaryTerm.enabled.is_(True))
            )
            all_terms = list(result.scalars().all())
        filtered = [
            t
            for t in all_terms
            if _norm_lang(t.source_language) == key[0]
            and _norm_lang(t.target_language) == key[1]
        ]
        _cache[key] = (time.monotonic(), filtered)
        return filtered
    except Exception as e:
        logger.warning(f"[Glossary] 用語集取得エラー（空で継続）: {e}")
        return []


async def build_hint_for_text(
    text: str, source_language: str, target_language: str
) -> str:
    """翻訳対象テキストに対する用語ヒントを生成（統合用エントリポイント）"""
    if not text or not text.strip():
        return ""
    if _norm_lang(source_language) == _norm_lang(target_language):
        return ""
    terms = await _load_terms(source_language, target_language)
    if not terms:
        return ""
    return build_prompt_hint(match_terms(text, terms, source_language, target_language))
