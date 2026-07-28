"""Media・AI・Queue・Provider の品質を統合する QoE 権威。

公開シームは evaluate 一つ。観測事実を受け、主線可否と理由を含む decision を返す。
時計を注入でき、ヒステリシス／cooldown を決定論的に検証できる。
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum

# 前端 listener-local と共有する Media 閾値（parity 用に公開）
LOSS_DEGRADE_RATIO = 0.05
LOSS_RECOVER_RATIO = 0.03
DEFAULT_RECOVERY_COOLDOWN_S = 5.0


class QoEState(str, Enum):
    """会議のリアルタイム品質状態。"""

    HEALTHY = "healthy"
    MEDIA_DEGRADED = "media_degraded"
    HEARING_DEGRADED = "hearing_degraded"
    PROVIDER_RECOVERING = "provider_recovering"
    QUEUE_OVERLOAD = "queue_overload"


class QoEReason(str, Enum):
    """縮退の個別理由コード（優先順位判定用）。"""

    QUEUE_OVERLOAD = "queue_overload"
    PROVIDER_RECOVERING = "provider_recovering"
    AI_HEARING_DEGRADED = "ai_hearing_degraded"
    MEDIA_DEGRADED = "media_degraded"


class QoEUiReason(str, Enum):
    """UI 向けの一貫した理由コード。"""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    INTERRUPTED = "interrupted"
    RECOVERED = "recovered"


class QoEScope(str, Enum):
    """server（会議全体 Mode A）と listener-local（受聴者単位）の区別。"""

    SERVER = "server"
    LISTENER_LOCAL = "listener_local"


# 優先順位: Queue → Provider → AI hearing → 受聴者 Media
_REASON_PRIORITY: tuple[QoEReason, ...] = (
    QoEReason.QUEUE_OVERLOAD,
    QoEReason.PROVIDER_RECOVERING,
    QoEReason.AI_HEARING_DEGRADED,
    QoEReason.MEDIA_DEGRADED,
)

_REASON_TO_STATE: dict[QoEReason, QoEState] = {
    QoEReason.QUEUE_OVERLOAD: QoEState.QUEUE_OVERLOAD,
    QoEReason.PROVIDER_RECOVERING: QoEState.PROVIDER_RECOVERING,
    QoEReason.AI_HEARING_DEGRADED: QoEState.HEARING_DEGRADED,
    QoEReason.MEDIA_DEGRADED: QoEState.MEDIA_DEGRADED,
}

# Mode A（会議全体の聞く主線）を止める理由。Media は listener-local のみ。
_SERVER_HEARING_BLOCKERS: frozenset[QoEReason] = frozenset(
    {
        QoEReason.QUEUE_OVERLOAD,
        QoEReason.PROVIDER_RECOVERING,
        QoEReason.AI_HEARING_DEGRADED,
    }
)

_PARTIAL_BLOCKERS: frozenset[QoEReason] = frozenset(
    {
        QoEReason.QUEUE_OVERLOAD,
        QoEReason.PROVIDER_RECOVERING,
    }
)

_INTERRUPTED_REASONS: frozenset[QoEReason] = frozenset(
    {
        QoEReason.QUEUE_OVERLOAD,
        QoEReason.PROVIDER_RECOVERING,
    }
)


@dataclass(frozen=True)
class QoEInput:
    """各 Plane から集約した品質入力。

    Optional の None は未計測（unknown）。False/0 は計測済みの正常値。
    会議本文・Token・API Key は含めない。
    """

    packet_loss_ratio: float | None = None
    hearing_degraded: bool | None = None
    provider_recovering: bool | None = None
    queue_overloaded: bool | None = None
    scope: QoEScope = QoEScope.SERVER


@dataclass(frozen=True)
class QoEDecision:
    """主線・暫定字幕の可用性を含む QoE 判定（warning とは区別する）。"""

    state: QoEState
    primary_reason: QoEReason | None
    auxiliary_reasons: tuple[QoEReason, ...]
    hearing_available: bool
    reading_available: bool
    partial_available: bool
    changed: bool
    scope: QoEScope
    ui_reason: QoEUiReason


class QoEStateMachine:
    """縮退優先順位と回復ヒステリシスを一箇所で管理する権威。"""

    def __init__(
        self,
        *,
        recovery_cooldown_s: float = DEFAULT_RECOVERY_COOLDOWN_S,
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
        """最新指標を評価し、縮退または段階回復を決定する。

        入力:
            value: Media / AI / Queue / Provider の観測事実。
        出力:
            状態・主要/補助理由・主線可否・partial 可否・changed を含む decision。
        注意:
            scope=SERVER では個人 Media 劣化で Mode A を止めない。
            scope=LISTENER_LOCAL では Media が受聴者単位の聞く主線を止める。
        """
        active = self._active_reasons(value)
        target = _REASON_TO_STATE[active[0]] if active else None
        now = self._clock()

        if target is None and self._state is not QoEState.HEALTHY:
            if self._healthy_since is None:
                self._healthy_since = now
            if now - self._healthy_since < self._recovery_cooldown_s:
                target = self._state
                # cooldown 中は直前状態を維持（理由は空＝回復途上）
                active = self._reasons_for_held_state(target)
            else:
                target = QoEState.HEALTHY
                active = []
        elif target is None:
            target = QoEState.HEALTHY
            active = []
        else:
            self._healthy_since = None

        changed = target is not self._state
        previous = self._state
        self._state = target

        primary = active[0] if active else None
        auxiliary = tuple(active[1:]) if len(active) > 1 else ()
        hearing_available = self._hearing_available(value.scope, active)
        partial_available = primary not in _PARTIAL_BLOCKERS if primary else True
        ui_reason = self._ui_reason(
            target=target,
            primary=primary,
            changed=changed,
            previous=previous,
        )
        return QoEDecision(
            state=target,
            primary_reason=primary,
            auxiliary_reasons=auxiliary,
            hearing_available=hearing_available,
            reading_available=True,
            partial_available=partial_available,
            changed=changed,
            scope=value.scope,
            ui_reason=ui_reason,
        )

    def _active_reasons(self, value: QoEInput) -> list[QoEReason]:
        """観測事実から優先順位付きの活性理由を返す（unknown は除外）。"""
        reasons: list[QoEReason] = []
        if value.queue_overloaded is True:
            reasons.append(QoEReason.QUEUE_OVERLOAD)
        if value.provider_recovering is True:
            reasons.append(QoEReason.PROVIDER_RECOVERING)
        if value.hearing_degraded is True:
            reasons.append(QoEReason.AI_HEARING_DEGRADED)
        if self._media_degraded(value):
            reasons.append(QoEReason.MEDIA_DEGRADED)
        return [r for r in _REASON_PRIORITY if r in reasons]

    def _media_degraded(self, value: QoEInput) -> bool:
        """Media 劣化が活性か。SERVER スコープでは Mode A 判定から除外する。"""
        if value.scope is QoEScope.SERVER:
            return False
        if value.packet_loss_ratio is None:
            return False
        threshold = (
            LOSS_RECOVER_RATIO
            if self._state is QoEState.MEDIA_DEGRADED
            else LOSS_DEGRADE_RATIO
        )
        return value.packet_loss_ratio > threshold

    @staticmethod
    def _reasons_for_held_state(state: QoEState) -> list[QoEReason]:
        """cooldown 維持中の状態に対応する理由を返す。"""
        for reason, mapped in _REASON_TO_STATE.items():
            if mapped is state:
                return [reason]
        return []

    @staticmethod
    def _hearing_available(scope: QoEScope, active: list[QoEReason]) -> bool:
        """スコープに応じた聞く主線可否を返す。"""
        if not active:
            return True
        if scope is QoEScope.LISTENER_LOCAL:
            return False
        return not any(r in _SERVER_HEARING_BLOCKERS for r in active)

    @staticmethod
    def _ui_reason(
        *,
        target: QoEState,
        primary: QoEReason | None,
        changed: bool,
        previous: QoEState,
    ) -> QoEUiReason:
        """UI 表示用の一貫した理由コードを返す。"""
        if target is QoEState.HEALTHY:
            if changed and previous is not QoEState.HEALTHY:
                return QoEUiReason.RECOVERED
            return QoEUiReason.HEALTHY
        if primary in _INTERRUPTED_REASONS:
            return QoEUiReason.INTERRUPTED
        return QoEUiReason.DEGRADED
