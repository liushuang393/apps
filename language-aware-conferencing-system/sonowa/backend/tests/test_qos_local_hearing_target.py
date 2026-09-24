"""方式3（local TTS）の聞く主線だけ、P95 目標を緩めることを検証する。

ローカル GPU の翻訳音声は 5 秒の目標を常に超えるため、同じ目標では音声が一度も
流れない。方式3 だけ逐次通訳相当の目標へ緩め、クラウド方式の目標は変えない。
"""

from dataclasses import replace

import pytest

from app.ai_pipeline.effective_config import (
    env_pipeline_defaults,
    reset_pipeline_settings_cache_for_tests,
    set_cached_pipeline_settings,
)
from app.ai_pipeline.qos import (
    HEARING_P95_TARGET_MS,
    LOCAL_HEARING_P95_TARGET_MS,
    HybridQoSMonitor,
)


@pytest.fixture(autouse=True)
def _restore_settings():
    """テスト間でキャッシュ設定を汚さない（未設定状態へ戻す）。"""
    yield
    reset_pipeline_settings_cache_for_tests()


@pytest.mark.parametrize(
    ("tts", "exceeded"),
    [("local", False), ("auto", True), ("openai", True)],
)
def test_hearing_target_depends_on_local_tts(tts: str, exceeded: bool) -> None:
    """8 秒の音声遅延は方式3 では許容し、クラウド方式では縮退させる。"""
    set_cached_pipeline_settings(replace(env_pipeline_defaults(), tts_provider=tts))
    monitor = HybridQoSMonitor()
    monitor.record_latency("hearing", 8000.0)
    assert monitor.hearing_p95_exceeded() is exceeded
    assert (monitor.evaluate_latency("hearing") is None) is (not exceeded)


def test_local_target_still_degrades_when_far_too_late() -> None:
    """方式3 でも緩和後の目標を超えれば字幕へ縮退する。"""
    set_cached_pipeline_settings(replace(env_pipeline_defaults(), tts_provider="local"))
    monitor = HybridQoSMonitor()
    monitor.record_latency("hearing", LOCAL_HEARING_P95_TARGET_MS + 1000.0)
    warning = monitor.evaluate_latency("hearing")
    assert warning and warning["target_ms"] == LOCAL_HEARING_P95_TARGET_MS
    assert LOCAL_HEARING_P95_TARGET_MS > HEARING_P95_TARGET_MS


def test_explicit_targets_are_not_overridden() -> None:
    """明示指定した目標は方式に関係なくそのまま使う。"""
    set_cached_pipeline_settings(replace(env_pipeline_defaults(), tts_provider="local"))
    monitor = HybridQoSMonitor(targets_ms={"hearing": 1000.0, "reading": 1000.0})
    monitor.record_latency("hearing", 2000.0)
    assert monitor.hearing_p95_exceeded() is True
