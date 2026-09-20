"""独立音声観測へ未完了の実機レポートを渡さない契約を検証する。"""

import hashlib
import importlib.util
import json
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest


@pytest.mark.parametrize(
    ("report", "expected"),
    [
        ({"stage": "pipeline", "passed": True, "cases": [{"status": "passed"}]}, True),
        ({"stage": "pipeline", "passed": True, "cases": [{"status": "failed"}]}, False),
        ({"stage": "pipeline", "passed": True, "cases": []}, False),
        (
            {"stage": "pipeline", "passed": False, "cases": [{"status": "passed"}]},
            False,
        ),
        ({"stage": "tts", "passed": True, "cases": [{"status": "passed"}]}, False),
        ({"execution_complete": True, "cases": [{"translation": "hello"}]}, True),
    ],
)
def test_observer_requires_completed_source(
    report: dict[str, object], expected: bool
) -> None:
    """空や失敗した出力を独立観測の正常入力として認めない。"""
    path = Path(__file__).resolve().parents[2] / "scripts/verify_candidate_audio.py"
    spec = importlib.util.spec_from_file_location("candidate_observer", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.source_is_complete(report, "cases") is expected


@pytest.mark.asyncio
@pytest.mark.parametrize("observer", ["whisper", "gemma"])
async def test_selected_observer_receives_no_reference_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, observer: str
) -> None:
    """指定したASRだけを使い、正解文を認識プロンプトへ漏らさない。"""
    path = Path(__file__).resolve().parents[2] / "scripts/verify_candidate_audio.py"
    spec = importlib.util.spec_from_file_location("candidate_observer", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    audio = b"test-audio"
    (tmp_path / "sample.wav").write_bytes(audio)
    source = tmp_path / "source.json"
    source.write_text(
        json.dumps(
            {
                "execution_complete": True,
                "cases": [
                    {
                        "source": "en",
                        "target": "vi",
                        "translation": "secret reference",
                        "audio": {
                            "file": "sample.wav",
                            "sha256": hashlib.sha256(audio).hexdigest(),
                        },
                    }
                ],
            }
        )
    )
    recognizer = Mock(
        transcribe_audio=AsyncMock(return_value="independent observation")
    )
    chosen = Mock(return_value=recognizer)
    other = Mock(side_effect=AssertionError("unselected observer must not load"))
    monkeypatch.setattr(
        module, "FasterWhisperASRStage", chosen if observer == "whisper" else other
    )
    monkeypatch.setattr(
        module, "LocalMultimodalStage", chosen if observer == "gemma" else other
    )
    output = tmp_path / "observation.json"
    assert await module.verify(source, output, "cases", observer=observer) == 0
    recognizer.transcribe_audio.assert_awaited_once_with(audio, "vi")
    observed = json.loads(output.read_text())
    assert observed["execution_complete"] is True
    assert observed["quality_verdict"] == "unreviewed"
    assert observed["observer"].startswith(observer)
    assert observed["cases"][0]["observed"] == "independent observation"
