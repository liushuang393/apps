#!/usr/bin/env python3
"""変換前 MADLAD と既存 CT2 成果物の翻訳結果を切り分ける。

既存の実 ASR 結果を入力とし、ネットワーク遮断下で元モデルを評価する。
製品設定や既存モデル成果物は変更しない。
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

MODEL = "google/madlad400-3b-mt"
REVISION = "fa184c675da0b5c9e1c8694fccd4e12e2d422094"


def main() -> int:
    """BF16 元モデルの12方向の訳文・所要時間を記録する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = {"model": MODEL, "revision": REVISION, "complete": False, "cases": []}
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            MODEL, revision=REVISION, local_files_only=True
        )
        model = AutoModelForSeq2SeqLM.from_pretrained(
            MODEL,
            revision=REVISION,
            local_files_only=True,
            dtype=torch.bfloat16,
            device_map={"": 0},
        ).eval()
        for case in json.loads(args.input.read_text())["cases"]:
            started = time.monotonic()
            text = f"<2{case['target']}> {case['transcript']}"
            inputs = tokenizer(text, return_tensors="pt").to("cuda")
            with torch.inference_mode():
                tokens = model.generate(**inputs, max_new_tokens=128)
            translation = tokenizer.decode(tokens[0], skip_special_tokens=True)
            report["cases"].append(
                {
                    "source": case["source"],
                    "target": case["target"],
                    "transcript": case["transcript"],
                    "translation": translation,
                    "elapsed_s": time.monotonic() - started,
                }
            )
        report["complete"] = len(report["cases"]) == 12
    except Exception as exc:
        report["error"] = str(exc)
    report["torch_peak_allocated_mb"] = torch.cuda.max_memory_allocated() / 1024**2
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
