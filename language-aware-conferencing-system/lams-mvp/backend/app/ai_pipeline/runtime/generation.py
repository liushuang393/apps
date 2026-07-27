"""
GenerationTracker（純ロジック）。

目的:
    話者セッション内で generation_id を単調増加させ、barge-in 時に旧世代の再生を禁止する。
入力 / 出力:
    begin() -> 新 generation_id（旧世代は非アクティブ化）
    interrupt(id) / is_active(id) / should_capture(id)
注意:
    I/O 非依存。セッション再 open 時は reset() で 0 に戻してよい。
"""

from __future__ import annotations


class GenerationTracker:
    """generation_id の発行と cancel / capture 判定を担う純ロジック。"""

    def __init__(self) -> None:
        self._current: int = 0
        self._cancelled: set[int] = set()

    @property
    def current(self) -> int:
        """現在のアクティブ世代（未発行時は 0）。"""
        return self._current

    def begin(self) -> int:
        """
        新しい generation を発行する。

        Returns:
            単調増加した generation_id（1 起算）
        注意:
            直前の current は自動的に非アクティブ（cancel）扱いになる。
        """
        if self._current > 0:
            self._cancelled.add(self._current)
        self._current += 1
        # 新世代はキャンセル集合から除外（再発行で同番号は起きない想定）
        self._cancelled.discard(self._current)
        return self._current

    def interrupt(self, generation_id: int) -> None:
        """指定 generation をキャンセルし、capture を禁止する。"""
        if generation_id > 0:
            self._cancelled.add(generation_id)

    def is_active(self, generation_id: int) -> bool:
        """世代が現行かつ未キャンセルか。"""
        return (
            generation_id > 0
            and generation_id == self._current
            and generation_id not in self._cancelled
        )

    def should_capture(self, generation_id: int) -> bool:
        """Publisher / Sink が当該世代の音声を capture してよいか。"""
        return self.is_active(generation_id)

    def reset(self) -> None:
        """セッション再 open 時にカウンタを初期化する。"""
        self._current = 0
        self._cancelled.clear()
