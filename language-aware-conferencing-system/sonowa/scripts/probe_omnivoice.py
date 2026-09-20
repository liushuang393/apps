#!/usr/bin/env python3
"""OmniVoiceの4言語音声とGemmaとの同時常駐を隔離環境で検証する。

追加ASRの自動ロードを禁止し、既知文の発音をGemmaで独立観測する。
音声モデルの非商用条件を記録し、製品プロバイダーは変更しない。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path

import torch
from omnivoice import OmniVoice
from verify_local_pipeline import TEXTS, inspect_audio

from app.ai_pipeline.providers.local_multimodal import LocalMultimodalStage
from app.ai_pipeline.providers.local_tts import _to_wav_bytes

REVISION = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
MODEL_PATH = Path("/models/hf/hub/models--k2-fsa--OmniVoice/snapshots") / REVISION
SAMPLE_RATE = 24000


async def run(output: Path, natural: Path, pipeline: bool) -> int:
    """実モデル2つを同時に保持し、音声と各段階の観測結果を保存する。"""
    output.mkdir(parents=True, exist_ok=True)
    path = output / "seamless.json"
    report = {
        "tts_model": "k2-fsa/OmniVoice",
        "revision": REVISION,
        "license": "CC-BY-NC; evaluation only",
        "asr_mt_model": "google/gemma-4-E2B-it",
        "execution_complete": False,
        "quality_verdict": "unreviewed",
        "cases": [],
        "pipeline_cases": [],
        "pipeline_requested": pipeline,
    }
    try:
        torch.cuda.reset_peak_memory_stats()
        asr = LocalMultimodalStage()
        started = time.monotonic()
        natural_text = await asr.transcribe_audio(
            (natural / "input-vi.wav").read_bytes(), "vi"
        )
        assert natural_text, "Gemma初回ロード・人間音声認識失敗"
        report["natural_vi_asr"] = natural_text
        report["gemma_load_and_asr_s"] = time.monotonic() - started
        started = time.monotonic()
        model = OmniVoice.from_pretrained(
            str(MODEL_PATH),
            local_files_only=True,
            device_map="cuda:0",
            dtype=torch.float16,
            load_asr=False,
        )
        report["tts_load_s"] = time.monotonic() - started
        assert model._asr_pipe is None, "補助ASRがロードされた"
        for language, text in TEXTS.items():
            started = time.monotonic()
            with torch.inference_mode():
                waveform = model.generate(text=text, language=language)[0]
            tts_elapsed = time.monotonic() - started
            wav = output / f"input-{language}.wav"
            wav.write_bytes(_to_wav_bytes(waveform, SAMPLE_RATE))
            started = time.monotonic()
            observed = await asr.transcribe_audio(wav.read_bytes(), language)
            assert observed, "生成音声のGemma認識結果が空"
            assert model._asr_pipe is None, "補助ASRが生成中にロードされた"
            report["cases"].append(
                {
                    "source": language,
                    "target": language,
                    "translation": text,
                    "observed": observed,
                    "audio": inspect_audio(wav),
                    "tts_s": tts_elapsed,
                    "asr_s": time.monotonic() - started,
                }
            )
            path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        report["execution_complete"] = len(report["cases"]) == len(TEXTS)
        if pipeline:
            report["execution_complete"] = False
            for source in TEXTS:
                for target in TEXTS:
                    if source == target:
                        continue
                    started = time.monotonic()
                    original = await asr.transcribe_audio(
                        (output / f"input-{source}.wav").read_bytes(), source
                    )
                    assert original, "連結ASRの空結果"
                    translated = await asr.translate_text(original, source, target)
                    assert translated, "連結MTの空結果"
                    with torch.inference_mode():
                        waveform = model.generate(text=translated, language=target)[0]
                    elapsed = time.monotonic() - started
                    wav = output / f"translated-{source}-{target}.wav"
                    wav.write_bytes(_to_wav_bytes(waveform, SAMPLE_RATE))
                    observed = await asr.transcribe_audio(wav.read_bytes(), target)
                    assert observed, "連結出力音声の空認識"
                    report["pipeline_cases"].append(
                        {
                            "source": source,
                            "target": target,
                            "original": original,
                            "translation": translated,
                            "observed": observed,
                            "audio": inspect_audio(wav),
                            "elapsed_s": elapsed,
                        }
                    )
                    path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
            report["execution_complete"] = len(report["pipeline_cases"]) == 12
    except Exception as exc:
        report["execution_complete"] = False
        report["error"] = str(exc)
    report["torch_peak_allocated_mb"] = torch.cuda.max_memory_allocated() / 1024**2
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["execution_complete"] else 1


def main() -> int:
    """事前取得後にネットワークを遮断して実行するCLI。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--natural-dir", type=Path, required=True)
    parser.add_argument("--pipeline", action="store_true")
    args = parser.parse_args()
    return asyncio.run(run(args.output_dir, args.natural_dir, args.pipeline))


if __name__ == "__main__":
    raise SystemExit(main())
