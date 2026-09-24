"""モデル準備スクリプトが実行時と同じモデル・固定 revision だけを取得することを検証する。"""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

import pytest


def _script() -> ModuleType:
    """モデルを取得せず準備スクリプトをロードする。"""
    path = Path(__file__).resolve().parents[2] / "scripts/prepare_local_models.py"
    spec = importlib.util.spec_from_file_location("prepare_local", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_preparation_downloads_runtime_models_only(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Gemma を実行時と同じ revision で取得し、他モデルを追加しない。"""
    from app.ai_pipeline.providers import local_multimodal

    script = _script()
    hub = ModuleType("huggingface_hub")
    hub.snapshot_download = Mock(return_value="cached")
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setattr(sys, "argv", ["prepare", "--output-dir", str(tmp_path)])
    assert script.main() == 0
    calls = [
        (c.args[0], c.kwargs["revision"]) for c in hub.snapshot_download.call_args_list
    ]
    assert calls == [(local_multimodal.MODEL_ID, local_multimodal.MODEL_REVISION)]


def test_download_failure_returns_nonzero(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """取得失敗を成功扱いにしない。"""
    script = _script()
    hub = ModuleType("huggingface_hub")
    hub.snapshot_download = Mock(side_effect=OSError("network"))
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setattr(sys, "argv", ["prepare", "--output-dir", str(tmp_path)])
    assert script.main() == 1
