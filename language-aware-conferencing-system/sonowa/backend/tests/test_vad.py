"""
app.audio.vad の単体テスト（torch / silero 未導入環境で緑になること）。

観点:
    - モジュールが遅延 import で問題なく import できる。
    - silero_available() は bool を返す（本環境では False 想定）。
    - build_vad("energy") が energy_is_speech を返し、無音/大振幅で期待どおり判定する。
    - build_vad("silero") は未導入時に energy へフォールバックする。
    - SileroVAD へ fake model を注入すると threshold 境界で bool を返す。
"""

import numpy as np

from app.audio import vad
from app.webrtc.segmenter import energy_is_speech

# テスト用フレーム長（16kHz・20ms 相当＝320 標本。Silero 窓 512 未満をパディング検証）。
_FRAME_SAMPLES = 320


def _silence_frame() -> bytes:
    """無音（全ゼロ）int16 PCM フレーム。"""
    return np.zeros(_FRAME_SAMPLES, dtype=np.int16).tobytes()


def _loud_frame() -> bytes:
    """大振幅 int16 PCM フレーム（energy 判定で発話とみなされる振幅）。"""
    return np.full(_FRAME_SAMPLES, 8000, dtype=np.int16).tobytes()


class _FakeModel:
    """発話確率を固定で返す Silero 互換の擬似モデル（torch 非依存）。"""

    def __init__(self, prob: float) -> None:
        self._prob = prob
        self.calls = 0

    def __call__(self, x: object, sample_rate: int) -> float:  # noqa: ARG002
        self.calls += 1
        return self._prob


def test_module_imports_without_torch() -> None:
    """遅延 import により torch 無しでもモジュール属性が揃う。"""
    assert hasattr(vad, "SileroVAD")
    assert callable(vad.build_vad)
    assert callable(vad.silero_available)


def test_silero_available_returns_bool() -> None:
    """silero_available() は bool を返す（torch import 可否で判定）。"""
    result = vad.silero_available()
    assert isinstance(result, bool)


def test_build_vad_energy_returns_energy_is_speech() -> None:
    """energy 指定は energy_is_speech を返し、無音→False・大振幅→True。"""
    is_speech = vad.build_vad("energy")
    assert is_speech is energy_is_speech
    assert is_speech(_silence_frame()) is False
    assert is_speech(_loud_frame()) is True


def test_build_vad_silero_falls_back_to_energy_when_unavailable() -> None:
    """torch 未導入時は silero 指定でも energy_is_speech へフォールバックする。

    torch が導入済みの環境では SileroVAD.is_speech（energy 以外の callable）が返る。
    どちらの環境でも「callable が返る」ことは共通の契約として検証する。
    """
    is_speech = vad.build_vad("silero")
    assert callable(is_speech)
    if vad.silero_available():
        # 導入済み環境：energy ではなく Silero アダプタが返る。
        assert is_speech is not energy_is_speech
    else:
        # 未導入環境：energy へフォールバックし、無音→False・大振幅→True。
        assert is_speech is energy_is_speech
        assert is_speech(_silence_frame()) is False
        assert is_speech(_loud_frame()) is True


def test_silero_vad_with_injected_model_above_threshold() -> None:
    """注入モデルの確率が threshold 以上なら True を返す。"""
    detector = vad.SileroVAD(threshold=0.5, model=_FakeModel(0.9))
    assert detector.is_speech(_loud_frame()) is True


def test_silero_vad_with_injected_model_below_threshold() -> None:
    """注入モデルの確率が threshold 未満なら False を返す。"""
    detector = vad.SileroVAD(threshold=0.5, model=_FakeModel(0.1))
    assert detector.is_speech(_loud_frame()) is False


def test_silero_vad_threshold_boundary_is_inclusive() -> None:
    """確率がちょうど threshold と等しい場合は True（>= 判定）。"""
    detector = vad.SileroVAD(threshold=0.5, model=_FakeModel(0.5))
    assert detector.is_speech(_loud_frame()) is True


def test_silero_vad_empty_frame_returns_false() -> None:
    """空フレームはモデル呼び出しなしで False。"""
    model = _FakeModel(1.0)
    detector = vad.SileroVAD(model=model)
    assert detector.is_speech(b"") is False
    assert model.calls == 0


def test_silero_vad_pads_short_frame_to_window() -> None:
    """窓長未満のフレームでもモデルが呼ばれ判定できる（パディング動作）。"""
    model = _FakeModel(0.8)
    detector = vad.SileroVAD(threshold=0.5, model=model)
    assert detector.is_speech(_silence_frame()) is True
    assert model.calls == 1


def test_silero_vad_inference_error_returns_false() -> None:
    """モデル呼び出しが例外なら安全側に False を返す。"""

    class _BrokenModel:
        def __call__(self, x: object, sample_rate: int) -> float:  # noqa: ARG002
            raise RuntimeError("推論失敗")

    detector = vad.SileroVAD(model=_BrokenModel())
    assert detector.is_speech(_loud_frame()) is False
