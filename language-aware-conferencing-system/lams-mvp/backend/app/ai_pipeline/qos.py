"""
LAMS Hybrid QoS モニター

設計方針:
- 主線別 P95 遅延・用語命中率・数字保持率の非権威な観測
- 縮退 decision は QoEStateMachine が単一権威（本モジュールは測定／warning のみ）
"""

import math
import re
import time
from collections import Counter, deque
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# === Phase 3 ハイブリッド 2 主線の品質ゲート目標（README §9 / 改善.md §15） ===
# 主線1（音声翻訳/聞く）と主線2（翻訳字幕/読む）で P95 遅延の上限が異なる。
HEARING_P95_TARGET_MS = 5000.0  # 主線1: 音声翻訳 P95 ≤ 5 秒
READING_P95_TARGET_MS = 4000.0  # 主線2: 翻訳字幕 P95 ≤ 4 秒
GLOSSARY_HIT_RATE_TARGET = 0.95  # 用語命中率 ≥ 95%
NUMBER_RETENTION_TARGET = 0.98  # 数字・日付・金額の保持率 ≥ 98%（改善.md §15）
_QOS_WINDOW = 200  # P95 算出に用いる直近サンプル数（主線ごと）
_DEFAULT_P95 = 95.0  # 既定パーセンタイル
# P95 評価に含める観測の有効期間（秒）。
# 件数窓のみで評価すると、聞く主線が停止して新規サンプルが途絶えた場合に
# 古い遅い観測が窓から出て行かず、超過判定が永久に成立し続ける（復帰不能）。
LATENCY_WINDOW_SECONDS = 60.0

# 主線名 → P95 目標（ms）。orchestrator のフォーク名と一致させる。
_MAINLINE_TARGETS_MS: dict[str, float] = {
    "hearing": HEARING_P95_TARGET_MS,
    "reading": READING_P95_TARGET_MS,
}

# 数字・日付・金額の桁列を抽出する正規表現（区切り文字を含む連続桁、または単桁）。
# 例: "2026-06-24" / "1,200" / "3.14" / "12:30" / "5" を 1 トークンとして抽出する。
_NUMBER_RE = re.compile(r"\d[\d.,:/\-]*\d|\d")
_NUMERIC_QUANTITY_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
_QUANTITY_UNIT_RE = re.compile(
    r"\s*(million yen|billion yen|thousand yen|万円|万元|億円|億元|亿元|"
    r"パーセント|percent|million|billion|thousand|万|億|亿|%)",
    re.IGNORECASE,
)
_DATE_OR_TIME_SEPARATORS = ("-", ":", "/")

# 金額であることを表す言語非依存の接尾辞。
# 通貨名（円 / 元 / yen）は言語ごとに異なるため、金額どうしを言語横断で比較できるよう
# 共通の印に正規化する（例: ja「1,200万円」と zh「1,200万元」を同一トークンにする）。
_CURRENCY = "cur"

_UNIT_MULTIPLIERS: dict[str, tuple[Decimal, str]] = {
    "万": (Decimal("10000"), ""),
    "万円": (Decimal("10000"), _CURRENCY),
    "万元": (Decimal("10000"), _CURRENCY),
    "億": (Decimal("100000000"), ""),
    "亿": (Decimal("100000000"), ""),
    "億円": (Decimal("100000000"), _CURRENCY),
    "億元": (Decimal("100000000"), _CURRENCY),
    "亿元": (Decimal("100000000"), _CURRENCY),
    "thousand": (Decimal("1000"), ""),
    "thousand yen": (Decimal("1000"), _CURRENCY),
    "million": (Decimal("1000000"), ""),
    "million yen": (Decimal("1000000"), _CURRENCY),
    "billion": (Decimal("1000000000"), ""),
    "billion yen": (Decimal("1000000000"), _CURRENCY),
    "percent": (Decimal("1"), "%"),
    "パーセント": (Decimal("1"), "%"),
    "%": (Decimal("1"), "%"),
}


def extract_numbers(text: str) -> list[str]:
    """テキストから数字トークン（数値・日付・金額の桁列）を抽出する（純ロジック）。"""
    return [m.group(0) for m in _NUMBER_RE.finditer(text or "")]


def _normalize_decimal(value: Decimal) -> str:
    """Decimal を比較用の短い文字列表現へ正規化する。"""
    normalized = value.normalize()
    if normalized == normalized.to_integral():
        return str(normalized.quantize(Decimal("1")))
    return format(normalized, "f").rstrip("0").rstrip(".")


