"""
PCM 音声ユーティリティ（Phase 3 C1：LiveKit Agent / OutputSink 用の純関数群）

LiveKit のトラックは 48kHz・多ch の int16 PCM で授受されるが、AI 主線は 16kHz
モノ入力を、S2S 出力は 24kHz 等のモノを返す。ここでは transport / LiveKit に
非依存な純関数として「リサンプル・モノ化・固定長フレーム分割」を提供し、
Agent / Sink から再利用する（I/O・ネットワーク非依存で単体テスト可能）。

入出力はいずれも little-endian int16 のバイト列（モノ前提。多ch は to_mono16 で
事前にモノ化する）。空入力は空バイト列を返す（呼び出し側の分岐を減らす）。
"""

import struct

import numpy as np

# int16 PCM の値域（クリップ用）。マジックナンバーを避け定数化する。
_INT16_MIN = -32768
_INT16_MAX = 32767

# WAV(RIFF) ヘッダー長と PCM フォーマット定数（マジックナンバー回避）。
_WAV_FMT_CHUNK_SIZE = 16  # PCM の fmt チャンク長
_WAV_FORMAT_PCM = 1  # 非圧縮 PCM
_BITS_PER_SAMPLE = 16  # int16 固定
_WAV_HEADER_OVERHEAD = 36  # data チャンク前までの RIFF 残量（file_size = 36 + data）


def wrap_wav16(pcm: bytes, sample_rate: int, num_channels: int = 1) -> bytes:
    """int16 PCM に WAV(RIFF) ヘッダーを付与する（AI 主線は WAV 入力を要求）。

    Args:
        pcm: little-endian int16 の PCM バイト列（モノ前提）。
        sample_rate: サンプルレート（Hz）。
        num_channels: チャンネル数（既定 1）。
    Returns:
        44 バイトの RIFF ヘッダーを前置した WAV バイト列。
    """
    byte_rate = sample_rate * num_channels * _BITS_PER_SAMPLE // 8
    block_align = num_channels * _BITS_PER_SAMPLE // 8
    data_size = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        _WAV_HEADER_OVERHEAD + data_size,
        b"WAVE",
        b"fmt ",
        _WAV_FMT_CHUNK_SIZE,
        _WAV_FORMAT_PCM,
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        _BITS_PER_SAMPLE,
        b"data",
        data_size,
    )
    return header + pcm


def to_mono16(data: bytes, num_channels: int) -> bytes:
    """インターリーブ int16 PCM をモノへ畳み込む（全 ch 平均）。

    Args:
        data: little-endian int16 のインターリーブ PCM。
        num_channels: チャンネル数（1 ならそのまま返す）。
    Returns:
        モノ化した int16 PCM バイト列。
    """
    if num_channels <= 1 or not data:
        return data
    arr = np.frombuffer(data, dtype=np.int16)
    usable = (len(arr) // num_channels) * num_channels
    if usable == 0:
        return b""
    frames = arr[:usable].reshape(-1, num_channels).astype(np.int32)
    mono = frames.mean(axis=1)
    return np.clip(mono, _INT16_MIN, _INT16_MAX).astype(np.int16).tobytes()


def resample16(data: bytes, src_rate: int, dst_rate: int) -> bytes:
    """モノ int16 PCM を線形補間でリサンプルする（scipy 非依存）。

    Args:
        data: モノ int16 PCM バイト列。
        src_rate: 入力サンプルレート（Hz）。
        dst_rate: 出力サンプルレート（Hz）。
    Returns:
        dst_rate にリサンプルした int16 PCM バイト列。
    """
    if src_rate <= 0 or dst_rate <= 0:
        raise ValueError("sample rate は正の整数で指定してください")
    if src_rate == dst_rate or not data:
        return data
    src = np.frombuffer(data, dtype=np.int16).astype(np.float32)
    n_src = len(src)
    if n_src == 0:
        return b""
    n_dst = max(1, int(round(n_src * dst_rate / src_rate)))
    # 入力標本位置（0..n_src-1）へ出力標本を等間隔に写像して補間する。
    x_dst = np.linspace(0.0, n_src - 1, num=n_dst, endpoint=True)
    xp = np.arange(n_src, dtype=np.float32)
    resampled = np.interp(x_dst, xp, src)
    return np.clip(resampled, _INT16_MIN, _INT16_MAX).astype(np.int16).tobytes()


def chunk16(data: bytes, samples_per_frame: int) -> tuple[list[bytes], bytes]:
    """モノ int16 PCM を固定標本数フレームへ分割する（端数は剰余として返す）。

    LiveKit の AudioSource.capture_frame は固定 samples_per_channel を要求するため、
    ストリーム入力をバッファしつつ完全フレームのみ送出する用途に使う。

    Args:
        data: モノ int16 PCM バイト列。
        samples_per_frame: 1 フレームの標本数（>0）。
    Returns:
        (完全フレームのバイト列リスト, 端数バイト列)。
    """
    if samples_per_frame <= 0:
        raise ValueError("samples_per_frame は正の整数で指定してください")
    bytes_per_frame = samples_per_frame * 2  # int16 = 2 bytes/標本
    n_full = len(data) // bytes_per_frame
    frames = [
        data[i * bytes_per_frame : (i + 1) * bytes_per_frame] for i in range(n_full)
    ]
    remainder = data[n_full * bytes_per_frame :]
    return frames, remainder


# WAV ヘッダ内サンプルレートのオフセット（RIFF 標準 44 バイトヘッダ）。
_WAV_RATE_OFFSET = 24
_WAV_HEADER_LEN = 44


def parse_wav16(data: bytes, fallback_rate: int = 24000) -> tuple[bytes, int]:
    """RIFF/WAVE(int16 PCM) から (PCM バイト列, サンプルレート) を取り出す。

    wrap_wav16 / OpenAI TTS(wav) / _pcm16_to_wav の出力（標準 44 バイトヘッダ）を
    想定する。ヘッダが無ければ生 PCM とみなし fallback_rate を返す。
    # ponytail: 追加チャンク付き WAV は非対応。外部入力を受けるようになったら
    # チャンク走査に拡張する。
    """
    if len(data) < _WAV_HEADER_LEN or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return data, fallback_rate
    sample_rate = struct.unpack_from("<I", data, _WAV_RATE_OFFSET)[0]
    return data[_WAV_HEADER_LEN:], sample_rate
