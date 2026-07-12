"""実サービスを使用して翻訳品質と処理遅延を測定する統合ベンチマーク。"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import time
from dataclasses import asdict, dataclass

from openai import AsyncOpenAI
from sacrebleu.metrics import CHRF

from app.ai_pipeline.pipeline import ai_pipeline
from app.ai_pipeline.qos import number_retention
from app.audio.pcm import parse_wav16, wrap_wav16

logger = logging.getLogger(__name__)

TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "tts-1")
TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "alloy")
JUDGE_MODEL = os.getenv("OPENAI_TRANSLATION_MODEL", "gpt-4o-mini")
TARGET_LANGUAGE = "en"
MAX_ASR_CER = 0.15
MIN_CHRF_SCORE = 50.0
MIN_JUDGE_SCORE = 4.0
MIN_NUMBER_RETENTION = 0.98
MAX_P95_LATENCY_MS = 5000.0

CASES = (
    (
        "今日は会議のテストです。翻訳が正しく動くか確認します。",
        "Today is a meeting test. We will check whether the translation works correctly.",
    ),
    (
        "次回の会議は火曜日の午前10時に開始します。",
        "The next meeting will start at 10 a.m. on Tuesday.",
    ),
    (
        "今月の売上は300万円で、前月より12.5パーセント増加しました。",
        "This month's sales were 3 million yen, an increase of 12.5 percent from the previous month.",
    ),
    (
        "リアルタイム翻訳では、精度と遅延のバランスが重要です。",
        "In real-time translation, balancing accuracy and latency is important.",
    ),
    (
        "資料をご確認いただき、ご意見をお聞かせください。",
        "Please review the materials and share your feedback.",
    ),
)


@dataclass
class CaseResult:
    """1件の翻訳品質・遅延測定結果。"""

    source: str
    recognized: str
    reference: str
    translated: str
    asr_cer: float
    chrf: float
    adequacy: float
    fluency: float
    number_retention: float | None
    latency_ms: float
    audio_bytes: int


def _normalize(value: str) -> str:
    """CER 比較用に空白と記号を除去し、小文字へ正規化する。"""
    return re.sub(r"[^\w\u3040-\u30ff\u3400-\u9fff]", "", value.lower())


def _edit_distance(left: str, right: str) -> int:
    """2文字列間の Levenshtein 距離を返す。"""
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_char in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_char != right_char),
                )
            )
        previous = current
    return previous[-1]


def _cer(reference: str, candidate: str) -> float:
    """正規化済み原文に対する文字誤り率を返す。"""
    normalized_reference = _normalize(reference)
    normalized_candidate = _normalize(candidate)
    if not normalized_reference:
        return 0.0
    return _edit_distance(normalized_reference, normalized_candidate) / len(
        normalized_reference
    )


async def _judge(
    client: AsyncOpenAI, source: str, reference: str, candidate: str
) -> tuple[float, float]:
    """意味の十分性と英語の流暢性を5段階で評価する。"""
    response = await client.chat.completions.create(
        model=JUDGE_MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a strict Japanese-to-English translation evaluator. "
                    "Return JSON only with numeric adequacy and fluency scores from "
                    "0 to 5. Adequacy measures preserved meaning, names, and numbers. "
                    "Fluency measures natural, grammatical English."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Japanese source: {source}\n"
                    f"Reference: {reference}\n"
                    f"Candidate: {candidate}"
                ),
            },
        ],
    )
    payload = json.loads(response.choices[0].message.content or "{}")
    return float(payload["adequacy"]), float(payload["fluency"])


async def _run_case(
    client: AsyncOpenAI, chrf: CHRF, source: str, reference: str, index: int
) -> CaseResult:
    """TTS入力を生成し、実パイプラインの品質と遅延を1件測定する。"""
    speech = await client.audio.speech.create(
        model=TTS_MODEL,
        voice=TTS_VOICE,
        input=source,
        response_format="wav",
    )
    pcm, sample_rate = parse_wav16(speech.content, fallback_rate=24000)
    audio = wrap_wav16(pcm, sample_rate)

    started_at = time.perf_counter()
    result = await ai_pipeline.process_audio(
        audio,
        "ja",
        TARGET_LANGUAGE,
        speaker_id=f"quality-{index}",
    )
    latency_ms = (time.perf_counter() - started_at) * 1000
    if not result.original_text or not result.translated_text or not result.audio_data:
        raise RuntimeError(f"翻訳パイプラインが空結果を返しました: case={index}")

    adequacy, fluency = await _judge(
        client, source, reference, result.translated_text
    )
    return CaseResult(
        source=source,
        recognized=result.original_text,
        reference=reference,
        translated=result.translated_text,
        asr_cer=_cer(source, result.original_text),
        chrf=chrf.sentence_score(result.translated_text, [reference]).score,
        adequacy=adequacy,
        fluency=fluency,
        number_retention=number_retention(
            result.original_text, result.translated_text
        ),
        latency_ms=latency_ms,
        audio_bytes=len(result.audio_data),
    )


def _percentile(values: list[float], percentile: float) -> float:
    """nearest-rank 法でパーセンタイルを返す。"""
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


async def main() -> None:
    """全ケースを実行し、品質・遅延ゲートを評価する。"""
    client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    chrf = CHRF(word_order=2)
    results = [
        await _run_case(client, chrf, source, reference, index)
        for index, (source, reference) in enumerate(CASES, start=1)
    ]
    latencies = [result.latency_ms for result in results]
    numeric_scores = [
        result.number_retention
        for result in results
        if result.number_retention is not None
    ]
    summary = {
        "cases": [asdict(result) for result in results],
        "aggregate": {
            "mean_asr_cer": sum(result.asr_cer for result in results) / len(results),
            "mean_chrf": sum(result.chrf for result in results) / len(results),
            "mean_adequacy": sum(result.adequacy for result in results) / len(results),
            "mean_fluency": sum(result.fluency for result in results) / len(results),
            "mean_number_retention": (
                sum(numeric_scores) / len(numeric_scores) if numeric_scores else None
            ),
            "p50_latency_ms": _percentile(latencies, 0.50),
            "p95_latency_ms": _percentile(latencies, 0.95),
        },
    }
    logger.info("TRANSLATION_BENCHMARK=%s", json.dumps(summary, ensure_ascii=False))

    aggregate = summary["aggregate"]
    failures = []
    if aggregate["mean_asr_cer"] > MAX_ASR_CER:
        failures.append("ASR CER")
    if aggregate["mean_chrf"] < MIN_CHRF_SCORE:
        failures.append("chrF++")
    if aggregate["mean_adequacy"] < MIN_JUDGE_SCORE:
        failures.append("adequacy")
    if aggregate["mean_fluency"] < MIN_JUDGE_SCORE:
        failures.append("fluency")
    number_score = aggregate["mean_number_retention"]
    if number_score is not None and number_score < MIN_NUMBER_RETENTION:
        failures.append("number retention")
    if aggregate["p95_latency_ms"] > MAX_P95_LATENCY_MS:
        failures.append("P95 latency")
    if failures:
        raise RuntimeError("品質ゲート未達: " + ", ".join(failures))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(main())