def _normalized_number_tokens(text: str) -> list[str]:
    """数字・日付・金額・割合を意味比較用トークンへ正規化する。"""
    tokens: list[str] = []
    for match in _NUMBER_RE.finditer(text or ""):
        token = match.group(0)
        if any(separator in token for separator in _DATE_OR_TIME_SEPARATORS):
            tokens.append(token)
            continue
        numeric_match = _NUMERIC_QUANTITY_RE.fullmatch(token)
        if numeric_match is None:
            tokens.append(token)
            continue
        unit_match = _QUANTITY_UNIT_RE.match((text or "")[match.end() :])
        unit = unit_match.group(1).lower() if unit_match else ""
        multiplier, suffix = _UNIT_MULTIPLIERS.get(unit, (Decimal("1"), ""))
        try:
            value = Decimal(token.replace(",", "")) * multiplier
        except InvalidOperation:
            tokens.append(token)
            continue
        tokens.append(f"{_normalize_decimal(value)}{suffix}")
    return tokens


def number_retention(source: str, translation: str) -> float | None:
    """source の数字が translation に保持された割合（0.0-1.0）。

    数字・日付・金額は翻訳で改変されてはならない（改善.md §15）。多重集合として
    照合し、保持された数字トークン数 / source の数字トークン数を返す。
    source に数字が無ければ評価対象外として None を返す。
    """
    src = _normalized_number_tokens(source)
    if not src:
        return None
    remaining = Counter(_normalized_number_tokens(translation))
    kept = 0
    for token in src:
        if remaining[token] > 0:
            remaining[token] -= 1
            kept += 1
    return kept / len(src)


def percentile(values: list[float], pct: float = _DEFAULT_P95) -> float | None:
    """サンプル列の pct パーセンタイル（nearest-rank 法）。空なら None。"""
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = math.ceil((pct / 100.0) * len(ordered))
    index = min(max(rank, 1), len(ordered)) - 1
    return ordered[index]


@dataclass
class HybridQoSSnapshot:
    """ハイブリッド QoS のスナップショット（観測・ダッシュボード用）。"""

    hearing_p95_ms: float | None
    reading_p95_ms: float | None
    glossary_hit_rate: float | None
    number_retention_rate: float | None
    hearing_samples: int
    reading_samples: int


