#!/usr/bin/env python3
"""比較モデルが生成した全区間の音声を、別のASRで再認識する。

Gemmaで、TTSから独立した認識結果を比較する。
Gemmaは製品ASR/MTと同系列のため、翻訳自体の独立評価とはしない。
元レポートのWAVハッシュを照合し、認識結果を品質レビュー用に保存する。
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
from pathlib import Path

from app.ai_pipeline.providers.local_multimodal import LocalMultimodalStage

logger = logging.getLogger(__name__)


def source_is_complete(report: dict[str, object], cases_key: str) -> bool:
    """候補比較または製品連結試験の完了を確認し、空・失敗ケースを拒否する。"""
    cases = report.get(cases_key)
    if not isinstance(cases, list) or not cases:
        return False
    if report.get("execution_complete") is True:
        return True
    return (
        report.get("stage") in {"pipeline", "text-pipeline"}
        and report.get("passed") is True
        and all(
            isinstance(case, dict) and case.get("status") == "passed" for case in cases
        )
    )


async def verify(path: Path, output: Path, cases_key: str) -> int:
    """元の全ケースを順番に認識し、空結果やハッシュ不一致は失敗にする。"""
    original = json.loads(path.read_text(encoding="utf-8"))
    report = {
        "source_report_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "observer": (
            "gemma: Gemma4 E2B; independent of TTS, same family as product ASR/MT"
        ),
        "execution_complete": False,
        "quality_verdict": "unreviewed",
        "cases": [],
        "source_cases_key": cases_key,
    }
    asr = LocalMultimodalStage()
    try:
        assert source_is_complete(original, cases_key), "元の音声生成試験が未完了"
        for case in original[cases_key]:
            audio = (path.parent / case["audio"]["file"]).read_bytes()
            digest = hashlib.sha256(audio).hexdigest()
            assert digest == case["audio"]["sha256"], "音声ハッシュ不一致"
            text = await asr.transcribe_audio(audio, case["target"])
            assert text, "比較ASRの空結果"
            report["cases"].append(
                {
                    "source": case["source"],
                    "target": case["target"],
                    "segment_index": case.get("segment_index", 0),
                    "expected": case["translation"],
                    "observed": text,
                    "audio_sha256": digest,
                }
            )
            output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        report["execution_complete"] = len(report["cases"]) == len(original[cases_key])
    except Exception as exc:
        logger.exception("独立音声観測に失敗")
        report["error"] = str(exc)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["execution_complete"] else 1


def main() -> int:
    """通信遮断コンテナで実行するCLI。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--cases-key", choices=("cases", "pipeline_cases"), default="cases"
    )
    args = parser.parse_args()
    return asyncio.run(verify(args.input, args.output, args.cases_key))


if __name__ == "__main__":
    raise SystemExit(main())
