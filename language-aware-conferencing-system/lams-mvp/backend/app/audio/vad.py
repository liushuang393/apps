"""
VAD アダプタ（改善案 §4/§6：Silero VAD の注入 VAD 化）

SpeechSegmenter は `is_speech(frame: bytes) -> bool` を注入 interface として受け取る
（app/webrtc/segmenter.py）。本モジュールはその互換シグネチャで Silero VAD を包み、
設定 `settings.vad_backend` に応じて energy / silero を選ぶファクトリを提供する。

設計原則:
    - torch / silero 未導入環境でも import・単体テスト可能にする（遅延 import 徹底）。
    - モデル呼び出しが失敗しても発話判定は例外を投げず False（安全側）に倒す。
    - segmenter.py は無改変。build_vad の戻り値を SpeechSegmenter(is_speech=...) に
      渡す想定だが、実結線は本モジュールの責務外（別タスク）。
"""

import logging
from collections.abc import Callable

import numpy as np

from app.config import settings

logger = logging.getLogger(__name__)

# Silero VAD のフレーム長制約（16kHz=512, 8kHz=256 標本）。既定は 16kHz の 512。
_SILERO_WINDOW_SAMPLES = {16000: 512, 8000: 256}
_DEFAULT_WINDOW_SAMPLES = 512
# Silero 窓長は 16k/8k とも 32ms（512/256 標本）。segmenter のフレーム長をこれに
# 合わせると 1 フレーム=1 窓となり、パディングによる確率希釈を避けられる（§P1 修正）。
SILERO_FRAME_MS = 32
# int16 PCM を float32 [-1,1] へ正規化する係数（フルスケール 32768）。
_INT16_FULL_SCALE = 32768.0
# torch.hub から取得する Silero VAD のリポジトリ・モデル名。
_SILERO_REPO = "snakers4/silero-vad"
_SILERO_MODEL = "silero_vad"


class SileroVAD:
    """Silero VAD を SpeechSegmenter 互換の is_speech として提供するアダプタ。"""

    def __init__(
        self,
        sample_rate: int = 16000,
        threshold: float = 0.5,
        model: object | None = None,
    ) -> None:
        """VAD を初期化する。

        Args:
            sample_rate: 入力 PCM のサンプルレート（Hz）。
            threshold: 発話とみなす確率しきい値（0..1）。
            model: 注入モデル（テスト用）。None なら初回判定時に遅延ロードする。
        """
        self._sample_rate = sample_rate
        self._threshold = threshold
        self._model = model
        self._torch: object | None = None
        self._window = _SILERO_WINDOW_SAMPLES.get(sample_rate, _DEFAULT_WINDOW_SAMPLES)
        # 毎フレームのエラーログ氾濫を避けるため、警告は初回のみ出す。
        self._load_failed = False
        self._warned_call = False

    def _load_model(self) -> None:
        """torch / Silero モデルを遅延ロードする（注入 model があれば何もしない）。

        import は本メソッド内のみ（モジュール先頭 import 禁止）。失敗時は _load_failed
        を立て、以降のフレームでは即 False を返す（再試行しない）。
        """
        if self._model is not None or self._load_failed:
            return
        try:
            import torch  # 遅延 import：未導入環境でも本モジュールは import 可能。

            model, _ = torch.hub.load(repo_or_dir=_SILERO_REPO, model=_SILERO_MODEL)
            self._torch = torch
            self._model = model
        except Exception:  # noqa: BLE001 - 取得失敗の原因を問わず安全側に倒す。
            self._load_failed = True
            logger.warning("Silero VAD のロードに失敗しました。発話判定は False を返します", exc_info=True)

    def _to_float32(self, frame: bytes) -> np.ndarray:
        """int16 PCM バイト列を float32 [-1,1] へ変換し、窓長に整える。"""
        arr = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
        arr /= _INT16_FULL_SCALE
        if arr.size < self._window:
            # Silero は固定窓長を要求するため不足分はゼロパディングする。
            arr = np.pad(arr, (0, self._window - arr.size))
        elif arr.size > self._window:
            # 過長フレームは先頭 1 窓のみ評価する（簡潔さ優先）。
            arr = arr[: self._window]
        return arr

    def _probability(self, arr: np.ndarray) -> float:
        """モデルを呼び出して発話確率を取り出す（torch 有無の双方に対応）。"""
        if self._torch is not None:
            model_input: object = self._torch.from_numpy(arr)
        else:
            # 注入モデル（テスト）は numpy 配列をそのまま受け取れる前提。
            model_input = arr
        result = self._model(model_input, self._sample_rate)  # type: ignore[operator]
        # torch テンソル（.item()）でも素の float でも取り出せるようにする。
        return result.item() if hasattr(result, "item") else float(result)

    def is_speech(self, frame: bytes) -> bool:
        """1 フレームの発話有無を判定する（SpeechSegmenter 注入互換）。"""
        if not frame:
            return False
        self._load_model()
        if self._model is None:
            return False
        arr = self._to_float32(frame)
        try:
            prob = self._probability(arr)
        except Exception:  # noqa: BLE001 - 推論失敗時は安全側に False。
            if not self._warned_call:
                self._warned_call = True
                logger.warning("Silero VAD 推論に失敗しました。以降 False を返します", exc_info=True)
            return False
        return prob >= self._threshold


def silero_available() -> bool:
    """Silero VAD が利用可能か（torch を import できるか）を返す。"""
    try:
        import torch  # noqa: F401 - 可用性チェックのみ。

        return True
    except Exception:  # noqa: BLE001 - import 失敗＝未導入とみなす。
        return False


def resolve_backend(backend: str | None = None) -> str:
    """実効 VAD バックエンドを返す（silero 要求でも未導入なら energy）。

    build_vad と呼び出し側（フレーム長選択）で判定を一元化するためのヘルパー。
    """
    chosen = backend or settings.vad_backend
    if chosen == "silero" and silero_available():
        return "silero"
    return "energy"


def build_vad(
    backend: str | None = None, *, sample_rate: int = 16000
) -> Callable[[bytes], bool]:
    """設定に応じた is_speech 関数を返すファクトリ（segmenter へ直接注入可能）。

    Args:
        backend: "energy" / "silero"。None なら settings.vad_backend を使う。
        sample_rate: Silero 利用時の入力サンプルレート（Hz）。
    Returns:
        Callable[[bytes], bool]：SpeechSegmenter(is_speech=...) に渡せる判定関数。
    """
    # energy_is_speech は遅延 import（循環参照回避・segmenter 側の重依存を持ち込まない）。
    from app.webrtc.segmenter import energy_is_speech

    requested = backend or settings.vad_backend
    if resolve_backend(backend) == "silero":
        return SileroVAD(sample_rate=sample_rate).is_speech
    if requested == "silero":
        logger.info("silero 指定ですが torch 未導入のため energy VAD へフォールバックします")
    return energy_is_speech
