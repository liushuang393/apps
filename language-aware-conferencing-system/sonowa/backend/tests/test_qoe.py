"""Media・AI・Queue・Provider を統合する QoE 権威のテスト。

方針: 内部 state 変数ではなく、観測系列に対して返る decision を検証する。
"""

from app.ai_pipeline.qoe import (
    LOSS_DEGRADE_RATIO,
    LOSS_RECOVER_RATIO,
    QoEInput,
    QoEReason,
    QoEScope,
    QoEState,
    QoEStateMachine,
    QoEUiReason,
)


def test_packet_loss_degrades_listener_local_hearing() -> None:
    """受聴者単位の Media 劣化は listener-local で聞く主線を止める。"""
    machine = QoEStateMachine()

    decision = machine.evaluate(
        QoEInput(packet_loss_ratio=0.06, scope=QoEScope.LISTENER_LOCAL)
    )

    assert decision.state is QoEState.MEDIA_DEGRADED
    assert decision.hearing_available is False
    assert decision.reading_available is True
    assert decision.primary_reason is QoEReason.MEDIA_DEGRADED
    assert decision.scope is QoEScope.LISTENER_LOCAL
    assert decision.ui_reason is QoEUiReason.DEGRADED


def test_server_media_alone_does_not_stop_mode_a() -> None:
    """個人 RTCStats 相当の Media 単独劣化は会議全体の Mode A を止めない。"""
    machine = QoEStateMachine()

    decision = machine.evaluate(QoEInput(packet_loss_ratio=0.06, scope=QoEScope.SERVER))

    assert decision.state is QoEState.HEALTHY
    assert decision.hearing_available is True
    assert decision.primary_reason is None
    assert decision.scope is QoEScope.SERVER


def test_queue_overload_prioritizes_final() -> None:
    """Queue 過負荷では暫定を止め、読む主線と確定発話は継続する。"""
    machine = QoEStateMachine()

    decision = machine.evaluate(QoEInput(queue_overloaded=True))

    assert decision.state is QoEState.QUEUE_OVERLOAD
    assert decision.partial_available is False
    assert decision.hearing_available is False
    assert decision.reading_available is True
    assert decision.primary_reason is QoEReason.QUEUE_OVERLOAD
    assert decision.ui_reason is QoEUiReason.INTERRUPTED


def test_unknown_observations_do_not_degrade() -> None:
    """未計測値は正常値ではなく unknown として扱い、単独では縮退しない。"""
    machine = QoEStateMachine()

    decision = machine.evaluate(
        QoEInput(
            packet_loss_ratio=None,
            hearing_degraded=None,
            provider_recovering=None,
            queue_overloaded=None,
        )
    )

    assert decision.state is QoEState.HEALTHY
    assert decision.hearing_available is True
    assert decision.partial_available is True
    assert decision.primary_reason is None
    assert decision.auxiliary_reasons == ()


def test_composite_priority_queue_over_provider_ai_media() -> None:
    """複合劣化時の優先順位は Queue → Provider → AI hearing → Media。"""
    machine = QoEStateMachine()

    decision = machine.evaluate(
        QoEInput(
            queue_overloaded=True,
            provider_recovering=True,
            hearing_degraded=True,
            packet_loss_ratio=0.06,
            scope=QoEScope.LISTENER_LOCAL,
        )
    )

    assert decision.state is QoEState.QUEUE_OVERLOAD
    assert decision.primary_reason is QoEReason.QUEUE_OVERLOAD
    assert decision.auxiliary_reasons == (
        QoEReason.PROVIDER_RECOVERING,
        QoEReason.AI_HEARING_DEGRADED,
        QoEReason.MEDIA_DEGRADED,
    )


def test_provider_recovering_disables_partial_and_hearing() -> None:
    """Provider 再接続中は不完全音声と暫定を止め、読む主線は継続する。"""
    machine = QoEStateMachine()

    decision = machine.evaluate(QoEInput(provider_recovering=True))

    assert decision.state is QoEState.PROVIDER_RECOVERING
    assert decision.hearing_available is False
    assert decision.partial_available is False
    assert decision.reading_available is True
    assert decision.ui_reason is QoEUiReason.INTERRUPTED


def test_ai_hearing_degraded_disables_hearing_keeps_reading() -> None:
    """AI hearing 劣化は聞く主線のみ止め、読む主線は継続する。"""
    machine = QoEStateMachine()

    decision = machine.evaluate(QoEInput(hearing_degraded=True))

    assert decision.state is QoEState.HEARING_DEGRADED
    assert decision.hearing_available is False
    assert decision.reading_available is True
    assert decision.partial_available is True
    assert decision.primary_reason is QoEReason.AI_HEARING_DEGRADED
    assert decision.ui_reason is QoEUiReason.DEGRADED


def test_recovery_requires_loss_below_hysteresis_and_cooldown() -> None:
    """Media 回復はヒステリシス閾値と cooldown を満たすまで状態を維持する。"""
    now = [0.0]
    machine = QoEStateMachine(clock=lambda: now[0], recovery_cooldown_s=2.0)
    machine.evaluate(QoEInput(packet_loss_ratio=0.06, scope=QoEScope.LISTENER_LOCAL))

    now[0] = 1.0
    still_degraded = machine.evaluate(
        QoEInput(packet_loss_ratio=0.02, scope=QoEScope.LISTENER_LOCAL)
    )
    now[0] = 3.1
    recovered = machine.evaluate(
        QoEInput(packet_loss_ratio=0.02, scope=QoEScope.LISTENER_LOCAL)
    )

    assert still_degraded.state is QoEState.MEDIA_DEGRADED
    assert still_degraded.changed is False
    assert recovered.state is QoEState.HEALTHY
    assert recovered.changed is True
    assert recovered.hearing_available is True
    assert recovered.ui_reason is QoEUiReason.RECOVERED


def test_cooldown_holds_ai_hearing_recovery() -> None:
    """AI hearing 回復も cooldown 中は状態を維持し、経過後に changed で再開する。"""
    now = [0.0]
    machine = QoEStateMachine(clock=lambda: now[0], recovery_cooldown_s=2.0)
    machine.evaluate(QoEInput(hearing_degraded=True))

    now[0] = 1.0
    held = machine.evaluate(QoEInput(hearing_degraded=False))
    now[0] = 3.0
    recovered = machine.evaluate(QoEInput(hearing_degraded=False))

    assert held.state is QoEState.HEARING_DEGRADED
    assert held.hearing_available is False
    assert recovered.state is QoEState.HEALTHY
    assert recovered.changed is True
    assert recovered.ui_reason is QoEUiReason.RECOVERED


def test_decision_excludes_sensitive_fields() -> None:
    """input/decision に会議本文・Token・API Key 相当のフィールドが無い。"""
    decision = QoEStateMachine().evaluate(QoEInput(queue_overloaded=True))
    decision_fields = set(decision.__dataclass_fields__)
    input_fields = set(QoEInput.__dataclass_fields__)

    forbidden = {
        "text",
        "transcript",
        "token",
        "api_key",
        "authorization",
        "original_text",
    }
    assert not (decision_fields & forbidden)
    assert not (input_fields & forbidden)


def test_loss_thresholds_are_exported_for_parity() -> None:
    """前端 listener-local と共有する閾値が公開定数として存在する。"""
    assert LOSS_DEGRADE_RATIO == 0.05
    assert LOSS_RECOVER_RATIO == 0.03
