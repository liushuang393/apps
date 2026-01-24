"""
Voice Activity Detection (VAD) モジュール

WebRTCのVADを使用して、音声データに人の声が含まれているかを検出する。
ASR処理前にVADを実行することで、以下のメリットがある：
- 静音/ノイズのみの音声をASRに送信しない（コスト削減）
- ASRの幻覚（hallucination）を防止
- 処理効率の向上
"""

import logging
import struct
from typing import NamedTuple

logger = logging.getLogger(__name__)

# webrtcvadは遅延インポート（インストールされていない環境でもエラーにならない）
_vad = None


class VADResult(NamedTuple):
    """VAD判定結果"""

    has_speech: bool  # 音声が含まれているか
    speech_ratio: float  # 音声フレームの割合（0.0〜1.0）
    total_frames: int  # 総フレーム数
    speech_frames: int  # 音声フレーム数


def _get_vad(aggressiveness: int = 2):
    """
    VADインスタンスを取得（シングルトン）

    Args:
        aggressiveness: 検出の厳しさ（0-3、大きいほど厳しい）
            0: 最も緩い（ノイズも音声と判定しやすい）
            3: 最も厳しい（明確な音声のみ検出）
            2: バランス（推奨）
    """
    global _vad
    if _vad is None:
        try:
            import webrtcvad

            _vad = webrtcvad.Vad(aggressiveness)
            logger.info(f"[VAD] 初期化完了 (aggressiveness={aggressiveness})")
        except ImportError:
            logger.warning("[VAD] webrtcvad未インストール、VAD機能は無効")
            return None
    return _vad


def parse_wav_header(wav_bytes: bytes) -> tuple[int, int, int] | None:
    """
    WAVヘッダーを解析してサンプルレート、チャンネル数、ビット深度を取得

    Args:
        wav_bytes: WAV形式のバイナリデータ

    Returns:
        (sample_rate, channels, bits_per_sample) または None（解析失敗時）
    """
    if len(wav_bytes) < 44:
        return None

    try:
        # WAVヘッダー解析
        # RIFFヘッダーチェック
        if wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
            return None

        # fmtチャンクを探す
        pos = 12
        while pos < len(wav_bytes) - 8:
            chunk_id = wav_bytes[pos : pos + 4]
            chunk_size = struct.unpack("<I", wav_bytes[pos + 4 : pos + 8])[0]

            if chunk_id == b"fmt ":
                # フォーマット情報を読み取り
                fmt_data = wav_bytes[pos + 8 : pos + 8 + chunk_size]
                if len(fmt_data) >= 16:
                    channels = struct.unpack("<H", fmt_data[2:4])[0]
                    sample_rate = struct.unpack("<I", fmt_data[4:8])[0]
                    bits_per_sample = struct.unpack("<H", fmt_data[14:16])[0]
                    return (sample_rate, channels, bits_per_sample)

            pos += 8 + chunk_size

        return None
    except Exception as e:
        logger.debug(f"[VAD] WAVヘッダー解析エラー: {e}")
        return None


def extract_pcm_from_wav(wav_bytes: bytes) -> tuple[bytes, int] | None:
    """
    WAVファイルからPCMデータとサンプルレートを抽出

    Args:
        wav_bytes: WAV形式のバイナリデータ

    Returns:
        (pcm_data, sample_rate) または None（抽出失敗時）
    """
    header_info = parse_wav_header(wav_bytes)
    if header_info is None:
        return None

    sample_rate, channels, bits_per_sample = header_info

    # webrtcvadは16bit mono PCMのみサポート
    if bits_per_sample != 16:
        logger.debug(f"[VAD] 非対応ビット深度: {bits_per_sample}")
        return None

    # dataチャンクを探す
    pos = 12
    while pos < len(wav_bytes) - 8:
        chunk_id = wav_bytes[pos : pos + 4]
        chunk_size = struct.unpack("<I", wav_bytes[pos + 4 : pos + 8])[0]

        if chunk_id == b"data":
            pcm_data = wav_bytes[pos + 8 : pos + 8 + chunk_size]

            # ステレオの場合はモノラルに変換（左チャンネルのみ使用）
            if channels == 2:
                mono_data = bytearray()
                for i in range(0, len(pcm_data), 4):
                    if i + 2 <= len(pcm_data):
                        mono_data.extend(pcm_data[i : i + 2])
                pcm_data = bytes(mono_data)

            return (pcm_data, sample_rate)

        pos += 8 + chunk_size

    return None


