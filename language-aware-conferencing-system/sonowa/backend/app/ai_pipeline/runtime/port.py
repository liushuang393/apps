"""
RealtimeRuntimePort プロトコル。

目的:
    会議セッションのライフサイクルと一発話 turn を、呼出順序の暗黙知なしに表す。
公開契約:
    open_session / run_turn / interrupt / is_generation_active / should_capture / close_session
注意:
    generation の発行・active 判定は Port 側が所有する。
    低レベル append/commit/events は実装内部用であり、Port 公開面ではない。
"""

from __future__ import annotations

from typing import Protocol

from app.ai_pipeline.runtime.types import SessionContext, TurnInput, TurnResult


class RealtimeRuntimePort(Protocol):
    """発話単位 / 持続接続の双方が満たす Runtime 境界。"""

    async def open_session(self, context: SessionContext) -> None:
        """
        セッションを開く（冪等）。

        持続実装では Provider 接続を確立し得る。同一 context の再呼出は失敗しない。
        """
        ...

    async def run_turn(self, turn: TurnInput) -> TurnResult:
        """
        一発話 turn を原子的に実行する。

        Args:
            turn: 発話 ID・音声・原文・任意の外部 generation_id
        Returns:
            発行した generation_id と終端付きイベント列
        注意:
            generation_id 省略時は Port 内 tracker が begin する。
        """
        ...

    def interrupt(self, generation_id: int) -> None:
        """指定 generation の未完了出力をキャンセルし、再生禁止にする。"""
        ...

    def is_generation_active(self, generation_id: int) -> bool:
        """世代が現行かつ未キャンセルか。"""
        ...

    def should_capture(self, generation_id: int) -> bool:
        """当該世代の音声を capture してよいか。"""
        ...

    async def close_session(self) -> None:
        """セッションを閉じる（冪等）。接続・バッファを解放する。"""
        ...
