"""
SpeechSegmenter（app.webrtc.segmenter）の単体テスト。

VAD 判定関数を注入し、発話末尾無音での確定・最小長破棄・最大長強制確定・
flush の挙動を、I/O 非依存で検証する。フレーム = 20ms @16k = 320 標本 = 640 byte。
"""

import numpy as np

from app.webrtc.segmenter import SpeechSegmenter, energy_is_speech

_FRAME_BYTES = 320 * 2  # 20ms @ 16k, int16


def _frame(value: int = 0) -> bytes:
    """一定振幅の 1 フレーム PCM を作る（value=0 は無音）。"""
    return np.full(320, value, dtype=np.int16).tobytes()


def _loud() -> bytes:
    return _frame(8000)


def _silent() -> bytes:
    return _frame(0)


def _seg(is_speech) -> SpeechSegmenter:
    return SpeechSegmenter(
        silence_ms=60,  # 3 フレームの無音で確定
        min_speech_ms=40,  # 2 フレーム以上で有効
        max_segment_ms=200,  # 10 フレームで強制確定
        is_speech=is_speech,
    )


def test_emits_segment_after_trailing_silence() -> None:
    """発話後に閾値分の無音が続くと 1 セグメントが確定する。"""
    seg = _seg(lambda f: f == _loud())
    out = seg.push(_loud() * 4 + _silent() * 3)
    assert len(out) == 1
    # 発話 4 + 末尾無音 3 フレーム分を含む。
    assert len(out[0]) == _FRAME_BYTES * 7


def test_drops_segment_below_min_speech() -> None:
    """最小発話長未満（1 フレーム）の発話は破棄される。"""
    seg = _seg(lambda f: f == _loud())
    out = seg.push(_loud() * 1 + _silent() * 3)
    assert out == []


def test_force_emit_on_max_segment() -> None:
    """無音が来なくても最大長に達すると強制確定する。"""
    seg = _seg(lambda _f: True)  # 常時発話扱い
    out = seg.push(_loud() * 10)
    assert len(out) == 1
    assert len(out[0]) == _FRAME_BYTES * 10


def test_leading_silence_is_discarded() -> None:
    """発話前の無音はバッファに溜めず破棄する。"""
    seg = _seg(lambda f: f == _loud())
    out = seg.push(_silent() * 5 + _loud() * 3 + _silent() * 3)
    assert len(out) == 1
    assert len(out[0]) == _FRAME_BYTES * 6  # 発話 3 + 末尾無音 3


def test_flush_returns_pending_speech() -> None:
    """終端 flush で末尾無音未達の発話を取り出せる。"""
    seg = _seg(lambda f: f == _loud())
    assert seg.push(_loud() * 3) == []  # まだ確定しない
    pending = seg.flush()
    assert pending is not None and len(pending) == _FRAME_BYTES * 3


def test_flush_drops_short_pending() -> None:
    """flush 時も最小長未満は破棄する。"""
    seg = _seg(lambda f: f == _loud())
    seg.push(_loud() * 1)
    assert seg.flush() is None


def test_partial_frame_is_buffered() -> None:
    """フレーム未満の端数は次 push まで保持される。"""
    seg = _seg(lambda _f: True)
    half = _FRAME_BYTES // 2
    assert seg.push(_loud()[:half]) == []  # 端数のみ → フレーム未成立
    out = seg.push(_loud()[half:] + _loud() * 9)
    assert len(out) == 1  # 結合して 10 フレーム → 強制確定


def test_energy_is_speech_default() -> None:
    """既定エネルギー VAD は無音 False・大振幅 True を返す。"""
    assert energy_is_speech(_silent()) is False
    assert energy_is_speech(_loud()) is True
    assert energy_is_speech(b"") is False
