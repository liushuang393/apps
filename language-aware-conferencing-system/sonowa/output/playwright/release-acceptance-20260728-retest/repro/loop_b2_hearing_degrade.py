"""[debug harness] 翻訳音声が字幕へ縮退する症状の再現ループ（ブロッカー4）。

目的:
    受入時の症状「翻訳音声が届かず全員が字幕へ縮退し復帰しない」を、LiveKit と DB を
    介さずに Agent 実処理と同じ順序で再現する。

再現する経路（agent.py と同じ順序）:
    1. 確定発話の受理 → on_final_accepted → orchestrator.interrupt_speaker
    2. QoEStateMachine.evaluate（hearing_degraded = monitor.hearing_p95_exceeded()）
    3. orchestrator.orchestrate（聞く主線＝実 provider / 読む主線＝実 MT）

実行:
    docker cp <wav> lams-mvp-backend-1:/tmp/loop_b.wav
    docker compose exec -T backend python - < loop_b2_hearing_degrade.py

判定:
    exit 0 = 緑（全発話で翻訳音声が届き、hearing が無効化されない）
    exit 1 = 赤（翻訳音声欠落 or hearing 無効化＝ユーザー症状）

注意:
    使い捨てのデバッグ用ハーネス。秘密値は出力しない。
"""

from __future__ import annotations

import asyncio
import pathlib
import sys

WAV_PATH = pathlib.Path("/tmp/loop_b.wav")
SOURCE_LANG = "ja"
TARGET_LANGS = ("en", "vi")
ORIGINAL_TEXT = "これはリリース受け入れテストです。"
UTTERANCE_COUNT = 4
ROOM_ID = "loop-b2-room"
SPEAKER_ID = "loop-b2-speaker"


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


async def main() -> int:
    """発話を連続投入し、翻訳音声の到達と hearing 可用性を判定する。"""
    from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener
    from app.ai_pipeline.qoe import QoEInput, QoEScope, QoEStateMachine
    from app.ai_pipeline.qos import HybridQoSMonitor

    if not WAV_PATH.exists():
        print(f"[LOOP-B2] 前提失敗: {WAV_PATH} が無い")
        return 1
    wav = WAV_PATH.read_bytes()

    monitor = HybridQoSMonitor()
    orchestrator = HybridOrchestrator(monitor=monitor)
    qoe_machine = QoEStateMachine()
    listeners = [
        Listener(
            user_id=f"listener-{lang}",
            target_language=lang,
            wants_audio=True,
            subtitle_enabled=True,
        )
        for lang in TARGET_LANGS
    ]

    failures: list[str] = []
    for index in range(1, UTTERANCE_COUNT + 1):
        sink = CaptureSink()
        # ① 確定発話の受理（producer 側 barge-in）
        orchestrator.interrupt_speaker(ROOM_ID, SPEAKER_ID)
        # ② QoE 評価（agent._evaluate_server_qoe と同じ入力）
        decision = qoe_machine.evaluate(
            QoEInput(
                queue_overloaded=False,
                hearing_degraded=monitor.hearing_p95_exceeded(),
                provider_recovering=orchestrator.is_provider_recovering(SPEAKER_ID),
                scope=QoEScope.SERVER,
            )
        )
        # ③ 2 主線の駆動
        result = await orchestrator.orchestrate(
            audio_bytes=wav,
            source_language=SOURCE_LANG,
            original_text=ORIGINAL_TEXT,
            listeners=listeners,
            sink=sink,
            mode="a",
            subtitle_id=f"utt-{index}",
            seq=index,
            speaker_id=SPEAKER_ID,
            room_id=ROOM_ID,
            qoe_decision=decision,
        )
        reasons = [tag["reason"] for tag in result.tags]
        p95 = monitor.p95("hearing")
        print(
            f"[LOOP-B2] utt={index} hearing_available={decision.hearing_available} "
            f"state={decision.state.value} audio={len(sink.audio)} "
            f"reasons={reasons} hearing_p95={None if p95 is None else round(p95)}ms"
        )
        if not decision.hearing_available:
            failures.append(f"utt={index}: hearing が無効化されている（字幕へ縮退）")
        if len(sink.audio) < len(TARGET_LANGS):
            failures.append(
                f"utt={index}: 翻訳音声が {len(sink.audio)}/{len(TARGET_LANGS)} 件しか届かない"
            )

    print(f"[LOOP-B2] hearing_p95_exceeded={monitor.hearing_p95_exceeded()}")
    if failures:
        print("[LOOP-B2] RED:")
        for line in failures:
            print(f"          - {line}")
        return 1
    print("[LOOP-B2] GREEN: 全発話で翻訳音声が届き hearing は有効")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
