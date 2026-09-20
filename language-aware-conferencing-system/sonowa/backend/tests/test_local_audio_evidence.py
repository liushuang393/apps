"""実モデル検証で空音声を成功扱いしないための証拠検証テスト。"""

import importlib.util
import wave
from pathlib import Path
from types import ModuleType

import numpy as np
import pytest


def _verifier() -> ModuleType:
    """プロジェクトの検証スクリプトを実行せずロードする。"""
    path = Path(__file__).resolve().parents[2] / "scripts/verify_local_pipeline.py"
    spec = importlib.util.spec_from_file_location("local_verifier", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("frames", [0, 16000])
def test_empty_and_silent_audio_are_rejected(tmp_path: Path, frames: int) -> None:
    """ヘッダのみと無音の WAV は正常系の証拠として認めない。"""
    path = tmp_path / "silent.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(bytes(frames * 2))
    with pytest.raises(ValueError, match="空・無音・異常長"):
        _verifier().inspect_audio(path)


def test_audio_evidence_contains_measurements_and_hash(tmp_path: Path) -> None:
    """波形の実測値と内容ハッシュを証拠へ保存する。"""
    path = tmp_path / "signal.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(np.full(16000, 4000, dtype=np.int16).tobytes())
    evidence = _verifier().inspect_audio(path)
    assert evidence["duration_s"] == 1
    assert evidence["rms"] > 0
    assert len(evidence["sha256"]) == 64


def test_live_stream_waits_for_signal_instead_of_silent_frames() -> None:
    """WebRTC の無音フレーム到着だけでは音声受信成功と判定しない。"""
    verifier = _verifier()
    assert not verifier.has_voice(b"")
    assert not verifier.has_voice(bytes(32000))
    assert not verifier.has_voice(bytes(32001))
    assert verifier.has_voice(np.full(16000, 4000, dtype=np.int16).tobytes())


def test_frame_timing_detects_voice_without_a_half_second_buffer() -> None:
    """到着時刻の計測では20msフレームを観測でき、無音・空は拒否する。"""
    verifier = _verifier()
    frame = np.full(320, 4000, dtype=np.int16).tobytes()
    assert not verifier.has_voice(frame)
    assert verifier.has_voice(frame, minimum_seconds=0)
    assert not verifier.has_voice(bytes(640), minimum_seconds=0)
    assert not verifier.has_voice(b"", minimum_seconds=0)
