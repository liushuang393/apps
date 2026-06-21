"""
発話セグメンタ（Phase 3 C1）：連続 16kHz モノ PCM → 発話単位の区切り。

LiveKit Agent は購読トラックから途切れない PCM ストリームを受け取るが、AI 主線
（ASR / S2S）は「1 発話 = 1 リクエスト」を前提とする。本モジュールは VAD 判定で
発話開始・末尾無音を検出し、完全な発話セグメント（生 int16 PCM）を切り出す
ステートフルなバッファを提供する。WAV 化や AI 投入は呼び出し側（agent）が行う。

設計原則:
    - I/O・ネットワーク非依存（VAD 判定関数を注入可能）→ 単体テスト可能。
    - フレーム単位で逐次処理し、末尾無音が閾値超で 1 セグメントを確定・emit する。
    - 最小発話長未満は破棄（誤検出抑制）、最大長超で強制確定（過大セグメント防止）。
"""

import numpy as np

from app.audio.pcm import chunk16

# 既定の VAD パラメータ（マジックナンバー回避のため定数化）。
_DEFAULT_SAMPLE_RATE = 16000
_DEFAULT_FRAME_MS = 20  # webrtcvad 互換の 20ms フレーム
_DEFAULT_SILENCE_MS = 600  # この無音長で発話末尾とみなす
_DEFAULT_MIN_SPEECH_MS = 300  # これ未満の発話は破棄
_DEFAULT_MAX_SEGMENT_MS = 8000  # この長さで強制確定
# 既定（エネルギー）VAD のしきい値（16bit PCM の RMS、約 1.5%）。
_ENERGY_THRESHOLD = 500.0


def energy_is_speech(frame: bytes) -> bool:
    """フレーム RMS エネルギーで発話有無を判定する既定 VAD（純関数）。"""
    if not frame:
        return False
    arr = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
    if arr.size == 0:
        return False
    rms = float(np.sqrt(np.mean(arr * arr)))
    return rms >= _ENERGY_THRESHOLD


class SpeechSegmenter:
    """16kHz モノ PCM ストリームを発話単位の生 PCM セグメントへ切り出す。"""

    def __init__(
        self,
        *,
        sample_rate: int = _DEFAULT_SAMPLE_RATE,
        frame_ms: int = _DEFAULT_FRAME_MS,
        silence_ms: int = _DEFAULT_SILENCE_MS,
        min_speech_ms: int = _DEFAULT_MIN_SPEECH_MS,
        max_segment_ms: int = _DEFAULT_MAX_SEGMENT_MS,
        is_speech=energy_is_speech,
    ) -> None:
        if sample_rate <= 0 or frame_ms <= 0:
            raise ValueError("sample_rate / frame_ms は正の整数で指定してください")
        self._samples_per_frame = sample_rate * frame_ms // 1000
        if self._samples_per_frame <= 0:
            raise ValueError("frame_ms が sample_rate に対して小さすぎます")
        self._silence_frames = max(1, silence_ms // frame_ms)
        self._min_speech_frames = max(1, min_speech_ms // frame_ms)
        self._max_frames = max(1, max_segment_ms // frame_ms)
        self._is_speech = is_speech
        self._leftover = b""
        self._seg = bytearray()
        self._seg_frames = 0
        self._speech_frames = 0
        self._silence_run = 0
        self._in_speech = False

    def push(self, pcm: bytes) -> list[bytes]:
        """PCM を取り込み、確定した発話セグメント（生 PCM）のリストを返す。"""
        out: list[bytes] = []
        frames, self._leftover = chunk16(self._leftover + pcm, self._samples_per_frame)
        for frame in frames:
            self._consume(frame, out)
        return out

    def _consume(self, frame: bytes, out: list[bytes]) -> None:
        """1 フレームを状態機械へ投入し、確定時に out へ追加する。"""
        if self._is_speech(frame):
            self._in_speech = True
            self._seg += frame
            self._seg_frames += 1
            self._speech_frames += 1
            self._silence_run = 0
            if self._seg_frames >= self._max_frames:
                self._emit(out)
        elif self._in_speech:
            # 発話中の無音はセグメントに含めつつ末尾無音長を計測する。
            self._seg += frame
            self._seg_frames += 1
            self._silence_run += 1
            if self._silence_run >= self._silence_frames:
                self._emit(out)
        # 発話前の無音フレームは破棄（バッファに溜めない）。

    def _emit(self, out: list[bytes]) -> None:
        """現セグメントを確定する（最小発話長を満たす場合のみ emit）。"""
        if self._speech_frames >= self._min_speech_frames:
            out.append(bytes(self._seg))
        self._reset_segment()

    def _reset_segment(self) -> None:
        """セグメント状態を初期化する（leftover は保持）。"""
        self._seg = bytearray()
        self._seg_frames = 0
        self._speech_frames = 0
        self._silence_run = 0
        self._in_speech = False

    def flush(self) -> bytes | None:
        """ストリーム終端で未確定の発話を取り出す（無ければ None）。"""
        seg: bytes | None = None
        if self._in_speech and self._speech_frames >= self._min_speech_frames:
            seg = bytes(self._seg)
        self._reset_segment()
        self._leftover = b""
        return seg
