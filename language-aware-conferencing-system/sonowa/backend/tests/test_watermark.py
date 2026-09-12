"""
watermark モジュールのテスト（P4-B：合成音の provenance マーカー）。

目的:
    - TTS 合成 WAV に埋め込む出所マーカーの「埋め込み・検出・読み出し」を検証する。
入出力:
    - app.audio.pcm.wrap_wav16 で生成した実 WAV を入力に用いる。
注意点:
    - マーカー付与後も音声フレームがバイト単位で不変であることを保証する
      （再生への非影響）。異常入力では例外を投げないことも確認する。
"""

import io
import struct
import wave

from app.audio.pcm import wrap_wav16
from app.audio.watermark import (
    _DEFAULT_MARKER,
    apply_watermark,
    is_watermarked,
    read_watermark,
)

# テスト用 PCM: 16-bit mono, 8000 サンプルの一定値。
_SAMPLE_RATE = 16000
_TEST_PCM = b"\x10\x00" * 8000
# RIFF ヘッダのサイズフィールドは bytes[4:8]、全体長 - 8 を格納する。
_RIFF_SIZE_FIELD_OFFSET = 4


def _read_frames(wav: bytes) -> bytes:
    """WAV を stdlib wave で開き、全オーディオフレームを返す（再生互換の確認用）。"""
    with wave.open(io.BytesIO(wav), "rb") as reader:
        return reader.readframes(reader.getnframes())


def _make_wav() -> bytes:
    """テスト用の正当な WAV バイト列を生成する。"""
    return wrap_wav16(_TEST_PCM, _SAMPLE_RATE)


def test_apply_watermark_keeps_audio_frames_identical() -> None:
    """マーカー付与後も stdlib wave で解析でき、フレームが原本と一致する。"""
    original = _make_wav()
    watermarked = apply_watermark(original)

    assert _read_frames(watermarked) == _read_frames(original)
    assert _read_frames(watermarked) == _TEST_PCM


def test_is_watermarked_false_before_true_after() -> None:
    """付与前は False、付与後は True を返す。"""
    original = _make_wav()
    assert is_watermarked(original) is False
    assert is_watermarked(apply_watermark(original)) is True


def test_read_watermark_returns_marker_after_apply() -> None:
    """付与後は marker 文字列、付与前は None を返す。"""
    original = _make_wav()
    assert read_watermark(original) is None
    assert read_watermark(apply_watermark(original)) == _DEFAULT_MARKER


def test_apply_watermark_is_idempotent() -> None:
    """同一マーカーの二重付与は一度と等価（バイト一致・フレーム不変）。"""
    original = _make_wav()
    once = apply_watermark(original)
    twice = apply_watermark(once)

    assert twice == once
    assert is_watermarked(twice) is True
    assert _read_frames(twice) == _TEST_PCM


def test_custom_marker_round_trips() -> None:
    """カスタムマーカーが往復し、既定マーカーとは区別される。"""
    original = _make_wav()
    custom = apply_watermark(original, marker="X-123")

    assert read_watermark(custom) == "X-123"
    assert is_watermarked(custom, marker="X-123") is True
    assert is_watermarked(custom, marker=_DEFAULT_MARKER) is False


def test_apply_watermark_on_garbage_returns_input() -> None:
    """非 WAV バイト列はそのまま返す（合成音配信を止めない）。"""
    garbage = b"notawav"
    assert apply_watermark(garbage) == garbage


def test_is_watermarked_and_read_on_garbage_are_safe() -> None:
    """異常入力でも例外を投げず False / None を返す。"""
    for bad in (b"notawav", b"", b"RIFF\x00\x00", b"RIFF----XXXX"):
        assert is_watermarked(bad) is False
        assert read_watermark(bad) is None


def test_riff_size_field_updated_after_insertion() -> None:
    """挿入後の RIFF サイズフィールドが全体長 - 8 と一致する。"""
    watermarked = apply_watermark(_make_wav())
    riff_size = struct.unpack_from("<I", watermarked, _RIFF_SIZE_FIELD_OFFSET)[0]
    assert riff_size == len(watermarked) - 8
