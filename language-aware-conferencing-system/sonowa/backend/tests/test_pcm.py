"""
PCM 音声ユーティリティ（app.audio.pcm）の単体テスト。

対象: to_mono16 / resample16 / chunk16 の純関数。
方針: LiveKit・I/O 非依存。numpy 配列を直接検証し、形状・値域・剰余を確認する。
"""

import numpy as np
import pytest

from app.audio.pcm import chunk16, resample16, to_mono16


def _pcm(values: list[int]) -> bytes:
    """int リストを little-endian int16 PCM バイト列へ変換する。"""
    return np.asarray(values, dtype=np.int16).tobytes()


def _ints(data: bytes) -> list[int]:
    """int16 PCM バイト列を int リストへ戻す。"""
    return np.frombuffer(data, dtype=np.int16).tolist()


def test_to_mono16_passthrough_when_mono() -> None:
    """モノ（num_channels<=1）は無変換で返す。"""
    data = _pcm([1, 2, 3])
    assert to_mono16(data, 1) == data


def test_to_mono16_averages_stereo() -> None:
    """ステレオは L/R 平均でモノ化する。"""
    data = _pcm([10, 20, 30, 40])  # (10,20),(30,40)
    assert _ints(to_mono16(data, 2)) == [15, 35]


def test_to_mono16_drops_incomplete_trailing_sample() -> None:
    """ch 数で割り切れない末尾標本は切り捨てる。"""
    data = _pcm([10, 20, 30])  # 2ch では最後の 30 は端数
    assert _ints(to_mono16(data, 2)) == [15]


def test_to_mono16_empty() -> None:
    """空入力は空を返す。"""
    assert to_mono16(b"", 2) == b""


def test_resample16_identity_same_rate() -> None:
    """同一レートは無変換で返す。"""
    data = _pcm([1, 2, 3, 4])
    assert resample16(data, 16000, 16000) == data


def test_resample16_downsample_halves_length() -> None:
    """半分のレートへ落とすと標本数はおよそ半分になる。"""
    src = _pcm(list(range(100)))
    out = resample16(src, 48000, 24000)
    assert abs(len(_ints(out)) - 50) <= 1


def test_resample16_upsample_doubles_length() -> None:
    """倍のレートへ上げると標本数はおよそ倍になる。"""
    src = _pcm(list(range(50)))
    out = resample16(src, 24000, 48000)
    assert abs(len(_ints(out)) - 100) <= 1


def test_resample16_preserves_endpoints() -> None:
    """端点（最初/最後の標本値）は線形補間で保存される。"""
    src = _pcm([0, 100, 200, 300])
    out = _ints(resample16(src, 16000, 8000))
    assert out[0] == 0
    assert out[-1] == 300


def test_resample16_empty() -> None:
    """空入力は空を返す。"""
    assert resample16(b"", 48000, 16000) == b""


def test_resample16_rejects_nonpositive_rate() -> None:
    """非正のレートは ValueError。"""
    with pytest.raises(ValueError):
        resample16(_pcm([1, 2]), 0, 16000)


def test_chunk16_splits_full_frames_and_remainder() -> None:
    """完全フレームと端数へ分割する。"""
    data = _pcm(list(range(10)))  # 10 標本
    frames, remainder = chunk16(data, 4)
    assert len(frames) == 2
    assert _ints(frames[0]) == [0, 1, 2, 3]
    assert _ints(frames[1]) == [4, 5, 6, 7]
    assert _ints(remainder) == [8, 9]


def test_chunk16_no_remainder_when_exact() -> None:
    """割り切れる場合は端数なし。"""
    data = _pcm(list(range(8)))
    frames, remainder = chunk16(data, 4)
    assert len(frames) == 2
    assert remainder == b""


def test_chunk16_all_remainder_when_too_short() -> None:
    """1 フレームに満たなければ全て端数。"""
    data = _pcm([1, 2])
    frames, remainder = chunk16(data, 4)
    assert frames == []
    assert _ints(remainder) == [1, 2]


def test_chunk16_rejects_nonpositive_frame() -> None:
    """非正のフレーム長は ValueError。"""
    with pytest.raises(ValueError):
        chunk16(_pcm([1, 2]), 0)


def test_parse_wav16_roundtrip():
    """wrap_wav16 の出力から PCM とサンプルレートを復元できる。"""
    from app.audio.pcm import parse_wav16, wrap_wav16

    pcm = b"\x01\x02" * 100
    wav = wrap_wav16(pcm, 16000)
    out_pcm, rate = parse_wav16(wav)
    assert out_pcm == pcm
    assert rate == 16000


def test_parse_wav16_raw_pcm_fallback():
    """RIFF ヘッダなしのバイト列は生 PCM とみなし fallback_rate を返す。"""
    from app.audio.pcm import parse_wav16

    raw = b"\x05\x06" * 50
    out_pcm, rate = parse_wav16(raw, fallback_rate=24000)
    assert out_pcm == raw
    assert rate == 24000