class HybridQoSMonitor:
    """
    ハイブリッド 2 主線の QoS 計測（README §9）。

    目的:
        主線ごとに P95 遅延、全体で用語命中率を集計し、§9 目標の逸脱を検知して
        `qos_warning` ペイロードを生成する純ロジック。transport / DB 非依存。
    入力:
        record_latency(mainline, ms) / record_glossary(hits, total)。
    出力:
        evaluate_latency / evaluate_glossary が逸脱時に warning dict を返す。
    注意点:
        - 直近 window 件の固定長窓で P95 を算出（メモリ上限を保証）。
        - 単一イベントループ内での逐次記録を前提（ロック不要）。
    """

    def __init__(
        self,
        window: int = _QOS_WINDOW,
        targets_ms: dict[str, float] | None = None,
        glossary_target: float = GLOSSARY_HIT_RATE_TARGET,
        number_target: float = NUMBER_RETENTION_TARGET,
        percentile_pct: float = _DEFAULT_P95,
        retry_cooldown_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
        latency_window_s: float = LATENCY_WINDOW_SECONDS,
    ) -> None:
        self._targets_ms = dict(
            _MAINLINE_TARGETS_MS if targets_ms is None else targets_ms
        )
        self._glossary_target = glossary_target
        self._number_target = number_target
        self._pct = percentile_pct
        self._latency_window_s = latency_window_s
        # 主線名 → (観測時刻, 遅延ms) の固定長窓。時刻は有効期間判定に用いる。
        self._latency: dict[str, deque[tuple[float, float]]] = {
            name: deque(maxlen=window) for name in self._targets_ms
        }
        self._glossary_hits = 0
        self._glossary_total = 0
        self._number_kept = 0
        self._number_total = 0
        self._retry_cooldown_s = retry_cooldown_s
        self._clock = clock

    def record_latency(self, mainline: str, latency_ms: float) -> None:
        """主線の 1 サンプル遅延（ms）を記録する（未知主線・負値は無視）。"""
        if mainline not in self._latency or latency_ms < 0:
            return
        self._latency[mainline].append((self._clock(), float(latency_ms)))

    def _fresh_samples(self, mainline: str) -> list[float]:
        """有効期間内の遅延サンプルのみを返す（期限切れは評価から除外）。

        Args:
            mainline: 主線名（hearing / reading）。

        Returns:
            有効期間内の遅延（ms）のリスト。

        Notes:
            聞く主線が停止すると新規サンプルが途絶えるため、件数窓だけでは
            古い遅い観測が残り続けて復帰できない。時間窓で期限切れを除外する。
        """
        deadline = self._clock() - self._latency_window_s
        return [
            value
            for recorded_at, value in self._latency.get(mainline, ())
            if recorded_at >= deadline
        ]

    def record_glossary(self, hits: int, total: int) -> None:
        """用語の命中数/候補数を累積する（total<=0 は無視）。"""
        if total <= 0:
            return
        self._glossary_hits += max(0, min(hits, total))
        self._glossary_total += total

    def record_number_retention(self, source: str, translation: str) -> None:
        """source/translation の数字保持を 1 サンプルとして累積する（数字なしは無視）。"""
        src = extract_numbers(source)
        if not src:
            return
        rate = number_retention(source, translation)
        # rate は None になり得ない（src 非空のため）が型のため明示ガード。
        kept = round((rate or 0.0) * len(src))
        self._number_kept += kept
        self._number_total += len(src)

    def p95(self, mainline: str) -> float | None:
        """指定主線の P95 遅延（ms）。有効期間内のサンプルが無ければ None。"""
        return percentile(self._fresh_samples(mainline), self._pct)

    def glossary_hit_rate(self) -> float | None:
        """用語命中率（0.0-1.0）。計測無しなら None。"""
        if self._glossary_total <= 0:
            return None
        return self._glossary_hits / self._glossary_total

    def number_retention_rate(self) -> float | None:
        """数字・日付・金額の保持率（0.0-1.0）。計測無しなら None。"""
        if self._number_total <= 0:
            return None
        return self._number_kept / self._number_total

    def number_samples(self) -> int:
        """数字保持率の評価に用いた数字トークン総数（永続化・観測用）。"""
        return self._number_total

    def evaluate_latency(self, mainline: str) -> dict | None:
        """P95 が §9 目標を超過していれば qos_warning を返す（正常時 None）。"""
        target = self._targets_ms.get(mainline)
        value = self.p95(mainline)
        if target is None or value is None or value <= target:
            return None
        fallback = mainline == "hearing"
        return {
            "type": "qos_warning",
            "metric": "latency_p95",
            "mainline": mainline,
            "value_ms": round(value, 1),
            "target_ms": target,
            "should_fallback_to_subtitle": fallback,
        }

    def hearing_p95_exceeded(self) -> bool | None:
        """聞く主線 P95 の目標超過を観測事実として返す。

        戻り値:
            None: 未計測（unknown）
            True: P95 が目標を超過
            False: 計測済みで目標内
        注意:
            hearing 停止の最終判断は行わない（QoE authority が決定する）。
            測定窓の破棄による独自復帰もしない。
        """
        target = self._targets_ms.get("hearing")
        value = self.p95("hearing")
        if target is None or value is None:
            return None
        return value > target

    def hearing_degraded(self) -> bool:
        """後方互換: P95 超過の有無のみ返す（制御・履歴破棄はしない）。"""
        return self.hearing_p95_exceeded() is True

    def evaluate_glossary(self) -> dict | None:
        """用語命中率が目標を下回れば qos_warning を返す（正常/未計測時 None）。"""
        rate = self.glossary_hit_rate()
        if rate is None or rate >= self._glossary_target:
            return None
        return {
            "type": "qos_warning",
            "metric": "glossary_hit_rate",
            "value": round(rate, 4),
            "target": self._glossary_target,
            "should_fallback_to_subtitle": False,
        }

    def evaluate_number_retention(self) -> dict | None:
        """数字保持率が目標を下回れば qos_warning を返す（正常/未計測時 None）。"""
        rate = self.number_retention_rate()
        if rate is None or rate >= self._number_target:
            return None
        return {
            "type": "qos_warning",
            "metric": "number_retention_rate",
            "value": round(rate, 4),
            "target": self._number_target,
            "should_fallback_to_subtitle": False,
        }

    def snapshot(self) -> HybridQoSSnapshot:
        """現在の主線別 P95 と用語命中率のスナップショットを返す。"""
        return HybridQoSSnapshot(
            hearing_p95_ms=self.p95("hearing"),
            reading_p95_ms=self.p95("reading"),
            glossary_hit_rate=self.glossary_hit_rate(),
            number_retention_rate=self.number_retention_rate(),
            hearing_samples=len(self._fresh_samples("hearing")),
            reading_samples=len(self._fresh_samples("reading")),
        )
