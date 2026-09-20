#!/usr/bin/env python3
"""FLEURS の既知トランスクリプト付き自然発話を4言語分取得する。

入力: 証拠ディレクトリ。出力: WAV と出典・正解テキストの manifest.json。
音声をクラウド合成せず、公開データセットの先頭行グループを範囲取得する。
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
from pathlib import Path

import fsspec
import pyarrow.parquet as pq
import soundfile as sf

CONFIGS = {"ja": "ja_jp", "en": "en_us", "zh": "cmn_hans_cn", "vi": "vi_vn"}
MAX_SECONDS = 20
MIN_SECONDS = 2
logger = logging.getLogger(__name__)


def main() -> int:
    """各言語の短い自然発話と正解を取得し、失敗時は非ゼロで停止する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO)
    manifest = {
        "dataset": "google/fleurs",
        "source": "https://huggingface.co/datasets/google/fleurs",
        "license": "CC-BY-4.0",
        "cases": [],
    }
    for language, config in CONFIGS.items():
        url = f"https://huggingface.co/api/datasets/google/fleurs/parquet/{config}/test/0.parquet"
        with fsspec.open(url, "rb", block_size=1024**2) as source:
            parquet = pq.ParquetFile(source)
            rows = parquet.read_row_group(0).to_pylist()
        for row in rows:
            audio, rate = sf.read(io.BytesIO(row["audio"]["bytes"]))
            seconds = len(audio) / rate
            if not MIN_SECONDS <= seconds <= MAX_SECONDS:
                continue
            path = args.output_dir / f"input-{language}.wav"
            sf.write(path, audio, rate, subtype="PCM_16")
            case = {
                "language": language,
                "text": row.get("raw_transcription") or row["transcription"],
                "id": row["id"],
                "config": config,
                "split": "test",
                "url": url,
                "duration_s": seconds,
                "file": path.name,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
            manifest["cases"].append(case)
            logger.info("自然発話取得: %s", case)
            break
        else:
            raise RuntimeError(f"検証可能な自然発話がありません: {language}")
        (args.output_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