def detect_voice_activity(
    wav_bytes: bytes,
    min_speech_ratio: float = 0.1,
    aggressiveness: int = 2,
) -> VADResult:
    """
    WAV音声データに人の声が含まれているかを検出

    Args:
        wav_bytes: WAV形式のバイナリデータ
        min_speech_ratio: 音声と判定する最小フレーム割合（0.0〜1.0）
        aggressiveness: VADの厳しさ（0-3）

    Returns:
        VADResult: 判定結果
    """
    # デフォルト結果（音声なし）
    no_speech = VADResult(
        has_speech=False, speech_ratio=0.0, total_frames=0, speech_frames=0
    )

    vad = _get_vad(aggressiveness)
    if vad is None:
        # VADが利用できない場合は音声ありとして扱う（フォールバック）
        return VADResult(
            has_speech=True, speech_ratio=1.0, total_frames=1, speech_frames=1
        )

    # PCMデータを抽出
    pcm_result = extract_pcm_from_wav(wav_bytes)
    if pcm_result is None:
        logger.debug("[VAD] PCM抽出失敗")
        return no_speech

    pcm_data, sample_rate = pcm_result

    # webrtcvadがサポートするサンプルレート: 8000, 16000, 32000, 48000
    if sample_rate not in (8000, 16000, 32000, 48000):
        logger.debug(f"[VAD] 非対応サンプルレート: {sample_rate}")
        # フォールバック: 音声ありとして扱う
        return VADResult(
            has_speech=True, speech_ratio=1.0, total_frames=1, speech_frames=1
        )

    # フレームサイズ（10ms, 20ms, 30ms のいずれか）
    # 20msを使用: sample_rate * 0.02 * 2 (16bit = 2bytes)
    frame_duration_ms = 20
    frame_size = int(sample_rate * frame_duration_ms / 1000 * 2)

    if len(pcm_data) < frame_size:
        logger.debug(f"[VAD] データが短すぎる: {len(pcm_data)} < {frame_size}")
        return no_speech

    # フレームごとにVAD判定
    total_frames = 0
    speech_frames = 0

    for i in range(0, len(pcm_data) - frame_size + 1, frame_size):
        frame = pcm_data[i : i + frame_size]
        total_frames += 1

        try:
            if vad.is_speech(frame, sample_rate):
                speech_frames += 1
        except Exception as e:
            logger.debug(f"[VAD] フレーム判定エラー: {e}")
            continue

    if total_frames == 0:
        return no_speech

    speech_ratio = speech_frames / total_frames
    has_speech = speech_ratio >= min_speech_ratio

    logger.debug(
        f"[VAD] 判定: speech_ratio={speech_ratio:.2f}, "
        f"frames={speech_frames}/{total_frames}, has_speech={has_speech}"
    )

    return VADResult(
        has_speech=has_speech,
        speech_ratio=speech_ratio,
        total_frames=total_frames,
        speech_frames=speech_frames,
    )


def get_audio_energy(wav_bytes: bytes) -> float:
    """
    WAV音声データのRMSエネルギーを計算

    Args:
        wav_bytes: WAV形式のバイナリデータ

    Returns:
        RMSエネルギー値（0〜32768の範囲、16bit PCM）
        エラー時は0.0を返す
    """
    pcm_result = extract_pcm_from_wav(wav_bytes)
    if pcm_result is None:
        return 0.0

    pcm_data, _ = pcm_result

    if len(pcm_data) < 2:
        return 0.0

    # 16bit PCMサンプルをアンパック
    num_samples = len(pcm_data) // 2
    samples = struct.unpack(f"<{num_samples}h", pcm_data[: num_samples * 2])

    # RMS（Root Mean Square）を計算
    sum_squares = sum(s * s for s in samples)
    rms = (sum_squares / num_samples) ** 0.5

    return rms


def has_speech(
    wav_bytes: bytes,
    min_energy: float = 500.0,
    min_speech_ratio: float = 0.1,
    aggressiveness: int = 2,
) -> bool:
    """
    音声データに人の声が含まれているかを判定

    2段階チェック:
    1. 音声エネルギーチェック（高速）- 静音を素早く除外
    2. VADチェック（詳細）- 実際の音声活動を検出

    Args:
        wav_bytes: WAV形式のバイナリデータ
        min_energy: 最小エネルギー閾値（デフォルト500、16bit PCMで約1.5%）
        min_speech_ratio: VADで音声と判定する最小フレーム割合
        aggressiveness: VADの厳しさ（0-3）

    Returns:
        True: 音声が含まれている、False: 音声なし/静音
    """
    # ステップ1: エネルギーチェック（高速、O(n)）
    energy = get_audio_energy(wav_bytes)
    if energy < min_energy:
        logger.debug(f"[VAD] エネルギー不足: {energy:.1f} < {min_energy}")
        return False

    # ステップ2: VADチェック（詳細）
    result = detect_voice_activity(wav_bytes, min_speech_ratio, aggressiveness)

    logger.debug(
        f"[VAD] energy={energy:.1f}, speech_ratio={result.speech_ratio:.2f}, "
        f"has_speech={result.has_speech}"
    )

    return result.has_speech
