#!/usr/bin/env python3
"""Docker 内で実モデルを検証し、訳文・WAV・計測結果を証拠として保存する。

入力: --stage と --output-dir。ASR/連結検証は output-dir の input-{言語}.wav を使う。
    output-dir に manifest.json（prepare_local_speech_fixtures.py の FLEURS 自然発話）
    があれば、その正解テキストを既知文として使う。
出力: 段階別 JSON と WAV。失敗は終了コード 1 とし、スキップで成功させない。
注意: HF_HUB_OFFLINE=1 と --network none を併用し、モデルは事前取得する。
local TTS 未結線（字幕のみ）の間、翻訳音声は必須にしない。LiveKit E2E の合格証拠ではない。
"""

from __future__ import annotations

import argparse
import asyncio
import difflib
import hashlib
import json
import logging
import re
import subprocess
import time
import wave
from pathlib import Path

import numpy as np

from app.ai_pipeline.effective_config import (
    PipelineSettingsValues,
    set_cached_pipeline_settings,
)
from app.ai_pipeline.providers.local_multimodal import LocalMultimodalStage
from app.ai_pipeline.providers.local_tts import LANGUAGES as TTS_LANGUAGES
from app.ai_pipeline.providers.local_tts import available as tts_available
from app.ai_pipeline.providers.local_tts import create_stage
from app.ai_pipeline.registry import CompositeAIProvider
from app.ai_pipeline.vram_broker import broker

logger = logging.getLogger(__name__)
TEXTS = {
    "ja": "会議は10時に始まります。ファイルを送信しないでください。",
    "en": "The meeting starts at 10. Do not send the file.",
    "zh": "会议在10点开始。请不要发送文件。",
    "vi": "Cuộc họp bắt đầu lúc 10 giờ. Đừng gửi tệp.",
}
MIN_AUDIO_SECONDS = 0.2
MAX_AUDIO_SECONDS = 90
MIN_RMS = 0.001
MIN_TRANSCRIPT_SIMILARITY = 0.65
VOICE_WINDOW_SECONDS = 0.5


def has_voice(
    audio: bytes | bytearray,
    sample_rate: int = 16000,
    *,
    minimum_seconds: float = VOICE_WINDOW_SECONDS,
) -> bool:
    """常時配信の無音フレームを除外し、実音声の到着を判定する。"""
    if not audio or len(audio) < sample_rate * 2 * minimum_seconds or len(audio) % 2:
        return False
    samples = np.frombuffer(audio, dtype=np.int16).astype(np.float64) / 32768
    return bool(np.sqrt(np.mean(samples**2)) >= MIN_RMS)


def inspect_audio(path: Path) -> dict[str, object]:
    """WAV の長さと実信号を検証し、ハッシュ付きの計測結果を返す。"""
    with wave.open(str(path)) as wav:
        rate = wav.getframerate()
        frames = wav.getnframes()
        width = wav.getsampwidth()
        channels = wav.getnchannels()
        data = wav.readframes(frames)
    if width != 2 or channels != 1:
        raise ValueError("16-bit mono WAV が必要です")
    seconds = frames / rate
    samples = np.frombuffer(data, dtype=np.int16).astype(np.float64) / 32768
    rms = float(np.sqrt(np.mean(samples**2))) if samples.size else 0.0
    if not MIN_AUDIO_SECONDS <= seconds <= MAX_AUDIO_SECONDS or rms < MIN_RMS:
        raise ValueError(f"空・無音・異常長の WAV: seconds={seconds}, rms={rms}")
    return {
        "file": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "sample_rate": rate,
        "duration_s": seconds,
        "rms": rms,
    }


def normalized(text: str) -> str:
    """認識比較用に句読点・空白・大小文字を正規化する。"""
    return re.sub(r"[\W_]", "", text.casefold())


