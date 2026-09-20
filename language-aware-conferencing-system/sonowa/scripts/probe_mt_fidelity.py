#!/usr/bin/env python3
"""保存したASR原文に対し、翻訳制約の変更前後を実モデルで比較する。"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
from pathlib import Path

from app.ai_pipeline.providers.local_multimodal import LocalMultimodalStage

logger = logging.getLogger(__name__)


async def compare(source: Path, output: Path) -> int:
    """原文を変えず12方向を翻訳し、以前の訳文と併記する。"""
    previous = json.loads(source.read_text())
    report = {
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "complete": False,
        "cases": [],
    }
    stage = LocalMultimodalStage()
    try:
        for case in previous["pipeline_cases"]:
            translated = await stage.translate_text(
                case["original"], case["source"], case["target"]
            )
            assert translated, "翻訳結果が空"
            report["cases"].append(
                {
                    "source": case["source"],
                    "target": case["target"],
                    "original": case["original"],
                    "before": case["translation"],
                    "after": translated,
                }
            )
            output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        report["complete"] = len(report["cases"]) == 12
    except Exception as exc:
        logger.exception("翻訳制約の実モデル比較に失敗")
        report["error"] = str(exc)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["complete"] else 1


def main() -> int:
    """通信遮断した診断コンテナで実行するCLI。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    return asyncio.run(compare(args.input, args.output))


if __name__ == "__main__":
    raise SystemExit(main())
