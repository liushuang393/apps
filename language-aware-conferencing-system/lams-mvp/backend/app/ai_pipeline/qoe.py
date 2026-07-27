"""Media・AI・Queue の品質を統合する QoE 状態機械。"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum

_LOSS_DEGRADE_RATIO = 0.05
_LOSS_RECOVER_RATIO = 0.03


class QoEState(str, Enum):
    """会議のリアルタイム品質状態。"""

    HEALTHY = "healthy"
    MEDIA_DEGRADED = "media_degraded"
    HEARING_DEGRADED = "hearing_degraded"
    PROVIDER_RECOVERING = "provider_recovering"
    QUEUE_OVERLOAD = "queue_overload"


@dataclass(frozen=True)
class QoEInput:
    """各 Plane から集約した品質入力。None は未計測を表す。"""

    packet_loss_ratio: float | None = None
    hearing_degraded: bool = False
    provider_recovering: bool = False
    queue_overloaded: bool = False


@dataclass(frozen=True)
class QoEDecision:
    """主線・暫定字幕の可用性を含む QoE 判定。"""

    state: QoEState
    hearing_available: bool
    partial_available: bool
    changed: bool


class QoEStateMachine:
    """縮退優先順位と回復ヒステリシスを一箇所で管理する。"""

    def __init__(
        self,
        *,
        recovery_cooldown_s: float = 5.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._state = QoEState.HEALTHY
        self._healthy_since: float | None = None
        self._recovery_cooldown_s = recovery_cooldown_s
        self._clock = clock

    @property
    def state(self) -> QoEState:
        """現在状態を返す。"""
        return self._state

    def evaluate(self, value: QoEInput) -> QoEDecision:
        """最新指標を評価し、縮退または段階回復を決定する。"""
        target = self._degraded_target(value)
        now = self._clock()
        if target is None and self._state is not QoEState.HEALTHY:
            if self._healthy_since is None:
                self._healthy_since = now
            if now - self._healthy_since < self._recovery_cooldown_s:
                target = self._state
            else:
                target = QoEState.HEALTHY
        elif target is None:
            target = QoEState.HEALTHY
        else:
            self._healthy_since = None

        changed = target is not self._state
        self._state = target
        degraded = target is not QoEState.HEALTHY
        return QoEDecision(
            state=target,
            hearing_available=not degraded,
            partial_available=target
            not in (
                QoEState.QUEUE_OVERLOAD,
                QoEState.PROVIDER_RECOVERING,
            ),
            changed=changed,
        )

    def _degraded_target(self, value: QoEInput) -> QoEState | None:
        """優先順位の高い縮退原因を返す。"""
        if value.queue_overloaded:
            return QoEState.QUEUE_OVERLOAD
        if value.provider_recovering:
            return QoEState.PROVIDER_RECOVERING
        if value.hearing_degraded:
            return QoEState.HEARING_DEGRADED
        if value.packet_loss_ratio is not None:
            threshold = (
                _LOSS_RECOVER_RATIO
                if self._state is QoEState.MEDIA_DEGRADED
                else _LOSS_DEGRADE_RATIO
            )
            if value.packet_loss_ratio > threshold:
                return QoEState.MEDIA_DEGRADED
        return None
