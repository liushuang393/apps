"""
翻訳記憶（Translation Memory / TM）：文単位の跨会議再利用（改善案 §4.3）。

既存の `_cache_key`（用語集世代付き md5 完全一致）が取り逃す「表記ゆれ・句読点差・
大小文字差」を、正規化完全一致 + fuzzy 一致で拾い、高頻度訳文を会議を跨いで再利用する。
MT 呼び出し前に lookup、成功後に store する（翻訳の一貫性向上 + コスト削減）。

設計原則:
    - Redis 依存は本モジュールに閉じる（routes との循環 import 回避のため独自 accessor）。
    - 用語集世代（version）はキーに含め、世代更新で TM を一括無効化する（cache と整合）。
    - fuzzy は世代・言語対ごとの有界インデックス（直近 N 件）に対してのみ行い、
      走査コストを抑える。短すぎる文は誤マッチ回避のため対象外。
    - 失敗（Redis 障害）は既存翻訳を壊さず None / no-op に縮退する。
"""

import hashlib
import logging
import re
from difflib import SequenceMatcher

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

# TM の TTL（秒）。跨会議再利用のため cache より長め（7 日）。
_TM_TTL = 3600 * 24 * 7
# fuzzy インデックスの言語対あたり保持件数（走査コストと命中率の折衷）。
_TM_INDEX_CAP = 500
# fuzzy 一致とみなす最小類似度（0..1）。誤訳流用を防ぐため高めに設定。
_TM_FUZZY_THRESHOLD = 0.94
# TM 対象とする正規化後の最小文字数（短文は exact cache に任せ誤マッチを避ける）。
_TM_MIN_CHARS = 4
# 空白区切りでない言語（文字レベル類似度が過敏＝「起動」vs「再起動」で誤マッチ）。
# これらを source とする場合は fuzzy を無効化し、正規化完全一致のみを用いる。
_NO_SPACE_LANGS = frozenset({"ja", "zh"})
# fuzzy 候補として許す長さ比の範囲（挿入/削除で意味が反転する近似句を除外）。
_TM_LEN_RATIO_MIN = 0.8
_TM_LEN_RATIO_MAX = 1.25

_redis: aioredis.Redis | None = None


async def _get_redis() -> aioredis.Redis:
    """Redis 接続取得（routes とは独立のシングルトン）。"""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _norm(text: str) -> str:
    """比較用の正規化：小文字化・空白畳み込み・前後記号除去（純関数）。"""
    lowered = text.lower().strip()
    collapsed = re.sub(r"\s+", " ", lowered)
    return re.sub(r"^[\s\.\,\!\?\-\—、。！？]+|[\s\.\,\!\?\-\—、。！？]+$", "", collapsed)


def _entry_key(norm: str, src: str, tgt: str, version: str) -> str:
    """正規化完全一致の格納キー（用語集世代付き）。"""
    h = hashlib.md5(norm.encode()).hexdigest()
    return f"tm:v{version}:{src}:{tgt}:{h}"


def _index_key(src: str, tgt: str, version: str) -> str:
    """fuzzy 走査用の有界インデックス（norm 文字列の直近リスト）。"""
    return f"tm:idx:v{version}:{src}:{tgt}"


async def lookup(
    text: str, source_language: str, target_language: str, *, version: str = "0"
) -> str | None:
    """TM から訳文を引く（正規化完全一致→fuzzy）。命中しなければ None。"""
    norm = _norm(text)
    if len(norm) < _TM_MIN_CHARS:
        return None
    try:
        r = await _get_redis()
        exact = await r.get(_entry_key(norm, source_language, target_language, version))
        if exact:
            logger.debug("[TM] 正規化完全一致: %s", norm[:20])
            return exact
        return await _fuzzy_lookup(r, norm, source_language, target_language, version)
    except Exception as e:  # noqa: BLE001 - TM 障害は翻訳本体を止めない
        logger.warning("[TM] lookup エラー: %s", e)
        return None


async def _fuzzy_lookup(
    r: aioredis.Redis, norm: str, src: str, tgt: str, version: str
) -> str | None:
    """有界インデックス内の最類似 norm を探し、閾値超なら訳文を返す。

    無空格言語（ja/zh）は文字レベル類似度が過敏で誤マッチするため fuzzy を行わない
    （正規化完全一致のみ）。空白区切り言語でも長さ比が乖離する候補は除外する。
    """
    if src in _NO_SPACE_LANGS:
        return None
    candidates = await r.lrange(_index_key(src, tgt, version), 0, _TM_INDEX_CAP - 1)
    best_ratio = 0.0
    best_norm: str | None = None
    for cand in candidates:
        if not cand:
            continue
        ratio_len = len(cand) / len(norm)
        if ratio_len < _TM_LEN_RATIO_MIN or ratio_len > _TM_LEN_RATIO_MAX:
            continue
        ratio = SequenceMatcher(None, norm, cand).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_norm = cand
    if best_norm is None or best_ratio < _TM_FUZZY_THRESHOLD:
        return None
    hit = await r.get(_entry_key(best_norm, src, tgt, version))
    if hit:
        logger.debug("[TM] fuzzy 一致(%.2f): %s ≈ %s", best_ratio, norm[:20], best_norm[:20])
    return hit or None


async def store(
    text: str,
    source_language: str,
    target_language: str,
    translated: str,
    *,
    version: str = "0",
) -> None:
    """訳文を TM へ登録する（正規化完全一致 + fuzzy インデックス）。空訳は無視。"""
    if not translated:
        return
    norm = _norm(text)
    if len(norm) < _TM_MIN_CHARS:
        return
    try:
        r = await _get_redis()
        await r.setex(
            _entry_key(norm, source_language, target_language, version),
            _TM_TTL,
            translated,
        )
        idx = _index_key(source_language, target_language, version)
        # 重複 norm を除去してから先頭へ（多様な候補で index を有効活用）。
        await r.lrem(idx, 0, norm)
        await r.lpush(idx, norm)
        await r.ltrim(idx, 0, _TM_INDEX_CAP - 1)
        # index にも TTL を付与（旧世代キーの孤児化・無限増殖を防ぐ）。
        await r.expire(idx, _TM_TTL)
    except Exception as e:  # noqa: BLE001 - TM 障害は翻訳本体を止めない
        logger.warning("[TM] store エラー: %s", e)
