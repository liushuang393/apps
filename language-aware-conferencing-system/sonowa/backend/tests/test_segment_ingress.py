"""確定発話を保護する SegmentIngress の振る舞いを検証する。"""

from app.webrtc.ingress import IngressAction, SegmentIngress


def test_accepts_below_soft_limit() -> None:
    """通常時は確定発話を受理し、縮退しない。"""
    ingress = SegmentIngress(soft_limit=2, hard_limit=4, max_age_ms=1000)

    decision = ingress.decide_enqueue(depth=1, oldest_age_ms=100)

    assert decision.action is IngressAction.ACCEPT


def test_soft_limit_accepts_with_degradation() -> None:
    """soft limit 到達時も確定発話を破棄せず縮退付きで受理する。"""
    ingress = SegmentIngress(soft_limit=2, hard_limit=4, max_age_ms=1000)

    decision = ingress.decide_enqueue(depth=2, oldest_age_ms=100)

    assert decision.action is IngressAction.ACCEPT_DEGRADED


def test_hard_limit_drops_and_records_final() -> None:
    """hard limit 到達時はメモリ保護の破棄を観測可能にする。"""
    ingress = SegmentIngress(soft_limit=2, hard_limit=4, max_age_ms=1000)

    decision = ingress.decide_enqueue(depth=4, oldest_age_ms=100)
    ingress.record_drop(decision.reason)

    assert decision.action is IngressAction.DROP_HARD
    assert ingress.snapshot().final_dropped == 1


def test_aged_segment_is_dropped_and_recorded() -> None:
    """最大滞留時間を超えた確定発話は理由付きで破棄する。"""
    ingress = SegmentIngress(soft_limit=2, hard_limit=4, max_age_ms=1000)

    decision = ingress.decide_enqueue(depth=2, oldest_age_ms=1001)
    ingress.record_drop(decision.reason)

    assert decision.action is IngressAction.DROP_AGED
    assert ingress.snapshot().aged_dropped == 1


def test_tracks_oldest_age_without_queue_internals() -> None:
    """投入・取り出し時刻から最古滞留時間を公開APIで追跡する。"""
    ingress = SegmentIngress(soft_limit=2, hard_limit=4, max_age_ms=1000)
    ingress.record_enqueued(10.0)
    ingress.record_enqueued(10.5)

    assert ingress.oldest_age_ms(11.0) == 1000.0
    ingress.record_dequeued()
    assert ingress.oldest_age_ms(11.0) == 500.0
