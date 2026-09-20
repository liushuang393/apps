#!/usr/bin/env python3
"""ベトナム語 TTS の発音を既知文・同じ乱数で比較する診断。

自然音声の出典は output/local-pipeline/natural/manifest.json。
音声参照は診断限定。プロダクションの声やモデル設定は変更しない。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path

import torch
from verify_local_pipeline import TEXTS, inspect_audio

from app.ai_pipeline.providers.local_asr import FasterWhisperASRStage
from app.ai_pipeline.providers.local_multimodal import LocalMultimodalStage
from app.ai_pipeline.providers.local_tts import (
    VOXCPM_SAMPLE_RATE,
    LocalTTSStage,
    _to_wav_bytes,
)


async def probe(root: Path) -> None:
    """参照なし・声参照・文脈参照を比較し、別 ASR で内容を観測する。"""
    output = root / "voice-diagnostic"
    output.mkdir(parents=True, exist_ok=True)
    engine = LocalTTSStage()._load_engine()
    reference = str(root / "natural/input-vi.wav")
    text = TEXTS["vi"]
    variants = {
        "baseline": {},
        "reference": {"reference_wav_path": reference},
        "continuation": {
            "prompt_wav_path": reference,
            "prompt_text": "Văn hóa và bộ lạc cổ xưa đã bắt đầu giữ những con vật này để dễ lấy sữa, tóc, thịt, và da.",
        },
    }
    results = []
    try:
        for name, parameters in variants.items():
            torch.manual_seed(0)
            started = time.monotonic()
            waveform = engine.model.generate(text, retry_badcase=False, **parameters)
            path = output / f"{name}.wav"
            path.write_bytes(_to_wav_bytes(waveform, VOXCPM_SAMPLE_RATE))
            results.append(
                {
                    "variant": name,
                    "text": text,
                    "elapsed_s": time.monotonic() - started,
                    "audio": inspect_audio(path),
                }
            )
    finally:
        engine.close()
    asr = LocalMultimodalStage()
    for row in results:
        row["transcript"] = await asr.transcribe_audio(
            (output / row["audio"]["file"]).read_bytes(), "vi"
        )
    # 既存キャッシュの Whisper は診断比較だけに使用し、製品構成には含めない。
    comparator = FasterWhisperASRStage()
    for row in results:
        row["comparison_whisper_transcript"] = await comparator.transcribe_audio(
            (output / row["audio"]["file"]).read_bytes(), "vi"
        )
    (output / "comparison.json").write_text(
        json.dumps(
            {"quality_verdict": "unreviewed", "cases": results},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def main() -> None:
    """証拠ルートを指定して通信遮断コンテナで実行する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--compare-input", type=Path)
    args = parser.parse_args()
    if args.compare_input:
        transcript = asyncio.run(
            FasterWhisperASRStage().transcribe_audio(
                args.compare_input.read_bytes(), "vi"
            )
        )
        path = args.root / "voice-diagnostic/input-comparison.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {"audio": inspect_audio(args.compare_input), "transcript": transcript},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    else:
        asyncio.run(probe(args.root))


if __name__ == "__main__":
    main()
