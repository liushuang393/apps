#!/usr/bin/env python3
"""失敗文を保持し、固定した複数seed・生成条件でベトナム語発音を比較する。

入力は以前の失敗レポートとFLEURS参照文。出力は全音声・ハッシュ・認識結果。
診断専用であり、完走や文字一致を本番品質の合格に置き換えない。
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import re
import time
from pathlib import Path

import torch
from omnivoice import OmniVoice
from omnivoice.utils.text import normalize_text
from verify_local_pipeline import inspect_audio

from app.ai_pipeline.providers.local_multimodal import LocalMultimodalStage
from app.ai_pipeline.providers.local_tts import MODEL_REVISION, _to_wav_bytes

logger = logging.getLogger(__name__)
SEEDS = (0, 1, 2)
CONDITIONS: dict[str, dict[str, object]] = {
    "baseline": {},
    "numbers": {"normalize_text": True},
    "guidance": {"guidance_scale": 3.0},
    "specified_voice": {"instruct": "female, moderate pitch"},
}
SAMPLE_RATE = 24000
MODEL_PATH = Path("/models/hf/hub/models--k2-fsa--OmniVoice/snapshots") / MODEL_REVISION


async def run(
    root: Path,
    output: Path,
    extended: bool = False,
    positions: bool = False,
    timing: bool = False,
    lexical: bool = False,
) -> int:
    """同じ原文・seedを各条件に与え、全結果を逐次保存して比較可能にする。"""
    source_path = root / "omnivoice-generation/pipeline.json"
    source = json.loads(source_path.read_text())
    failed = next(
        case["translation"]
        for case in source["cases"]
        if case["source"] == "en" and case["target"] == "vi"
    )
    natural = json.loads((root / "natural/manifest.json").read_text())
    reference = next(c for c in natural["cases"] if c["language"] == "vi")
    conditions = CONDITIONS
    if sum((extended, positions, timing, lexical)) > 1:
        raise ValueError("比較する条件群は1種類だけ指定してください")
    if positions:
        conditions = {
            "position0": {"position_temperature": 0.0},
            "position1": {"position_temperature": 1.0},
            "position2": {"position_temperature": 2.0},
        }
    if timing:
        conditions = {
            "speed08": {"speed": 0.8},
            "speed06": {"speed": 0.6},
            "without_silence_trim": {"postprocess_output": False},
            "without_fade": {"fade_duration": 0.0},
        }
    if extended:
        reference_audio = root / "natural" / reference["file"]
        assert (
            hashlib.sha256(reference_audio.read_bytes()).hexdigest()
            == reference["sha256"]
        ), "参照録音のハッシュ不一致"
        voice = {"ref_audio": str(reference_audio), "ref_text": reference["text"]}
        conditions = {
            "steps64": {"num_step": 64},
            "reference": voice,
            "reference_steps64": {**voice, "num_step": 64},
        }
    texts = {
        "unchanged_failure": failed,
        "explicit_hour": "Cuộc họp bắt đầu lúc 10 giờ. Đừng gửi tệp.",
        "without_numbers": "Không gửi tệp. Không xóa tệp.",
        "natural_reference": next(
            c["text"] for c in natural["cases"] if c["language"] == "vi"
        ),
    }
    if lexical:
        conditions = {"baseline": {}, "file_synonym": {"file_synonym": True}}
        texts.update(
            {
                "heldout_count": "Vui lòng gửi hai tệp trước 15 giờ.",
                "heldout_delete": "Đừng xóa tệp báo cáo. Hãy giữ bản gốc.",
                "heldout_save": "Tôi đã lưu tệp vào thư mục dự án.",
                "heldout_absence": "Không có tệp tin nào bị mất.",
            }
        )
    output.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "source_report_sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "model_revision": MODEL_REVISION,
        "seeds": SEEDS,
        "conditions": conditions,
        "reference_audio_sha256": reference["sha256"] if extended else None,
        "execution_complete": False,
        "quality_verdict": "unreviewed",
        "production_integration": False,
        "cases": [],
    }
    cases: list[dict[str, object]] = []
    report["cases"] = cases
    path = output / "fidelity.json"
    try:
        torch.cuda.reset_peak_memory_stats()
        asr = LocalMultimodalStage()
        await asr.prepare()
        model = OmniVoice.from_pretrained(
            str(MODEL_PATH),
            local_files_only=True,
            load_asr=False,
            device_map="cuda:0",
            dtype=torch.float16,
        )
        assert model._asr_pipe is None
        for text_id, text in texts.items():
            for seed in SEEDS:
                for condition, options in conditions.items():
                    generation_options = dict(options)
                    spoken = text
                    if generation_options.pop("file_synonym", False):
                        spoken = re.sub(r"\btệp(?:\s+tin)?\b", "tập tin", spoken)
                    torch.manual_seed(seed)
                    started = time.monotonic()
                    audio = model.generate(
                        text=spoken, language="vi", **generation_options
                    )[0]
                    elapsed = time.monotonic() - started
                    wav = output / f"{text_id}-{seed}-{condition}.wav"
                    wav.write_bytes(_to_wav_bytes(audio, SAMPLE_RATE))
                    observed = await asr.transcribe_audio(wav.read_bytes(), "vi")
                    assert observed and model._asr_pipe is None
                    cases.append(
                        {
                            "source": "vi",
                            "target": "vi",
                            "text_id": text_id,
                            "seed": seed,
                            "condition": condition,
                            "translation": text,
                            "normalized": normalize_text(spoken, "vi")
                            if options.get("normalize_text")
                            else spoken,
                            "observed": observed,
                            "audio": inspect_audio(wav),
                            "tts_s": elapsed,
                        }
                    )
                    path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        report["execution_complete"] = len(cases) == len(texts) * len(SEEDS) * len(
            conditions
        )
    except Exception as exc:
        logger.exception("発音条件の比較に失敗")
        report["error"] = str(exc)
    report["torch_peak_allocated_mb"] = torch.cuda.max_memory_allocated() / 1024**2
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["execution_complete"] else 1


def main() -> int:
    """通信遮断した診断イメージで、指定した証拠ディレクトリを比較する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    comparison = parser.add_mutually_exclusive_group()
    comparison.add_argument("--extended", action="store_true")
    comparison.add_argument("--positions", action="store_true")
    comparison.add_argument("--timing", action="store_true")
    comparison.add_argument("--lexical", action="store_true")
    args = parser.parse_args()
    return asyncio.run(
        run(
            args.evidence_root,
            args.output_dir,
            args.extended,
            args.positions,
            args.timing,
            args.lexical,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
