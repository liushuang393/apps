"""モデル準備の省メモリ変換と不完全成果物の検出を検証する。"""

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


def test_conversion_uses_half_precision_loading(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """INT8 出力の準備で FP32 全重みを常駐させない。"""
    script = _script()
    converter = Mock()
    factory = Mock(return_value=converter)
    module = ModuleType("ctranslate2.converters")
    module.TransformersConverter = factory
    monkeypatch.setitem(sys.modules, "ctranslate2.converters", module)
    monkeypatch.setattr("subprocess.run", Mock())
    script.prepare_madlad(tmp_path)
    factory.assert_called_once_with(
        script.MADLAD_SRC, load_as_float16=True, low_cpu_mem_usage=True
    )
    converter.convert.assert_called_once_with(
        str(tmp_path / script.MADLAD_OUT_NAME), quantization="int8", force=True
    )


def test_partial_model_is_not_accepted_as_prepared(tmp_path: Path) -> None:
    """model.bin だけが残った変換中断を準備完了と誤認しない。"""
    script = _script()
    model = tmp_path / script.MADLAD_OUT_NAME
    model.mkdir()
    (model / "model.bin").write_bytes(b"partial")
    with pytest.raises(RuntimeError, match="不完全"):
        script.prepare_madlad(tmp_path)


def test_speech_preparation_populates_persistent_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """ASR/TTS と MT tokenizer を初回のオフライン推論前に取得する。"""
    script = _script()
    download = Mock(return_value="cached")
    hub = ModuleType("huggingface_hub")
    hub.snapshot_download = download
    tokenizer = Mock()
    transformers = ModuleType("transformers")
    transformers.AutoTokenizer = tokenizer
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setitem(sys.modules, "transformers", transformers)
    script.prepare_speech(tmp_path)
    assert [c.args[0] for c in download.call_args_list] == [
        script.ASR_HINT,
        script.TTS_HINT,
    ]
    assert all(
        c.kwargs["cache_dir"] == str(tmp_path / "hub") for c in download.call_args_list
    )
    tokenizer.from_pretrained.assert_called_once_with(
        "jbochi/madlad400-3b-mt", cache_dir=str(tmp_path / "hub")
    )


def test_default_preparation_downloads_only_two_models(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """通常の準備は ASR/MT 共有モデルと TTS だけを取得する。"""
    from app.ai_pipeline.providers.local_multimodal import MODEL_ID, MODEL_REVISION

    script = _script()
    download = Mock(return_value="cached")
    hub = ModuleType("huggingface_hub")
    hub.snapshot_download = download
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setattr(sys, "argv", ["prepare", "--output-dir", str(tmp_path)])
    assert script.main() == 0
    assert [c.args[0] for c in download.call_args_list] == [MODEL_ID, script.TTS_HINT]
    assert download.call_args_list[0].kwargs["revision"] == MODEL_REVISION


def test_omnivoice_preparation_pins_weights_and_keeps_two_models(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """OmniVoice選択時は固定revision一式を取得し、Voxや補助ASRを追加しない。"""
    script = _script()
    hub = ModuleType("huggingface_hub")
    hub.snapshot_download = Mock(return_value="cached")
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setattr(
        sys,
        "argv",
        ["prepare", "--output-dir", str(tmp_path), "--tts-model", "k2-fsa/OmniVoice"],
    )
    assert script.main() == 0
    calls = hub.snapshot_download.call_args_list
    assert [call.args[0] for call in calls] == [script.GEMMA_MODEL, "k2-fsa/OmniVoice"]
    assert calls[1].kwargs["revision"] == "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
