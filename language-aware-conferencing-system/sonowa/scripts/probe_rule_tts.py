#!/usr/bin/env python3
"""追加の学習モデルを使わない音声合成を、既知の4言語素材で比較する。

eSpeak NGの機械的な声の可読性を評価する。日本語は辞書で仮名へ変換する。
製品設定へは反映せず、入力・読み・音声ハッシュを保存する。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

from pykakasi import kakasi
from verify_local_pipeline import TEXTS, inspect_audio

VOICES = {"ja": "ja", "en": "en-us", "zh": "cmn", "vi": "vi"}


def main() -> int:
    """4言語の合成音声を生成し、独立再認識用のレポートを保存する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {"execution_complete": False, "quality_verdict": "unreviewed", "cases": []}
    try:
        reader = kakasi()
        for language, text in TEXTS.items():
            started = time.monotonic()
            reading = (
                "".join(part["hira"] for part in reader.convert(text))
                if language == "ja"
                else text
            )
            wav = args.output_dir / f"input-{language}.wav"
            subprocess.run(
                [
                    "espeak-ng",
                    "-v",
                    VOICES[language],
                    "-s",
                    "150",
                    "-w",
                    str(wav),
                    "--stdin",
                ],
                input=reading,
                text=True,
                check=True,
                capture_output=True,
            )
            report["cases"].append(
                {
                    "source": language,
                    "target": language,
                    "translation": text,
                    "reading": reading,
                    "audio": inspect_audio(wav),
                    "elapsed_s": time.monotonic() - started,
                }
            )
        report["execution_complete"] = len(report["cases"]) == len(TEXTS)
    except Exception as exc:
        report["error"] = str(exc)
    (args.output_dir / "seamless.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    return 0 if report["execution_complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
