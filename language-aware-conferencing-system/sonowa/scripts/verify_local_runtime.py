#!/usr/bin/env python3
"""通信遮断 Docker で方式3（ローカル）の異常系・並行要求を検証する。

入力: --empty-cache はモデルをマウントしない実行に使用する。
出力: 実行条件、ケース結果、GPU 最大割当の JSON。正常系の品質判定とは別。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path

from verify_local_pipeline import inspect_audio

from app.ai_pipeline.providers import local_tts
from app.ai_pipeline.providers.local_multimodal import LocalMultimodalStage
from app.ai_pipeline.providers.local_tts import create_stage
from app.ai_pipeline.registry import CompositeAIProvider
from app.ai_pipeline.vram_broker import VRAMBroker
from app.audio.pcm import wrap_wav16
from app.config import settings

logger = logging.getLogger(__name__)


async def verify(empty_cache: bool, input_dir: Path | None = None) -> dict[str, object]:
    """実装を差し替えず、モデル欠損と予算不足時の非クラウド動作を観測する。"""
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA が必要です")
    torch.cuda.reset_peak_memory_stats()
    cases: list[dict[str, object]] = []
    audio = wrap_wav16(bytes(16000 * 2), 16000)
    if empty_cache:
        asr = LocalMultimodalStage()
        tts = create_stage()
        assert await asr.transcribe_audio(audio, "ja") == ""
        assert await asr.translate_text("こんにちは", "ja", "en") == ""
        assert await tts.synthesize("Hello", "en") is None
        cases.append({"case": "missing_models", "passed": True})
    else:
        shared = VRAMBroker(
            budget_mb=settings.vram_budget_mb, allow_idle_preemption=True
        )
        stage = LocalMultimodalStage(broker=shared)
        translations = await asyncio.gather(
            stage.translate_text("会議は10時です。送信しないでください。", "ja", "en"),
            stage.translate_text("The meeting is at 10. Do not send it.", "en", "ja"),
        )
        assert all(translations)
        assert len(shared.resident_keys()) == 1
        cases.append(
            {"case": "parallel_mt", "translations": translations, "passed": True}
        )
        # local TTS 未結線（字幕のみ）でも翻訳が継続することを観測する。
        pipeline = CompositeAIProvider(stage, stage, create_stage(broker=shared))
        result = await pipeline.translate_audio(
            b"", "ja", "en", original_text="会議は10時です。送信しないでください。"
        )
        assert result.original_text and result.translated_text
        assert local_tts.available() or result.audio_data is None
        cases.append(
            {
                "case": "subtitle_only_text_input_translation",
                "translation": result.translated_text,
                "audio_absent": result.audio_data is None,
                "passed": True,
            }
        )
        if input_dir is not None:
            pipeline = CompositeAIProvider(stage, stage, create_stage(broker=shared))
            directions = (("ja", "en"), ("en", "ja"))
            results = await asyncio.gather(
                *(
                    pipeline.translate_audio(
                        (input_dir / f"input-{source}.wav").read_bytes(), source, target
                    )
                    for source, target in directions
                )
            )
            observations = []
            for (source, target), result in zip(directions, results, strict=True):
                assert result.original_text and result.translated_text
                row: dict[str, object] = {
                    "source": source,
                    "target": target,
                    "transcript": result.original_text,
                    "translation": result.translated_text,
                }
                if result.audio_data:
                    path = input_dir / f"parallel-{source}-{target}.wav"
                    path.write_bytes(result.audio_data)
                    row["audio"] = inspect_audio(path)
                observations.append(row)
            expected = 2 if local_tts.available() else 1
            assert (
                len(shared.resident_keys()) == expected
            ), "並行処理中に常駐モデルが退避された"
            cases.append(
                {
                    "case": "parallel_pipeline",
                    "passed": True,
                    "results": observations,
                    "resident_models": shared.resident_keys(),
                }
            )
    tiny = VRAMBroker(budget_mb=1)
    assert await LocalMultimodalStage(broker=tiny).transcribe_audio(audio, "ja") == ""
    assert await create_stage(broker=tiny).synthesize("Hello", "en") is None
    assert tiny.resident_keys() == []
    cases.append({"case": "insufficient_budget", "passed": True})
    return {
        "passed": True,
        "empty_cache": empty_cache,
        "tts_model": local_tts.MODEL_ID,
        "configured_budget_mb": settings.vram_budget_mb,
        "cases": cases,
        "torch_peak_allocated_mb": torch.cuda.max_memory_allocated() / 1024**2,
    }


def main() -> int:
    """異常終了も JSON に保存し、正常終了コードで隠さない。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--empty-cache", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--input-dir", type=Path)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    try:
        report = asyncio.run(verify(args.empty_cache, args.input_dir))
    except Exception as exc:
        logger.exception("実機異常系の検証失敗")
        report = {"passed": False, "error": str(exc)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
