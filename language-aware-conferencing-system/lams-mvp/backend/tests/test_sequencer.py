"""SubtitleSequencer の重複排除（時間窓）と採番の回帰テスト。

改善点 M2（docs/翻訳品質_改善点.md）: 従来は「直前と完全一致」で無条件に抑制し、
時間的に離れた正当な反復（「はい、はい」等）まで漏らしていた。時間窓を導入し、
窓内の同一発話のみ抑制し、窓外の同一発話は通すことを検証する。
"""

from app.webrtc.persistence import SubtitleSequencer


class _FakeClock:
    """テスト用の手動時計（進めた分だけ時刻が進む）。"""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_same_text_within_window_is_duplicate():
    """窓内の同一話者・同一テキストは重複として抑制する。"""
    clock = _FakeClock()
    seq = SubtitleSequencer(clock=clock, window_s=2.0)
    seq.remember("room", "spk", "はい")
    clock.now += 1.0  # 窓内
    assert seq.is_duplicate("room", "spk", "はい") is True


def test_same_text_outside_window_is_not_duplicate():
    """窓を超えた同一テキストは正当な反復として通す（漏らさない）。"""
    clock = _FakeClock()
    seq = SubtitleSequencer(clock=clock, window_s=2.0)
    seq.remember("room", "spk", "はい")
    clock.now += 2.5  # 窓外
    assert seq.is_duplicate("room", "spk", "はい") is False


def test_first_utterance_is_never_duplicate():
    """記録が無い発話は重複ではない。"""
    seq = SubtitleSequencer(clock=_FakeClock(), window_s=2.0)
    assert seq.is_duplicate("room", "spk", "はい") is False


def test_different_text_is_not_duplicate():
    """同一話者でもテキストが異なれば重複ではない。"""
    clock = _FakeClock()
    seq = SubtitleSequencer(clock=clock, window_s=2.0)
    seq.remember("room", "spk", "はい")
    assert seq.is_duplicate("room", "spk", "いいえ") is False


def test_speakers_are_independent():
    """話者ごとに直近テキストは独立管理される。"""
    clock = _FakeClock()
    seq = SubtitleSequencer(clock=clock, window_s=2.0)
    seq.remember("room", "spk1", "はい")
    assert seq.is_duplicate("room", "spk2", "はい") is False


def test_forget_room_clears_state():
    """forget_room で採番・重複排除状態が破棄される。"""
    clock = _FakeClock()
    seq = SubtitleSequencer(clock=clock, window_s=2.0)
    seq.next_seq("room")
    seq.remember("room", "spk", "はい")
    seq.forget_room("room")
    assert seq.is_duplicate("room", "spk", "はい") is False
    assert seq.next_seq("room") == 1  # 採番がリセットされている
