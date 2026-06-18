"""
HybridQoSMonitor（Phase 3 ハイブリッド 2 主線の QoS 計測, README §9）の単体テスト。

対象: app.ai_pipeline.qos の純ロジック（percentile / HybridQoSMonitor）。
方針: I/O・時刻非依存。サンプルを直接投入し P95・命中率・警告生成を検証する。
"""

from app.ai_pipeline.qos import (
    GLOSSARY_HIT_RATE_TARGET,
    HEARING_P95_TARGET_MS,
    READING_P95_TARGET_MS,
    HybridQoSMonitor,
    percentile,
)


def test_percentile_empty_returns_none() -> None:
    """空サンプルは None（計測不能）"""
    assert percentile([]) is None


def test_percentile_single_value() -> None:
    """単一サンプルはその値"""
    assert percentile([42.0]) == 42.0


def test_percentile_nearest_rank_p95() -> None:
    """nearest-rank 法で P95 を算出する"""
    values = [float(i) for i in range(1, 101)]  # 1..100
    assert percentile(values, 95.0) == 95.0


def test_record_latency_ignores_unknown_and_negative() -> None:
    """未知主線・負値は記録されない"""
    mon = HybridQoSMonitor()
    mon.record_latency("unknown", 100.0)
    mon.record_latency("hearing", -5.0)
    assert mon.p95("unknown") is None
    assert mon.p95("hearing") is None


def test_p95_per_mainline_independent() -> None:
    """主線ごとに独立して P95 を保持する"""
    mon = HybridQoSMonitor()
    for v in (100.0, 200.0, 300.0):
        mon.record_latency("hearing", v)
    mon.record_latency("reading", 50.0)
    assert mon.p95("hearing") == 300.0
    assert mon.p95("reading") == 50.0


def test_evaluate_latency_none_when_within_target() -> None:
    """目標内なら警告なし"""
    mon = HybridQoSMonitor()
    mon.record_latency("hearing", HEARING_P95_TARGET_MS - 1.0)
    assert mon.evaluate_latency("hearing") is None


def test_evaluate_latency_warns_on_breach() -> None:
    """目標超過で latency_p95 警告を返す"""
    mon = HybridQoSMonitor()
    mon.record_latency("reading", READING_P95_TARGET_MS + 500.0)
    warn = mon.evaluate_latency("reading")
    assert warn is not None
    assert warn["type"] == "qos_warning"
    assert warn["metric"] == "latency_p95"
    assert warn["mainline"] == "reading"
    assert warn["target_ms"] == READING_P95_TARGET_MS


def test_glossary_hit_rate_accumulates() -> None:
    """命中数/候補数を累積して命中率を算出する"""
    mon = HybridQoSMonitor()
    mon.record_glossary(8, 10)
    mon.record_glossary(9, 10)
    assert mon.glossary_hit_rate() == 17 / 20


def test_record_glossary_ignores_nonpositive_total() -> None:
    """total<=0 は分母に加算しない"""
    mon = HybridQoSMonitor()
    mon.record_glossary(1, 0)
    assert mon.glossary_hit_rate() is None


def test_record_glossary_clamps_hits() -> None:
    """命中数は候補数で頭打ち（hits>total を許さない）"""
    mon = HybridQoSMonitor()
    mon.record_glossary(20, 10)
    assert mon.glossary_hit_rate() == 1.0


def test_evaluate_glossary_warns_below_target() -> None:
    """命中率が目標未満なら glossary_hit_rate 警告を返す"""
    mon = HybridQoSMonitor()
    mon.record_glossary(5, 10)  # 0.5 < 0.95
    warn = mon.evaluate_glossary()
    assert warn is not None
    assert warn["metric"] == "glossary_hit_rate"
    assert warn["target"] == GLOSSARY_HIT_RATE_TARGET
    assert warn["value"] == 0.5


def test_evaluate_glossary_none_when_meets_target() -> None:
    """目標達成時は警告なし"""
    mon = HybridQoSMonitor()
    mon.record_glossary(96, 100)
    assert mon.evaluate_glossary() is None


def test_snapshot_reports_samples_and_metrics() -> None:
    """スナップショットは主線別サンプル数と各指標を返す"""
    mon = HybridQoSMonitor()
    mon.record_latency("hearing", 1000.0)
    mon.record_latency("hearing", 2000.0)
    mon.record_glossary(9, 10)
    snap = mon.snapshot()
    assert snap.hearing_samples == 2
    assert snap.reading_samples == 0
    assert snap.reading_p95_ms is None
    assert snap.glossary_hit_rate == 0.9


def test_window_caps_memory() -> None:
    """窓長を超える古いサンプルは破棄される（メモリ上限）"""
    mon = HybridQoSMonitor(window=3)
    for v in (10.0, 20.0, 30.0, 40.0):
        mon.record_latency("hearing", v)
    # 直近 3 件（20,30,40）のみ保持
    assert mon.p95("hearing") == 40.0
    assert mon.snapshot().hearing_samples == 3
