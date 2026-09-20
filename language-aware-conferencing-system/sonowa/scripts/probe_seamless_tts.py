#!/usr/bin/env python3
"""保存済み訳文でSeamlessの数値発音とテキスト固定の効果を比較する。

数値置換は既知素材の10だけを対象とする診断であり、製品の汎用正規化ではない。
入力レポートのハッシュ、元訳文、合成用テキストを別々に保存する。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import unicodedata
from pathlib import Path

import torch
from probe_seamless import LANGUAGES, SAMPLE_RATE, V2_MODEL, V2_REVISION
from transformers import AutoProcessor, SeamlessM4Tv2Model
from verify_local_pipeline import inspect_audio

from app.ai_pipeline.providers.local_tts import _to_wav_bytes

TEN_WORDS = {"ja": "十", "zh": "十", "en": "ten", "vi": "mười"}


def main() -> int:
    """モデルを固定して保存済みの全区間を再合成する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--spell-numbers", action="store_true")
    parser.add_argument("--force-text", action="store_true")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    path = args.output_dir / "seamless.json"
    source = json.loads(args.input.read_text())
    report = {
        "model": V2_MODEL,
        "revision": V2_REVISION,
        "input_sha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
        "force_text": args.force_text,
        "spell_fixture_numbers": args.spell_numbers,
        "execution_complete": False,
        "quality_verdict": "unreviewed",
        "cases": [],
    }
    try:
        assert source["execution_complete"] and source["cases"]
        processor = AutoProcessor.from_pretrained(
            V2_MODEL, revision=V2_REVISION, local_files_only=True
        )
        model = SeamlessM4Tv2Model.from_pretrained(
            V2_MODEL,
            revision=V2_REVISION,
            local_files_only=True,
            dtype=torch.float16,
            device_map={"": 0},
        ).eval()
        for case in source["cases"]:
            started = time.monotonic()
            language = case["target"]
            original_text = case.get("mt_translation") or case["translation"]
            text = unicodedata.normalize("NFKC", original_text)
            if args.spell_numbers:
                text = re.sub(r"(?<!\d)10(?!\d)", TEN_WORDS[language], text)
                if language == "zh":
                    text = text.replace("十时", "十点")
            inputs = processor(
                text=text, src_lang=LANGUAGES[language], return_tensors="pt"
            ).to("cuda")
            expected = processor.tokenizer.encode(text, add_special_tokens=False)
            kwargs = {}
            if args.force_text:
                eos = model.generation_config.eos_token_id

                def allowed_tokens(
                    _batch_id: int,
                    ids: torch.Tensor,
                    expected: list[int] = expected,
                    eos: int = eos,
                ) -> list[int]:
                    """開始・言語トークンの後を指定テキストに固定する。"""
                    position = len(ids) - 2
                    assert position >= 0
                    return [expected[position]] if position < len(expected) else [eos]

                kwargs = {
                    "text_prefix_allowed_tokens_fn": allowed_tokens,
                    "text_max_new_tokens": len(expected) + 1,
                }
            with torch.inference_mode():
                generated = model.generate(
                    **inputs,
                    tgt_lang=LANGUAGES[language],
                    return_intermediate_token_ids=True,
                    **kwargs,
                )
            actual = generated.sequences[0].tolist()
            if args.force_text:
                assert actual[2:-1] == expected, "合成テキストの固定に失敗"
            waveform = generated.waveform[0].float().cpu().numpy()
            wav = args.output_dir / case["audio"]["file"]
            wav.write_bytes(_to_wav_bytes(waveform, SAMPLE_RATE))
            report["cases"].append(
                {
                    "source": case["source"],
                    "target": language,
                    "segment_index": case["segment_index"],
                    "original_translation": original_text,
                    "tts_input": text,
                    "translation": processor.decode(actual, skip_special_tokens=True),
                    "audio": inspect_audio(wav),
                    "elapsed_s": time.monotonic() - started,
                }
            )
            path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        report["execution_complete"] = len(report["cases"]) == len(source["cases"])
    except Exception as exc:
        report["error"] = str(exc)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["execution_complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
