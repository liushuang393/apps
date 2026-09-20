#!/usr/bin/env python3
"""Gemma の音声認識・翻訳を実 GPU で測定する選定用プローブ。

入力: 既知の input-ja/en/zh/vi.wav、取得済みモデル。
出力: 応答全文・遅延・GPU 使用量。品質は結果を確認するまで未合格。
注意: --network none、HF_HUB_OFFLINE=1 の Docker 内で実行する。
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

import torch
from transformers import (
    AutoProcessor,
    BitsAndBytesConfig,
    Gemma4ForConditionalGeneration,
)

MODEL_ID = "google/gemma-4-E2B-it"
REVISION = "3e22461f65e89153144f8adb70e3b8c2cc9845a7"
LANGUAGES = {"ja": "Japanese", "en": "English", "zh": "Chinese", "vi": "Vietnamese"}
TEXTS = {
    "ja": "会議は10時に始まります。ファイルを送信しないでください。",
    "en": "The meeting starts at 10. Do not send the file.",
    "zh": "会议在10点开始。请不要发送文件。",
    "vi": "Cuộc họp bắt đầu lúc 10 giờ. Đừng gửi tệp.",
}
logger = logging.getLogger(__name__)


def main() -> int:
    """4言語の入力を処理し、未完了・空応答を成功扱いしない証拠を保存する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--stage", choices=("asr", "mt", "ast"), required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--precision", choices=("nf4", "bf16"), default="nf4")
    parser.add_argument("--source", choices=tuple(LANGUAGES))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "model": MODEL_ID,
        "revision": REVISION,
        "quantization": "text NF4 double-quant BF16; audio/vision BF16",
        "stage": args.stage,
        "quality_verdict": "unreviewed",
        "cases": [],
    }
    path = args.output_dir / f"gemma-{args.stage}.json"
    try:
        started = time.monotonic()
        processor = AutoProcessor.from_pretrained(
            MODEL_ID, revision=REVISION, local_files_only=True
        )
        quantization = None
        if args.precision == "nf4":
            quantization = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=torch.bfloat16,
                llm_int8_skip_modules=[
                    "model.audio_tower",
                    "model.vision_tower",
                    "model.embed_audio",
                    "model.embed_vision",
                    "lm_head",
                ],
            )
        else:
            report["quantization"] = "none; BF16 diagnostic"
        model = Gemma4ForConditionalGeneration.from_pretrained(
            MODEL_ID,
            revision=REVISION,
            local_files_only=True,
            device_map={"": 0},
            dtype=torch.bfloat16,
            quantization_config=quantization,
        ).eval()
        report["load_s"] = round(time.monotonic() - started, 3)
        logger.info("モデルロード完了: %.3fs", report["load_s"])
        quantized_audio = [
            name
            for name, module in model.model.audio_tower.named_modules()
            if type(module).__name__ == "Linear4bit"
        ]
        if quantized_audio:
            raise RuntimeError(
                f"音声エンコーダーまで量子化されています: {quantized_audio[:3]}"
            )
        audio_observations: list[dict[str, object]] = []

        def observe_audio(_module: object, _inputs: object, output: object) -> None:
            """音声エンコーダーが実際に呼ばれたかと有限の特徴量を記録する。"""
            hidden = output.last_hidden_state.float()
            audio_observations.append(
                {
                    "shape": list(hidden.shape),
                    "finite": bool(torch.isfinite(hidden).all()),
                    "mean_abs": float(hidden.abs().mean()),
                }
            )

        model.model.audio_tower.register_forward_hook(observe_audio)
        texts = TEXTS
        if args.manifest:
            manifest = json.loads(args.manifest.read_text())
            texts = {case["language"]: case["text"] for case in manifest["cases"]}
            if set(texts) != set(LANGUAGES):
                raise ValueError("自然発話の4言語分の正解が必要です")
            report["fixture_manifest"] = manifest
        for source, text in texts.items():
            if args.source and source != args.source:
                continue
            targets = (
                [source] if args.stage == "asr" else [t for t in TEXTS if t != source]
            )
            for target in targets:
                source_name, target_name = LANGUAGES[source], LANGUAGES[target]
                if args.stage == "asr":
                    prompt = (
                        f"Transcribe the following speech segment in {source_name} "
                        f"into {source_name} text. Only output the transcription, "
                        "with no newlines. Write numbers as digits."
                    )
                elif args.stage == "ast":
                    prompt = (
                        f"Transcribe the following speech segment in {source_name}, "
                        f"then translate it into {target_name}. "
                        f"First output the transcription in {source_name}, then one "
                        f"newline, then '{target_name}: ', then the translation. "
                        "Preserve numbers and negation."
                    )
                else:
                    prompt = (
                        f"Translate the following {source_name} text into {target_name}. "
                        "Only output the translation. Preserve numbers and negation.\n"
                        f"{text}"
                    )
                content = [{"type": "text", "text": prompt}]
                if args.stage != "mt":
                    content.append(
                        {
                            "type": "audio",
                            "audio": str(args.output_dir / f"input-{source}.wav"),
                        }
                    )
                started = time.monotonic()
                audio_observations.clear()
                inputs = processor.apply_chat_template(
                    [{"role": "user", "content": content}],
                    tokenize=True,
                    return_dict=True,
                    return_tensors="pt",
                    add_generation_prompt=True,
                    enable_thinking=False,
                    processor_kwargs={"load_audio_backend": "librosa"},
                ).to(model.device)
                with torch.inference_mode():
                    output = model.generate(
                        **inputs, max_new_tokens=192, do_sample=False
                    )
                answer = processor.decode(
                    output[0][inputs["input_ids"].shape[-1] :], skip_special_tokens=True
                ).strip()
                case = {
                    "source": source,
                    "target": target,
                    "expected_source": text,
                    "output": answer,
                    "elapsed_s": round(time.monotonic() - started, 3),
                    "input_shapes": {k: list(v.shape) for k, v in inputs.items()},
                    "audio_encoder": list(audio_observations),
                }
                report["cases"].append(case)
                logger.info("ケース完了: %s", case)
                path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
                if not answer:
                    raise RuntimeError("モデルが空応答を返しました")
        report["execution_complete"] = True
    except Exception as exc:
        logger.exception("モデル選定プローブ失敗")
        report.update(execution_complete=False, error=str(exc))
    report["torch_peak_allocated_mb"] = torch.cuda.max_memory_allocated() / 1024**2
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if report.get("execution_complete") else 1


if __name__ == "__main__":
    raise SystemExit(main())
