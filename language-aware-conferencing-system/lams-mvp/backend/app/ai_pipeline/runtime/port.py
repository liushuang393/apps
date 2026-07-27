"""
RealtimeRuntimePort プロトコル。

目的:
    聞く主線の Provider 接続ライフサイクルを抽象化し、呼び出し側が SDK に直接依存しない。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from app.ai_pipeline.runtime.generation import GenerationTracker
from app.ai_pipeline.runtime.types import RuntimeEvent, SessionContext


class RealtimeRuntimePort(Protocol):
    """発話単位 / 持続接続の双方が満たす Runtime 境界。"""

    @property
    def generation_tracker(self) -> GenerationTracker:
        """barge-in と音声出力判定に使う世代管理を返す。"""
        ...

    def set_original_text(self, text: str | None) -> None:
        """上流で認識済みの原文を設定する。"""
        ...

    async def open_session(self, context: SessionContext) -> None:
        """セッションを開く（持続実装では Provider 接続を確立し得る）。"""
        ...

    async def append_audio(self, pcm: bytes) -> None:
        """発話音声（セグメント PCM/WAV）を入力バッファへ追加する。"""
        ...

    async def commit_turn(
        self, utterance_id: str, *, generation_id: int | None = None
    ) -> int:
        """
        ターン確定。翻訳生成を開始し、発行した generation_id を返す。

        Args:
            utterance_id: 発話セグメント識別子
            generation_id: 外部発行済み世代（省略時は内部 begin）
        Returns:
            本ターンの generation_id
        """
        ...

    def interrupt(self, generation_id: int) -> None:
        """指定 generation の未完了出力をキャンセルし、再生禁止にする。"""
        ...

    def events(self) -> AsyncIterator[RuntimeEvent]:
        """直近 commit_turn の結果イベント列を返す。"""
        ...

    async def close_session(self) -> None:
        """セッションを閉じ、接続・バッファを解放する。"""
        ...