async def verify(
    stage: str,
    output: Path,
    source_filter: str | None = None,
    target_filter: str | None = None,
) -> dict[str, object]:
    """指定段階を実モデルで実行し、全ケースと失敗理由を返す。"""
    import torch

    texts = dict(TEXTS)
    manifest = output / "manifest.json"
    if manifest.is_file():
        cases_in = json.loads(manifest.read_text(encoding="utf-8"))["cases"]
        texts = {case["language"]: case["text"] for case in cases_in}

    set_cached_pipeline_settings(
        PipelineSettingsValues("gpt4o_transcribe", "local", "local", "local", "hybrid")
    )
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA が利用できません")
    torch.cuda.reset_peak_memory_stats()
    asr, mt, tts = LocalMultimodalStage(), LocalMultimodalStage(), create_stage()
    composite = CompositeAIProvider(asr, mt, tts)
    cases: list[dict[str, object]] = []
    for source, expected in texts.items():
        if source_filter and source != source_filter:
            continue
        targets = (
            [t for t in texts if t != source]
            if stage in {"mt", "pipeline", "text-pipeline"}
            else [source]
        )
        for target in targets:
            if target_filter and target != target_filter:
                continue
            item: dict[str, object] = {
                "source": source,
                "target": target,
                "input": expected,
            }
            started = time.monotonic()
            try:
                if stage in {"asr", "detect"}:
                    path = output / f"input-{source}.wav"
                    item["audio"] = inspect_audio(path)
                    if stage == "detect":
                        actual, detected = await asr.transcribe_with_detection(
                            path.read_bytes(), "multi"
                        )
                        item["detected_language"] = detected
                        if detected != source:
                            raise RuntimeError("発話言語の検出が一致しません")
                    else:
                        actual = await asr.transcribe_audio(path.read_bytes(), source)
                    score = difflib.SequenceMatcher(
                        None, normalized(expected), normalized(actual)
                    ).ratio()
                    item.update(transcript=actual, similarity=score)
                    if score < MIN_TRANSCRIPT_SIMILARITY:
                        raise RuntimeError("ASR が既知文の一致基準を満たしません")
                elif stage == "mt":
                    translated = await mt.translate_text(expected, source, target)
                    item["translation"] = translated
                    if not translated:
                        raise RuntimeError("MT の空訳")
                    item["semantic_review"] = "required: meaning, numbers and negation"
                else:
                    audio_input = b""
                    if stage != "text-pipeline":
                        path = output / f"input-{source}.wav"
                        inspect_audio(path)
                        audio_input = path.read_bytes()
                    result = await composite.translate_audio(
                        audio_input,
                        source,
                        target,
                        original_text=expected if stage == "text-pipeline" else None,
                    )
                    item.update(
                        transcript=result.original_text,
                        translation=result.translated_text,
                    )
                    if not result.original_text or not result.translated_text:
                        raise RuntimeError("連結処理で認識・翻訳のいずれかが欠落")
                    # vi など local TTS 非対応言語は字幕のみが正常。
                    if (
                        tts_available()
                        and target in TTS_LANGUAGES
                        and not result.audio_data
                    ):
                        raise RuntimeError("結線済み local TTS が音声を返しません")
                    if result.audio_data:
                        prefix = (
                            "text-translated"
                            if stage == "text-pipeline"
                            else "translated"
                        )
                        path = output / f"{prefix}-{source}-{target}.wav"
                        path.write_bytes(result.audio_data)
                        item["audio"] = inspect_audio(path)
                    item["semantic_review"] = "required: meaning and negation"
                item["status"] = "passed"
            except Exception as exc:
                logger.exception("検証失敗: %s %s->%s", stage, source, target)
                item.update(status="failed", error=f"{type(exc).__name__}: {exc}")
            item["elapsed_s"] = round(time.monotonic() - started, 3)
            item["resident_models"] = broker.resident_keys()
            cases.append(item)
            (output / f"{stage}-cases.json").write_text(
                json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            logger.info("ケース完了: %s", item)
    return {
        "stage": stage,
        "gpu": torch.cuda.get_device_name(),
        "torch_peak_allocated_mb": torch.cuda.max_memory_allocated() / 1024**2,
        "note": "PyTorch peak only; semantic review required",
        "cases": cases,
        "quality_verdict": "unreviewed",
        "passed": bool(cases) and all(c["status"] == "passed" for c in cases),
    }


def main() -> int:
    """CLI 引数を読み、失敗時も証拠を保存して終了コードを返す。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage",
        choices=("asr", "detect", "mt", "pipeline", "text-pipeline"),
        required=True,
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--source", choices=tuple(TEXTS))
    parser.add_argument("--target", choices=tuple(TEXTS))
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO)
    metrics_path = args.output_dir / f"{args.stage}-gpu.csv"
    metrics_file = metrics_path.open("w", encoding="utf-8")
    monitor = None
    try:
        monitor = subprocess.Popen(
            [
                "nvidia-smi",
                "--query-gpu=memory.used",
                "--format=csv,noheader,nounits",
                "--loop-ms=250",
            ],
            stdout=metrics_file,
            stderr=subprocess.DEVNULL,
        )
        report = asyncio.run(
            verify(args.stage, args.output_dir, args.source, args.target)
        )
    except Exception as exc:
        logger.exception("検証を開始できません")
        report = {"stage": args.stage, "passed": False, "error": str(exc)}
    finally:
        if monitor is not None:
            monitor.terminate()
            monitor.wait(timeout=10)
        metrics_file.close()
    samples = [
        int(line.strip())
        for line in metrics_path.read_text().splitlines()
        if line.strip().isdigit()
    ]
    report["gpu_peak_used_mb"] = max(samples) if samples else None
    report["gpu_metric_note"] = "250ms sampling; includes other GPU processes"
    if not samples:
        report.update(passed=False, error="GPU 使用量の実測記録がありません")
    (args.output_dir / f"{args.stage}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
