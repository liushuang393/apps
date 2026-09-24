#!/usr/bin/env python3
"""LiveKit 受信 WAV を無音区間で分割し、内容をローカル ASR で独立観測する。

元 WAV のハッシュと区間位置を保持する。入力音声の生成や内容の補完は行わない。
"""

from __future__ import annotations

import argparse
import asyncio
import difflib
import hashlib
import json
import wave
from pathlib import Path

import numpy as np
from verify_local_pipeline import MIN_TRANSCRIPT_SIMILARITY, normalized

from app.ai_pipeline.providers.local_multimodal import LocalMultimodalStage
from app.audio.pcm import wrap_wav16

FRAME_SECONDS = 0.02
SILENCE_SECONDS = 0.6
PADDING_SECONDS = 0.2
MIN_RMS = 0.001


async def verify(path: Path) -> dict[str, object]:
    """入力区間をそのまま認識し、DB 記録の訳文と一致するかを確認する。"""
    # 認識言語は verify_local_livekit.py の出力名 livekit-<target>.wav から得る。
    language = path.stem.rsplit("-", 1)[-1]
    with wave.open(str(path)) as source:
        rate = source.getframerate()
        assert source.getsampwidth() == 2 and source.getnchannels() == 1
        pcm = source.readframes(source.getnframes())
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float64) / 32768
    frame = int(rate * FRAME_SECONDS)
    active = [
        offset
        for offset in range(0, len(samples), frame)
        if np.sqrt(np.mean(samples[offset : offset + frame] ** 2)) >= MIN_RMS
    ]
    assert active, "受信音声が無音です"
    ranges = []
    start = previous = active[0]
    for offset in active[1:]:
        if offset - previous > rate * SILENCE_SECONDS:
            ranges.append((start, previous + frame))
            start = offset
        previous = offset
    ranges.append((start, previous + frame))
    asr = LocalMultimodalStage()
    cases = []
    for start, end in ranges:
        start = max(0, start - int(rate * PADDING_SECONDS))
        end = min(len(samples), end + int(rate * PADDING_SECONDS))
        chunk = pcm[start * 2 : end * 2]
        text = await asr.transcribe_audio(wrap_wav16(chunk, rate), language)
        assert text, "受信音声の認識結果が空です"
        cases.append(
            {
                "start_s": start / rate,
                "end_s": end / rate,
                "text": text,
                "pcm_sha256": hashlib.sha256(chunk).hexdigest(),
            }
        )
    combined = " ".join(row["text"] for row in cases)
    source_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    transport = json.loads((path.parent / "livekit.json").read_text(encoding="utf-8"))
    # 受信音声は DB に記録された訳文の合成音声のはずなので、その一致度で内容を判定する。
    expected = " ".join(row[1] for row in transport.get("db_translations", []))
    similarity = difflib.SequenceMatcher(
        None, normalized(expected), normalized(combined)
    ).ratio()
    transport_ok = (
        (transport.get("transport_complete") or transport.get("passed"))
        and transport.get("cleanup") == "passed"
        and transport.get("audio", {}).get("sha256") == source_hash
        and "error" not in transport
    )
    return {
        "source_sha256": source_hash,
        "tested_image": transport.get("tested_image"),
        "transport_verified": bool(transport_ok),
        "cases": cases,
        "expected": expected,
        "similarity": similarity,
        "passed": bool(transport_ok) and similarity >= MIN_TRANSCRIPT_SIMILARITY,
        "note": "受信音声の再認識と DB 記録の訳文の一致度。音声品質の総合判定ではない",
    }


def main() -> int:
    """通信遮断した実モデルコンテナで実行し、失敗も保存する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = asyncio.run(verify(args.wav))
    except Exception as exc:
        report = {"passed": False, "error": str(exc)}
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
