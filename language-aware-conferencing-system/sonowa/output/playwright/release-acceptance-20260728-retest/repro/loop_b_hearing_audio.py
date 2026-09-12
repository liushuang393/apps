"""[debug harness] 翻訳音声が生成されない症状の再現ループ（ブロッカー4）。

目的:
    受入時に「翻訳音声が生成されず全クライアントが字幕へ縮退した」症状を、
    聞く主線（hearing）の実処理境界で赤／緑判定する。

再現する経路:
    orchestrator._hearing → PerUtteranceRuntime → AIPipeline.process_audio
    → provider.translate_audio（ASR済み原文を渡す実運用と同じ引数形）

実行:
    docker cp <wav> lams-mvp-backend-1:/tmp/loop_b.wav
    docker compose exec -T backend python - < loop_b_hearing_audio.py

判定:
    exit 0 = 緑（翻訳文と翻訳音声の双方が得られる）
    exit 1 = 赤（翻訳音声が無い＝ユーザー症状）

注意:
    使い捨てのデバッグ用ハーネス。API キー等の秘密値は出力しない。
"""

from __future__ import annotations

import asyncio
import pathlib
import sys

WAV_PATH = pathlib.Path("/tmp/loop_b.wav")
SOURCE_LANG = "ja"
TARGET_LANG = "en"
ORIGINAL_TEXT = "これはリリース受け入れテストです。"


async def main() -> int:
    """聞く主線の実処理を1発話ぶん走らせ、翻訳音声の有無を判定する。"""
    from app.ai_pipeline.pipeline import ai_pipeline
    from app.config import settings

    provider = ai_pipeline._provider  # noqa: SLF001 診断目的で実体を確認する
    print(f"[LOOP-B] provider class     : {type(provider).__name__}")
    print(f"[LOOP-B] realtime_runtime   : {settings.realtime_runtime}")
    print(f"[LOOP-B] tts_provider slot  : {settings.tts_provider}")
    print(f"[LOOP-B] mt_provider slot   : {settings.mt_provider}")
    print(f"[LOOP-B] asr_provider slot  : {settings.asr_provider}")

    if not WAV_PATH.exists():
        print(f"[LOOP-B] 前提失敗: {WAV_PATH} が無い（docker cp してから実行する）")
        return 1
    wav = WAV_PATH.read_bytes()
    print(f"[LOOP-B] 入力 WAV           : {len(wav)} bytes")

    result = await ai_pipeline.process_audio(
        wav,
        SOURCE_LANG,
        TARGET_LANG,
        speaker_id="loop-b",
        original_text=ORIGINAL_TEXT,
    )

    audio_len = len(result.audio_data) if result.audio_data else 0
    print(f"[LOOP-B] original_text      : '{result.original_text[:40]}'")
    print(f"[LOOP-B] translated_text    : '{result.translated_text[:60]}'")
    print(f"[LOOP-B] 翻訳音声 bytes     : {audio_len}")
    print(f"[LOOP-B] 所要 ms            : {result.metrics.total_latency_ms:.0f}")

    failures: list[str] = []
    if not result.translated_text:
        failures.append("翻訳文が空")
    if not result.audio_data:
        failures.append("翻訳音声が生成されない（ユーザー症状）")

    if failures:
        print(f"[LOOP-B] RED: {' / '.join(failures)}")
        return 1
    print("[LOOP-B] GREEN: 翻訳文と翻訳音声の双方を取得")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
