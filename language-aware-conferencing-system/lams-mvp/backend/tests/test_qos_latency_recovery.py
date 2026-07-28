"""聞く主線の P95 超過が時間経過で回復可能であることを検証する。

背景:
    hearing の P95 超過が観測されると QoE 権威は Mode A（聞く主線）を停止する。
    停止すると新しい hearing 遅延サンプルが記録されなくなるため、固定長の件数窓
    だけで P95 を評価すると「古い遅い1件」が窓から出て行かず、超過が永久に成立
    し続ける。結果として翻訳音声は会議終了まで復帰せず字幕へ縮退したままになる。

検証内容:
    有効期間を過ぎた観測は P95 評価から除外され、hearing_p95_exceeded() が
    False（回復可能）へ戻ること。
"""

from __future__ import annotations

from app.ai_pipeline.qoe import QoEInput, QoEScope, QoEStateMachine
from app.ai_pipeline.qos import (
    HEARING_P95_TARGET_MS,
    LATENCY_WINDOW_SECONDS,
    HybridQoSMonitor,
)


def test_hearing_p95_recovers_after_window_expires_without_new_samples() -> None:
    """新規サンプルが無くても、有効期間経過で聞く主線が復帰可能になる。"""
    now = [1000.0]
    monitor = HybridQoSMonitor(clock=lambda: now[0])
    machine = QoEStateMachine(clock=lambda: now[0], recovery_cooldown_s=5.0)

    monitor.record_latency("hearing", HEARING_P95_TARGET_MS + 4000.0)
    assert monitor.hearing_p95_exceeded() is True
    degraded = machine.evaluate(
        QoEInput(hearing_degraded=monitor.hearing_p95_exceeded(), scope=QoEScope.SERVER)
    )
    assert degraded.hearing_available is False

    # 聞く主線が停止するとサンプルは増えない。時間だけが経過する。
    now[0] += LATENCY_WINDOW_SECONDS + 1.0
    assert monitor.hearing_p95_exceeded() is not True, (
        "古い遅延観測が窓から出ず、翻訳音声が永久に復帰しない"
    )
    # 回復 cooldown を満たすため 2 回評価する（1 回目で healthy_since を確定）。
    machine.evaluate(
        QoEInput(hearing_degraded=monitor.hearing_p95_exceeded(), scope=QoEScope.SERVER)
    )
    now[0] += 6.0
    recovered = machine.evaluate(
        QoEInput(hearing_degraded=monitor.hearing_p95_exceeded(), scope=QoEScope.SERVER)
    )
    assert recovered.hearing_available is True, "QoE が聞く主線を復帰させられない"


def test_hearing_p95_stays_exceeded_within_window() -> None:
    """有効期間内は超過判定を維持する（早すぎる復帰をしない）。"""
    now = [1000.0]
    monitor = HybridQoSMonitor(clock=lambda: now[0])

    monitor.record_latency("hearing", HEARING_P95_TARGET_MS + 4000.0)
    now[0] += LATENCY_WINDOW_SECONDS / 2.0
    assert monitor.hearing_p95_exceeded() is True


def test_expired_samples_excluded_from_snapshot_counts() -> None:
    """有効期間を過ぎた観測はスナップショットの件数からも除外される。"""
    now = [0.0]
    monitor = HybridQoSMonitor(clock=lambda: now[0])

    monitor.record_latency("hearing", 1000.0)
    now[0] += LATENCY_WINDOW_SECONDS + 1.0
    monitor.record_latency("hearing", 2000.0)

    snapshot = monitor.snapshot()
    assert snapshot.hearing_samples == 1
    assert snapshot.hearing_p95_ms == 2000.0
