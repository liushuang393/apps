"""
LAMS QoSコントローラー
遅延監視と品質劣化対応を担当

設計方針:
- 遅延上限: 1200ms（認知負荷軽減）
- ジッター上限: 200ms（安定性重視）
- 超過時は字幕フォールバックで対応
"""

import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum

from app.config import settings


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
