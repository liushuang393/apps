"""確定発話を保護する取り込み制御。

キュー深度と最古データの滞留時間から、受理・縮退・明示破棄を決定する。
I/O に依存しないため、負荷境界を決定論的に単体テストできる。
"""

from collections import deque
from dataclasses import dataclass
from enum import Enum


class IngressAction(str, Enum):
    """確定発話をキューへ投入する際の判断。"""

    ACCEPT = "accept"
    ACCEPT_DEGRADED = "accept_degraded"
    DROP_AGED = "drop_aged"
    DROP_HARD = "drop_hard"


@dataclass(frozen=True)
class IngressDecision:
    """取り込み判断と判断時点の観測値。"""

    action: IngressAction
    depth: int
    oldest_age_ms: float | None
    reason: str


@dataclass(frozen=True)
class IngressSnapshot:
    """取り込み制御の観測スナップショット。"""

    depth: int
    oldest_age_ms: float | None
    final_dropped: int
    aged_dropped: int
    overload: bool


class SegmentIngress:
    """確定発話を通常過負荷では捨てず、メモリ上限だけを強制する。"""

    def __init__(
        self,
        *,
        soft_limit: int = 8,
        hard_limit: int = 64,
        max_age_ms: int = 30_000,
    ) -> None:
        if soft_limit <= 0 or hard_limit <= soft_limit:
            raise ValueError("soft_limit < hard_limit の正数で指定してください")
        if max_age_ms <= 0:
            raise ValueError("max_age_ms は正数で指定してください")
        self.soft_limit = soft_limit
        self.hard_limit = hard_limit
        self.max_age_ms = max_age_ms
        self._depth = 0
        self._oldest_age_ms: float | None = None
        self._final_dropped = 0
        self._aged_dropped = 0
        self._overload = False
        self._enqueued_at: deque[float] = deque()

    def record_enqueued(self, timestamp: float) -> None:
        """受理した確定発話の投入時刻を順序付きで記録する。"""
        self._enqueued_at.append(timestamp)

    def record_dequeued(self) -> None:
        """処理開始または強制破棄した最古発話を時刻列から除く。"""
        if self._enqueued_at:
            self._enqueued_at.popleft()

    def oldest_age_ms(self, now: float) -> float | None:
        """公開 API だけで最古発話の滞留時間を算出する。"""
        if not self._enqueued_at:
            return None
        return max(0.0, (now - self._enqueued_at[0]) * 1000.0)

    def decide_enqueue(
        self, *, depth: int, oldest_age_ms: float | None
    ) -> IngressDecision:
        """現在のキュー状態から確定発話の投入可否を決定する。"""
        self._depth = max(0, depth)
        self._oldest_age_ms = oldest_age_ms
        if oldest_age_ms is not None and oldest_age_ms > self.max_age_ms:
            action = IngressAction.DROP_AGED
            reason = "max_age_exceeded"
        elif depth >= self.hard_limit:
            action = IngressAction.DROP_HARD
            reason = "hard_limit_exceeded"
        elif depth >= self.soft_limit:
            action = IngressAction.ACCEPT_DEGRADED
            reason = "soft_limit_exceeded"
        else:
            action = IngressAction.ACCEPT
            reason = "within_limit"
        self._overload = depth >= self.soft_limit
        return IngressDecision(action, depth, oldest_age_ms, reason)

    def record_drop(self, reason: str) -> None:
        """明示破棄を理由別に計上する。"""
        self._final_dropped += 1
        if reason == "max_age_exceeded":
            self._aged_dropped += 1

    def observe(self, *, depth: int, oldest_age_ms: float | None) -> None:
        """dequeue 後などの最新キュー状態を記録する。"""
        self._depth = max(0, depth)
        self._oldest_age_ms = oldest_age_ms
        self._overload = depth >= self.soft_limit

    def snapshot(self) -> IngressSnapshot:
        """現在の深度・滞留時間・破棄数を返す。"""
        return IngressSnapshot(
            depth=self._depth,
            oldest_age_ms=self._oldest_age_ms,
            final_dropped=self._final_dropped,
            aged_dropped=self._aged_dropped,
            overload=self._overload,
        )
