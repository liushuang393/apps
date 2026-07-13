"""
LAMS QoSコントローラー
遅延監視と品質劣化対応を担当

設計方針:
- 遅延上限: 1200ms（認知負荷軽減）
- ジッター上限: 200ms（安定性重視）
- 超過時は字幕フォールバックで対応
"""

import math
import re
import time
from collections import Counter, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from enum import Enum

from app.config import settings

# === Phase 3 ハイブリッド 2 主線の品質ゲート目標（README §9 / 改善.md §15） ===
# 主線1（音声翻訳/聞く）と主線2（翻訳字幕/読む）で P95 遅延の上限が異なる。
HEARING_P95_TARGET_MS = 5000.0  # 主線1: 音声翻訳 P95 ≤ 5 秒
READING_P95_TARGET_MS = 4000.0  # 主線2: 翻訳字幕 P95 ≤ 4 秒
GLOSSARY_HIT_RATE_TARGET = 0.95  # 用語命中率 ≥ 95%
NUMBER_RETENTION_TARGET = 0.98  # 数字・日付・金額の保持率 ≥ 98%（改善.md §15）
_QOS_WINDOW = 200  # P95 算出に用いる直近サンプル数（主線ごと）
_DEFAULT_P95 = 95.0  # 既定パーセンタイル

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
    r"\s*(million yen|billion yen|thousand yen|万円|億円|パーセント|percent|"
    r"million|billion|thousand|万|億|%)",
    re.IGNORECASE,
)
_DATE_OR_TIME_SEPARATORS = ("-", ":", "/")

_UNIT_MULTIPLIERS: dict[str, tuple[Decimal, str]] = {
    "万": (Decimal("10000"), ""),
    "万円": (Decimal("10000"), "yen"),
    "億": (Decimal("100000000"), ""),
    "億円": (Decimal("100000000"), "yen"),
    "thousand": (Decimal("1000"), ""),
    "thousand yen": (Decimal("1000"), "yen"),
    "million": (Decimal("1000000"), ""),
    "million yen": (Decimal("1000000"), "yen"),
    "billion": (Decimal("1000000000"), ""),
    "billion yen": (Decimal("1000000000"), "yen"),
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
    ) -> None:
        self._targets_ms = dict(
            _MAINLINE_TARGETS_MS if targets_ms is None else targets_ms
        )
        self._glossary_target = glossary_target
        self._number_target = number_target
        self._pct = percentile_pct
        self._latency: dict[str, deque[float]] = {
            name: deque(maxlen=window) for name in self._targets_ms
        }
        self._glossary_hits = 0
        self._glossary_total = 0
        self._number_kept = 0
        self._number_total = 0
        self._retry_cooldown_s = retry_cooldown_s
        self._clock = clock
        self._degraded_since: float | None = None

    def record_latency(self, mainline: str, latency_ms: float) -> None:
        """主線の 1 サンプル遅延（ms）を記録する（未知主線・負値は無視）。"""
        if mainline not in self._latency or latency_ms < 0:
            return
        self._latency[mainline].append(float(latency_ms))

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
        """指定主線の P95 遅延（ms）。サンプルが無ければ None。"""
        return percentile(list(self._latency.get(mainline, ())), self._pct)

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

    def hearing_degraded(self) -> bool:
        """聞く主線の P95 目標超過による縮退判定（§9 の実配線。欠陥 #9）。

        超過が続く場合も retry_cooldown_s 経過で窓を捨てて False を返し、
        次のセグメントで S2S を再試行させる。
        # ponytail: 単純クールダウン。ヒステリシスは必要になったら導入。
        """
        if self.evaluate_latency("hearing") is None:
            self._degraded_since = None
            return False
        now = self._clock()
        if self._degraded_since is None:
            self._degraded_since = now
            return True
        if now - self._degraded_since >= self._retry_cooldown_s:
            self._latency["hearing"].clear()
            self._degraded_since = None
            return False
        return True

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
            hearing_samples=len(self._latency.get("hearing", ())),
            reading_samples=len(self._latency.get("reading", ())),
        )


class DegradationLevel(Enum):
    """
    品質劣化レベル
    NONE: 正常
    LIGHT: 軽度（遅延注意）
    MODERATE: 中度（字幕推奨）
    SEVERE: 重度（音声停止、字幕のみ）
    """

    NONE = "none"
    LIGHT = "light"
    MODERATE = "moderate"
    SEVERE = "severe"


@dataclass
class QoSMetrics:
    """QoS測定結果"""

    start_time_ms: float = 0.0
    end_time_ms: float = 0.0
    total_latency_ms: float = 0.0
    jitter_ms: float = 0.0
    degradation_level: DegradationLevel = DegradationLevel.NONE
    should_fallback_to_subtitle: bool = False


@dataclass
class QoSState:
    """QoS内部状態"""

    latency_history: deque[float] = field(default_factory=lambda: deque(maxlen=20))
    last_latency_ms: float = 0.0


