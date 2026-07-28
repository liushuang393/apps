"""[debug harness] 進行中の聞く主線が次発話の受理で無音化する症状の再現（ブロッカー4）。

目的:
    IngressPipeline は「確定発話を queue へ積んだ時点」で on_final_accepted を呼び、
    Agent はそこで orchestrator.interrupt_speaker を実行する。一方その発話の
    聞く主線（ASR+MT+TTS で約 3 秒）はまだ実行中であるため、進行中世代が
    無効化されて翻訳音声が破棄される可能性がある。この重なりを再現する。

実行:
    docker compose exec -T backend python - < loop_b3_inflight_interrupt.py

判定:
    exit 0 = 緑（進行中発話の翻訳音声が配信される）
    exit 1 = 赤（無音化＝ユーザー症状 / reason=hearing_failed_runtime_fallback_reading）

注意:
    使い捨てのデバッグ用ハーネス。provider へは接続せず注入した疑似 runtime を使う
    ため決定的かつ高速（1 秒未満）。
"""

from __future__ import annotations

import asyncio
import sys

ROOM_ID = "loop-b3-room"
SPEAKER_ID = "loop-b3-speaker"
TARGET_LANG = "en"
HEARING_DELAY_S = 0.3


class CaptureSink:
    """配信内容を記録するだけの OutputSink 実装。"""

    def __init__(self) -> None:
        self.audio: list[tuple[str, int]] = []
        self.subtitles: list[dict] = []

    async def deliver_audio(
        self, user_id: str, audio: bytes, *, generation_id: int | None = None
    ) -> None:
        """翻訳音声の配信を記録する。"""
        self.audio.append((user_id, len(audio)))

    async def deliver_subtitle(self, user_id: str, message: dict) -> None:
        """字幕の配信を記録する。"""
        self.subtitles.append({"user_id": user_id, **message})

    async def deliver_interim(self, user_id: str, message: dict) -> None:
        """暫定字幕の配信を記録する。"""
        self.subtitles.append({"user_id": user_id, "interim": True, **message})


async def main() -> int:
    """聞く主線の実行中に次発話受理相当の interrupt を挟み、音声到達を判定する。"""
    from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener
    from app.ai_pipeline.runtime.factory import RuntimeRegistry
    from app.ai_pipeline.runtime.per_utterance import PerUtteranceRuntime
    from app.ai_pipeline.runtime.types import RuntimeTranslationOutput

    hearing_started = asyncio.Event()

    async def slow_translate(
        audio: bytes,  # noqa: ARG001
        src: str,  # noqa: ARG001
        tgt: str,  # noqa: ARG001
        original_text: str | None,  # noqa: ARG001
    ) -> RuntimeTranslationOutput:
        """実 provider 相当の所要時間を持つ疑似翻訳（音声付き）。"""
        hearing_started.set()
        await asyncio.sleep(HEARING_DELAY_S)
        return RuntimeTranslationOutput(
            translated_text="This is a release acceptance test.",
            audio_data=b"FAKE-TRANSLATED-AUDIO",
        )

    registry = RuntimeRegistry(
        mode="per_utterance",
        runtime_factory=lambda _mode: PerUtteranceRuntime(translate_fn=slow_translate),
    )
    orchestrator = HybridOrchestrator(runtime_registry=registry)
    listeners = [
        Listener(
            user_id="listener-en",
            target_language=TARGET_LANG,
            wants_audio=True,
            subtitle_enabled=True,
        )
    ]
    sink = CaptureSink()

    task = asyncio.create_task(
        orchestrator.orchestrate(
            audio_bytes=b"pcm-utterance-1",
            source_language="ja",
            original_text="これはリリース受け入れテストです。",
            listeners=listeners,
            sink=sink,
            mode="a",
            subtitle_id="utt-1",
            seq=1,
            speaker_id=SPEAKER_ID,
            room_id=ROOM_ID,
        )
    )
    # 聞く主線が走り始めてから「次発話が queue に積まれた」相当の interrupt を発火する
    await asyncio.wait_for(hearing_started.wait(), timeout=5)
    orchestrator.interrupt_speaker(ROOM_ID, SPEAKER_ID)
    result = await task

    reasons = [tag["reason"] for tag in result.tags]
    hearing_audio = [tag["hearing_audio"] for tag in result.tags]
    print(f"[LOOP-B3] 配信された翻訳音声 : {len(sink.audio)} 件")
    print(f"[LOOP-B3] tags reason        : {reasons}")
    print(f"[LOOP-B3] tags hearing_audio : {hearing_audio}")

    if not sink.audio:
        print("[LOOP-B3] RED: 進行中発話の翻訳音声が破棄された（ユーザー症状）")
        return 1
    print("[LOOP-B3] GREEN: 進行中発話の翻訳音声が配信された")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
