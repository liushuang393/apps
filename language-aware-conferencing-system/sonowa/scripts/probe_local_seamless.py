#!/usr/bin/env python3
"""単一のSeamlessM4Tモデルを固定音声・12翻訳方向で比較する診断CLI。

入力は既存のローカル音声とFLEURS録音。出力は認識文、翻訳文、音声、計測値。
通信遮断コンテナで実行し、完走と意味・発音の品質判定を分離する。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import time
from pathlib import Path

import torch
from app.ai_pipeline.providers.local_asr import _decode_wav
from app.ai_pipeline.providers.local_tts import _to_wav_bytes
from transformers import AutoProcessor, SeamlessM4TModel
from verify_local_pipeline import inspect_audio

logger = logging.getLogger(__name__)
REVISION = "ecf60d4df63baaac3f82ae6a7ad7adcb19dcb26c"
MODEL_PATH = (
    Path("/models/hf/hub/models--facebook--hf-seamless-m4t-medium/snapshots") / REVISION
)
LANGUAGES = {"ja": "jpn", "en": "eng", "zh": "cmn", "vi": "vie"}
INPUT_SAMPLE_RATE = 16000
TEXT_BEAMS = 4
TEXT_MAX_TOKENS = 256
SPEECH_MAX_TOKENS = 1024


def audio_length(lengths: torch.Tensor, available: int) -> int:
    """単一波形の有効長を取り出し、空や範囲外の切り出しを拒否する。"""
    if lengths.numel() != 1:
        raise ValueError("単一入力の音声長が必要です")
    length = int(lengths.reshape(-1)[0].item())
    if not 0 < length <= available:
        raise ValueError("音声長が波形の有効範囲外です")
    return length


def run(root: Path, output: Path, precision: str = "float16") -> int:
    """全入力を同じ設定で処理し、失敗時も完了済みケースと例外を保存する。"""
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "seamless.json"
    cases: list[dict[str, object]] = []
    asr_cases: list[dict[str, object]] = []
    report: dict[str, object] = {
        "model": "facebook/hf-seamless-m4t-medium",
        "revision": REVISION,
        "runtime_models": 1,
        "integrated_vocoder": True,
        "production_integration": False,
        "execution_complete": False,
        "quality_verdict": "unreviewed",
        "text_num_beams": TEXT_BEAMS,
        "text_max_new_tokens": TEXT_MAX_TOKENS,
        "speech_max_new_tokens": SPEECH_MAX_TOKENS,
        "seed": 0,
        "precision": precision,
        "cases": cases,
        "asr_cases": asr_cases,
    }

    def save() -> None:
        """逐次結果をUTF-8の証拠ファイルに保存する。"""
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    try:
        dtype = {"float16": torch.float16, "float32": torch.float32}[precision]
        torch.manual_seed(0)
        torch.cuda.reset_peak_memory_stats()
        started = time.monotonic()
        processor = AutoProcessor.from_pretrained(
            str(MODEL_PATH), local_files_only=True
        )
        model = (
            SeamlessM4TModel.from_pretrained(
                str(MODEL_PATH), dtype=dtype, local_files_only=True
            )
            .to("cuda")
            .eval()
        )
        report["load_s"] = time.monotonic() - started
        report["parameter_count"] = sum(p.numel() for p in model.parameters())
        report["sample_rate"] = model.config.sampling_rate
        report["gpu"] = torch.cuda.get_device_name()
        source_path = root / "omnivoice-generation/pipeline-cases.json"
        source_cases = json.loads(source_path.read_text())
        report["source_report_sha256"] = hashlib.sha256(
            source_path.read_bytes()
        ).hexdigest()
        inputs: dict[str, str] = {}
        for case in source_cases:
            assert inputs.setdefault(case["source"], case["input"]) == case["input"]
        assert set(inputs) == set(LANGUAGES)

        def features(path: Path) -> dict[str, torch.Tensor]:
            """16kHz音声特徴をGPUへ移し、整数マスクの型は維持する。"""
            audio = _decode_wav(path.read_bytes())
            assert audio.size, "入力音声が空です"
            batch = processor(
                audio=audio, sampling_rate=INPUT_SAMPLE_RATE, return_tensors="pt"
            )
            return {
                key: value.to(
                    device="cuda",
                    dtype=dtype if value.is_floating_point() else value.dtype,
                )
                for key, value in batch.items()
            }

        def synthesize(
            batch: dict[str, torch.Tensor], source: str, target: str, name: str
        ) -> None:
            """中間翻訳文と対応する全音声を同じ生成結果から取得する。"""
            torch.cuda.synchronize()
            started = time.monotonic()
            with torch.inference_mode():
                result = model.generate(
                    **batch,
                    tgt_lang=LANGUAGES[target],
                    return_intermediate_token_ids=True,
                    text_num_beams=TEXT_BEAMS,
                    text_max_new_tokens=TEXT_MAX_TOKENS,
                    speech_max_new_tokens=SPEECH_MAX_TOKENS,
                )
            torch.cuda.synchronize()
            elapsed = time.monotonic() - started
            translated = processor.decode(result.sequences[0], skip_special_tokens=True)
            assert translated.strip(), "翻訳文が空です"
            length = audio_length(result.waveform_lengths, result.waveform.shape[-1])
            waveform = result.waveform[0, :length].float().cpu().numpy()
            assert torch.isfinite(result.waveform).all(), "波形に非有限値があります"
            wav = output / f"{name}.wav"
            wav.write_bytes(_to_wav_bytes(waveform, model.config.sampling_rate))
            cases.append(
                {
                    "source": source,
                    "target": target,
                    "kind": name,
                    "translation": translated,
                    "audio": inspect_audio(wav),
                    "elapsed_s": elapsed,
                }
            )
            save()

        natural = json.loads((root / "natural/manifest.json").read_text())
        for language, expected in inputs.items():
            paths = [
                (
                    "controlled",
                    root / f"omnivoice-generation/input-{language}.wav",
                    expected,
                )
            ]
            entry = next(c for c in natural["cases"] if c["language"] == language)
            path = root / "natural" / entry["file"]
            assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"]
            paths.append(("natural", path, entry["text"]))
            for kind, path, reference in paths:
                batch = features(path)
                started = time.monotonic()
                with torch.inference_mode():
                    result = model.generate(
                        **batch,
                        tgt_lang=LANGUAGES[language],
                        generate_speech=False,
                        text_num_beams=TEXT_BEAMS,
                        text_max_new_tokens=TEXT_MAX_TOKENS,
                    )
                observed = processor.decode(
                    result.sequences[0], skip_special_tokens=True
                )
                assert observed.strip(), "認識文が空です"
                asr_cases.append(
                    {
                        "language": language,
                        "kind": kind,
                        "expected": reference,
                        "observed": observed,
                        "elapsed_s": time.monotonic() - started,
                        "input_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    }
                )
                save()
                if kind == "controlled":
                    for target in LANGUAGES:
                        if target != language:
                            synthesize(
                                batch, language, target, f"speech-{language}-{target}"
                            )
        for source, target, text, name in [
            ("en", "vi", inputs["en"], "text-en-vi"),
            ("vi", "vi", "Cuộc họp bắt đầu lúc 10. Không gửi tệp", "text-vi-vi"),
        ]:
            batch = processor(
                text=text, src_lang=LANGUAGES[source], return_tensors="pt"
            ).to("cuda")
            synthesize(batch, source, target, name)
        report["execution_complete"] = len(cases) == 14 and len(asr_cases) == 8
    except Exception as exc:
        logger.exception("SeamlessM4Tの単一モデル比較に失敗")
        report["error"] = str(exc)
    report["torch_peak_allocated_mb"] = torch.cuda.max_memory_allocated() / 1024**2
    save()
    return 0 if report["execution_complete"] else 1


def main() -> int:
    """既存証拠を読むだけの比較CLI。製品設定は変更しない。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--precision", choices=("float16", "float32"), default="float16"
    )
    args = parser.parse_args()
    return run(args.evidence_root, args.output_dir, args.precision)


if __name__ == "__main__":
    raise SystemExit(main())
