"""Media・AI・Queue を統合する QoE 状態機械のテスト。"""

from app.ai_pipeline.qoe import QoEInput, QoEState, QoEStateMachine


def test_packet_loss_degrades_and_disables_hearing() -> None:
    machine = QoEStateMachine()

    decision = machine.evaluate(QoEInput(packet_loss_ratio=0.06))

    assert decision.state is QoEState.MEDIA_DEGRADED
    assert decision.hearing_available is False


def test_queue_overload_prioritizes_final() -> None:
    machine = QoEStateMachine()

    decision = machine.evaluate(QoEInput(queue_overloaded=True))

    assert decision.state is QoEState.QUEUE_OVERLOAD
    assert decision.partial_available is False


def test_unknown_media_stats_do_not_degrade() -> None:
    machine = QoEStateMachine()

    decision = machine.evaluate(QoEInput(packet_loss_ratio=None))

    assert decision.state is QoEState.HEALTHY


def test_recovery_requires_loss_below_hysteresis_and_cooldown() -> None:
    now = [0.0]
    machine = QoEStateMachine(clock=lambda: now[0], recovery_cooldown_s=2.0)
    machine.evaluate(QoEInput(packet_loss_ratio=0.06))

    now[0] = 1.0
    still_degraded = machine.evaluate(QoEInput(packet_loss_ratio=0.02))
    now[0] = 3.1
    recovered = machine.evaluate(QoEInput(packet_loss_ratio=0.02))

    assert still_degraded.state is QoEState.MEDIA_DEGRADED
    assert recovered.state is QoEState.HEALTHY