class QoSController:
    """
    QoS品質管理コントローラー

    主な機能:
    - 遅延測定
    - ジッター計算
    - 品質劣化判定
    - フォールバック判断
    """

    def __init__(self) -> None:
        self.max_latency_ms = settings.max_latency_ms
        self.max_jitter_ms = settings.max_jitter_ms
        self._state = QoSState()

    def start_measurement(self) -> QoSMetrics:
        """測定開始"""
        return QoSMetrics(start_time_ms=time.time() * 1000)

    def end_measurement(self, metrics: QoSMetrics) -> QoSMetrics:
        """
        測定終了・結果計算

        判定基準:
        - 通常: latency <= max_latency_ms
        - LIGHT: max_latency_ms < latency <= max_latency_ms * 1.5
        - MODERATE: max_latency_ms * 1.5 < latency <= max_latency_ms * 2
        - SEVERE: latency > max_latency_ms * 2
        """
        metrics.end_time_ms = time.time() * 1000
        metrics.total_latency_ms = metrics.end_time_ms - metrics.start_time_ms

        # ジッター計算（前回との差分）
        if self._state.last_latency_ms > 0:
            metrics.jitter_ms = abs(
                metrics.total_latency_ms - self._state.last_latency_ms
            )

        # 履歴更新
        self._state.latency_history.append(metrics.total_latency_ms)
        self._state.last_latency_ms = metrics.total_latency_ms

        # 品質劣化レベル判定
        if metrics.total_latency_ms > self.max_latency_ms * 2:
            metrics.degradation_level = DegradationLevel.SEVERE
            metrics.should_fallback_to_subtitle = True
        elif metrics.total_latency_ms > self.max_latency_ms * 1.5:
            metrics.degradation_level = DegradationLevel.MODERATE
            metrics.should_fallback_to_subtitle = True
        elif metrics.total_latency_ms > self.max_latency_ms:
            metrics.degradation_level = DegradationLevel.LIGHT
        else:
            metrics.degradation_level = DegradationLevel.NONE

        # ジッター超過時もフォールバック
        if metrics.jitter_ms > self.max_jitter_ms * 2:
            metrics.should_fallback_to_subtitle = True

        return metrics

    def get_average_latency(self) -> float:
        """平均遅延取得"""
        if not self._state.latency_history:
            return 0.0
        return sum(self._state.latency_history) / len(self._state.latency_history)

    def is_stable(self) -> bool:
        """安定性判定"""
        if len(self._state.latency_history) < 5:
            return True
        avg = self.get_average_latency()
        return all(
            abs(lat - avg) < self.max_jitter_ms for lat in self._state.latency_history
        )


class AdaptiveQoSController(QoSController):
    """
    ★改善: 適応型QoSコントローラー

    履歴データに基づいて動的に閾値を調整:
    - 安定時: 厳格な閾値で高品質を維持
    - 不安定時: 閾値を緩和してフォールバック頻度を抑制

    計算式: adaptive_threshold = avg + 2 * std
    上限: 設定値の1.5倍
    """

    def __init__(self) -> None:
        super().__init__()
        self._adaptive_threshold = settings.max_latency_ms

    def _calculate_std(self) -> float:
        """標準偏差を計算"""
        if len(self._state.latency_history) < 2:
            return 0.0
        avg = self.get_average_latency()
        variance = sum((x - avg) ** 2 for x in self._state.latency_history) / len(
            self._state.latency_history
        )
        return variance**0.5

    def _update_adaptive_threshold(self) -> None:
        """適応型閾値を更新"""
        # 十分なサンプルが必要
        if len(self._state.latency_history) < 10:
            return

        avg = self.get_average_latency()
        std = self._calculate_std()

        # 適応型閾値 = 平均値 + 2倍標準偏差
        # 設定値の1.5倍を上限とする
        new_threshold = min(
            avg + 2 * std,
            settings.max_latency_ms * 1.5,
        )
        # 設定値を下回らないように
        new_threshold = max(new_threshold, settings.max_latency_ms * 0.8)

        self._adaptive_threshold = new_threshold

    def end_measurement(self, metrics: QoSMetrics) -> QoSMetrics:
        """
        測定終了・結果計算（適応型閾値使用）
        """
        metrics.end_time_ms = time.time() * 1000
        metrics.total_latency_ms = metrics.end_time_ms - metrics.start_time_ms

        # ジッター計算（前回との差分）
        if self._state.last_latency_ms > 0:
            metrics.jitter_ms = abs(
                metrics.total_latency_ms - self._state.last_latency_ms
            )

        # 履歴更新
        self._state.latency_history.append(metrics.total_latency_ms)
        self._state.last_latency_ms = metrics.total_latency_ms

        # ★適応型閾値を更新
        self._update_adaptive_threshold()
        threshold = self._adaptive_threshold

        # 品質劣化レベル判定（★適応型閾値を使用）
        if metrics.total_latency_ms > threshold * 2:
            metrics.degradation_level = DegradationLevel.SEVERE
            metrics.should_fallback_to_subtitle = True
        elif metrics.total_latency_ms > threshold * 1.5:
            metrics.degradation_level = DegradationLevel.MODERATE
            metrics.should_fallback_to_subtitle = True
        elif metrics.total_latency_ms > threshold:
            metrics.degradation_level = DegradationLevel.LIGHT
        else:
            metrics.degradation_level = DegradationLevel.NONE

        # ジッター超過時もフォールバック
        if metrics.jitter_ms > self.max_jitter_ms * 2:
            metrics.should_fallback_to_subtitle = True

        return metrics

    def get_adaptive_threshold(self) -> float:
        """現在の適応型閾値を取得"""
        return self._adaptive_threshold
