#!/usr/bin/env python3
"""非商用ライセンスの SeamlessM4T を隔離環境で比較評価する。

製品のプロバイダー設定は変更しない。既存の失敗音声も含めて同じ素材を使う。
1モデルで ASR、訳文、翻訳音声を出力できるかを実測し、品質判定は別途残す。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import torch
from transformers import (
    AutoProcessor,
    AutoTokenizer,
    SeamlessM4TModel,
    SeamlessM4Tv2Model,
)
from verify_local_pipeline import TEXTS, inspect_audio

from app.ai_pipeline.providers.local_asr import FasterWhisperASRStage, _decode_wav
from app.ai_pipeline.providers.local_mt import LocalMTStage, _Engine
from app.ai_pipeline.providers.local_tts import _to_wav_bytes

MODEL = "facebook/hf-seamless-m4t-medium"
REVISION = "ecf60d4df63baaac3f82ae6a7ad7adcb19dcb26c"
V2_MODEL = "facebook/seamless-m4t-v2-large"
V2_REVISION = "5f8cc790b19fc3f67a61c105133b20b34e3dcb76"
LANGUAGES = {"ja": "jpn", "en": "eng", "zh": "cmn", "vi": "vie"}
SAMPLE_RATE = 16000
FRAME_SAMPLES = 320
MIN_PAUSE_FRAMES = 15
SILENCE_RMS = 0.003


def audio_segments(audio: np.ndarray) -> list[tuple[int, int]]:
    """300ms以上の無音中央で分割する。入力サンプルは省略しない。"""
    boundaries = [0]
    silence_start = None
    for offset in range(0, len(audio) + FRAME_SAMPLES, FRAME_SAMPLES):
        chunk = audio[offset : offset + FRAME_SAMPLES]
        silent = bool(len(chunk) and np.sqrt(np.mean(chunk**2)) < SILENCE_RMS)
        if silent and silence_start is None:
            silence_start = offset
        elif not silent and silence_start is not None:
            if (
                offset - silence_start >= MIN_PAUSE_FRAMES * FRAME_SAMPLES
                and silence_start > 0
                and offset < len(audio)
            ):
                boundaries.append((silence_start + offset) // 2)
            silence_start = None
    boundaries.append(len(audio))
    return list(zip(boundaries[:-1], boundaries[1:], strict=True))


def inputs(
    directory: Path, split_pauses: bool
) -> Iterator[tuple[str, str, np.ndarray, int, int, int, int]]:
    """原音声を保存したまま、任意の無音分割区間と位置を列挙する。"""
    for source, code in LANGUAGES.items():
        audio = _decode_wav((directory / f"input-{source}.wav").read_bytes())
        spans = audio_segments(audio) if split_pauses else [(0, len(audio))]
        assert sum(end - start for start, end in spans) == len(audio)
        for index, (start, end) in enumerate(spans):
            yield source, code, audio[start:end], index, len(spans), start, end


def main() -> int:
    """固定モデル・既知音声をネットワーク遮断下で評価し、逐次 JSON 保存する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--v2", action="store_true")
    parser.add_argument("--via-text", action="store_true")
    parser.add_argument("--madlad", action="store_true")
    parser.add_argument("--mt-model-dir", default="/models/madlad400-3b-mt-int8")
    parser.add_argument("--split-pauses", action="store_true")
    parser.add_argument("--source", choices=tuple(LANGUAGES))
    parser.add_argument("--asr-beams", type=int, default=1)
    parser.add_argument("--whisper-asr", action="store_true")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    if args.whisper_asr and (args.madlad or not args.via_text):
        parser.error("Whisper比較は --via-text と併用し、MADLADは追加しない")
    references = TEXTS
    if args.manifest:
        references = {
            row["language"]: row["text"]
            for row in json.loads(args.manifest.read_text())["cases"]
        }
    model_id = V2_MODEL if args.v2 else MODEL
    revision = V2_REVISION if args.v2 else REVISION
    model_class = SeamlessM4Tv2Model if args.v2 else SeamlessM4TModel
    args.output_dir.mkdir(parents=True, exist_ok=True)
    path = args.output_dir / "seamless.json"
    report = {
        "model": model_id,
        "revision": revision,
        "license": "cc-by-nc-4.0; evaluation only",
        "execution_complete": False,
        "quality_verdict": "unreviewed",
        "route": "asr-text-to-speech" if args.via_text else "direct-speech",
        "cases": [],
        "split_pauses": args.split_pauses,
        "source_filter": args.source,
        "asr_beams": args.asr_beams,
        "asr_model": "faster-whisper-medium" if args.whisper_asr else model_id,
    }
    if args.madlad:
        report["route"] = "seamless-asr-madlad-mt-seamless-tts"
    logging.basicConfig(level=logging.INFO)
    try:
        torch.cuda.reset_peak_memory_stats()
        started = time.monotonic()
        processor = AutoProcessor.from_pretrained(
            model_id, revision=revision, local_files_only=True
        )
        model = model_class.from_pretrained(
            model_id,
            revision=revision,
            local_files_only=True,
            dtype=torch.float16,
            device_map={"": 0},
        ).eval()
        report["load_s"] = time.monotonic() - started
        whisper_stage = FasterWhisperASRStage() if args.whisper_asr else None
        whisper_model = whisper_stage._load_model() if whisper_stage else None
        mt_engine = None
        if args.madlad:
            import ctranslate2  # noqa: PLC0415

            started = time.monotonic()
            mt_engine = _Engine(
                translator=ctranslate2.Translator(
                    args.mt_model_dir,
                    device="cuda",
                    compute_type="int8_float16",
                ),
                tokenizer=AutoTokenizer.from_pretrained(
                    "google/madlad400-3b-mt", local_files_only=True
                ),
            )
            report["mt_load_s"] = time.monotonic() - started
            report["mt_model"] = "google/madlad400-3b-mt; CT2 int8_float16"
            report["mt_model_dir"] = args.mt_model_dir
        expected_cases = 0
        for source, source_code, audio, index, count, start, end in inputs(
            args.input_dir, args.split_pauses
        ):
            if args.source and source != args.source:
                continue
            expected_cases += len(LANGUAGES) - 1
            speech_inputs = processor(
                audio=audio, sampling_rate=SAMPLE_RATE, return_tensors="pt"
            ).to("cuda", dtype=torch.float16)
            started = time.monotonic()
            if whisper_stage is not None:
                transcript, _ = whisper_stage._transcribe_sync(
                    whisper_model, audio, source
                )
            else:
                with torch.inference_mode():
                    tokens = model.generate(
                        **speech_inputs,
                        tgt_lang=source_code,
                        generate_speech=False,
                        text_num_beams=args.asr_beams,
                    )
                sequences = (
                    tokens if isinstance(tokens, torch.Tensor) else tokens.sequences
                )
                transcript = processor.batch_decode(
                    sequences, skip_special_tokens=True
                )[0]
            asr_elapsed = time.monotonic() - started
            if not transcript:
                raise RuntimeError("空の認識結果")
            translation_inputs = (
                processor(
                    text=transcript, src_lang=source_code, return_tensors="pt"
                ).to("cuda")
                if args.via_text
                else speech_inputs
            )
            for target, target_code in LANGUAGES.items():
                if source == target:
                    continue
                started = time.monotonic()
                mt_text = None
                if mt_engine is not None:
                    mt_text = LocalMTStage._run_translate(mt_engine, transcript, target)
                    if not mt_text:
                        raise RuntimeError("空のMADLAD訳文")
                    translation_inputs = processor(
                        text=mt_text, src_lang=target_code, return_tensors="pt"
                    ).to("cuda")
                with torch.inference_mode():
                    generated = model.generate(
                        **translation_inputs,
                        tgt_lang=target_code,
                        return_intermediate_token_ids=True,
                    )
                translation = processor.decode(
                    generated.sequences[0].tolist(), skip_special_tokens=True
                )
                if not translation:
                    raise RuntimeError("空の訳文")
                waveform = generated.waveform[0].float().cpu().numpy()
                suffix = f"-{index}" if args.split_pauses else ""
                wav = args.output_dir / f"translated-{source}-{target}{suffix}.wav"
                wav.write_bytes(_to_wav_bytes(waveform, SAMPLE_RATE))
                report["cases"].append(
                    {
                        "source": source,
                        "target": target,
                        "expected_source": references[source],
                        "input_sha256": hashlib.sha256(
                            (args.input_dir / f"input-{source}.wav").read_bytes()
                        ).hexdigest(),
                        "segment_index": index,
                        "segment_count": count,
                        "input_start_s": start / SAMPLE_RATE,
                        "input_end_s": end / SAMPLE_RATE,
                        "transcript": transcript,
                        "translation": translation,
                        "mt_translation": mt_text,
                        "asr_elapsed_s": asr_elapsed,
                        "audio": inspect_audio(wav),
                        "elapsed_s": time.monotonic() - started,
                    }
                )
                path.write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
        report["execution_complete"] = len(report["cases"]) == expected_cases
    except Exception as exc:
        logging.exception("1モデル比較の失敗")
        report["error"] = str(exc)
    report["torch_peak_allocated_mb"] = torch.cuda.max_memory_allocated() / 1024**2
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if report["execution_complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
