"""ASR/MT の共有モデルと非クラウド失敗契約を検証する。"""

import asyncio
import threading
import time

import pytest

from app.ai_pipeline.providers.local_multimodal import (
    ENGINE_CACHE_KEY,
    LocalInferenceEngine,
    LocalMultimodalStage,
)
from app.ai_pipeline.vram_broker import PRIORITY_TTS, VRAMBroker
from app.audio.pcm import wrap_wav16


@pytest.mark.asyncio
async def test_simultaneous_identical_mt_shares_work_but_not_completed_results() -> (
    None
):
    """字幕と音声の同時翻訳は一度だけ推論し、完了後は原文を保持しない。"""
    calls = 0

    def infer(_prompt: str, _audio: object) -> str:
        nonlocal calls
        calls += 1
        time.sleep(0.05)
        return "Do not send the file."

    engine = LocalInferenceEngine(infer, lambda: None)
    broker = VRAMBroker(budget_mb=7500)
    stages = [LocalMultimodalStage(engine=engine, broker=broker) for _ in range(2)]
    results = await asyncio.gather(
        *(stage.translate_text("送らないでください", "ja", "en") for stage in stages)
    )
    assert results == ["Do not send the file."] * 2
    assert calls == 1
    await stages[0].translate_text("送らないでください", "ja", "en")
    assert calls == 2


@pytest.mark.asyncio
async def test_cancelled_mt_waiter_does_not_cancel_other_waiter() -> None:
    """片方の主線が取消されても、共有翻訳ともう片方の主線を継続する。"""
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def infer(_prompt: str, _audio: object) -> str:
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(timeout=3)
        return "Do not send."

    engine = LocalInferenceEngine(infer, lambda: None)
    broker = VRAMBroker(budget_mb=7500)
    stage = LocalMultimodalStage(engine=engine, broker=broker)
    first = asyncio.create_task(stage.translate_text("送らないで", "ja", "en"))
    assert await asyncio.to_thread(started.wait, 3)
    second = asyncio.create_task(stage.translate_text("送らないで", "ja", "en"))
    await asyncio.sleep(0)
    first.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert await second == "Do not send."
    assert calls == 1


@pytest.mark.asyncio
async def test_asr_and_mt_share_one_resident_model() -> None:
    """別ステージからの ASR/MT 呼び出しが同じモデル常駐を再利用する。"""
    calls: list[str] = []

    def infer(prompt: str, audio: object) -> str:
        calls.append(prompt)
        return "会議は10時です" if audio is not None else "The meeting is at 10."

    engine = LocalInferenceEngine(infer, lambda: None)
    broker = VRAMBroker(budget_mb=7500, allow_idle_preemption=True)
    asr = LocalMultimodalStage(engine=engine, broker=broker)
    mt = LocalMultimodalStage(engine=engine, broker=broker)
    wav = wrap_wav16(b"\x00\x01" * 16000, 16000)
    assert await asr.transcribe_audio(wav, "ja") == "会議は10時です"
    assert (
        await mt.translate_text("会議は10時です", "ja", "en") == "The meeting is at 10."
    )
    assert broker.resident_keys() == [ENGINE_CACHE_KEY]
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_shared_engine_serializes_concurrent_inference() -> None:
    """複数部屋から同じモデルへ来る推論が内部キャッシュを競合させない。"""
    active = 0
    maximum = 0
    counter_lock = threading.Lock()

    def infer(prompt: str, _audio: object) -> str:
        nonlocal active, maximum
        with counter_lock:
            active += 1
            maximum = max(maximum, active)
        time.sleep(0.02)
        with counter_lock:
            active -= 1
        return prompt

    engine = LocalInferenceEngine(infer, lambda: None)
    results = await asyncio.gather(
        *(asyncio.to_thread(engine.generate, str(i), None) for i in range(3))
    )
    assert results == ["0", "1", "2"]
    assert maximum == 1


@pytest.mark.asyncio
async def test_asr_waits_for_in_flight_tts_instead_of_losing_speech() -> None:
    """別話者の TTS 実行中に受けた発話も、解放を待って認識する。"""
    broker = VRAMBroker(budget_mb=7500, allow_idle_preemption=True)
    await broker.get_or_load(
        "tts", loader=object, size_mb=7500, priority=PRIORITY_TTS, version="v1"
    )
    engine = LocalInferenceEngine(lambda _p, _a: "こんにちは", lambda: None)
    stage = LocalMultimodalStage(engine=engine, broker=broker)
    task = asyncio.create_task(
        stage.transcribe_audio(wrap_wav16(bytes(32000), 16000), "ja")
    )
    await asyncio.sleep(0)
    assert not task.done()
    await broker.release("tts")
    assert await task == "こんにちは"


@pytest.mark.asyncio
@pytest.mark.parametrize("response", ["bad json", '{"language":"xx","text":"x"}'])
async def test_invalid_detection_never_invents_a_transcript(response: str) -> None:
    """壊れた検出応答は空原文に縮退し、クラウド再試行しない。"""
    engine = LocalInferenceEngine(lambda _p, _a: response, lambda: None)
    stage = LocalMultimodalStage(engine=engine, broker=VRAMBroker(budget_mb=7500))
    wav = wrap_wav16(b"\x00\x01" * 16000, 16000)
    assert await stage.transcribe_with_detection(wav, "ja") == ("", "ja")


@pytest.mark.asyncio
async def test_detection_returns_validated_language_and_text() -> None:
    """母語ヒントと異なる発話言語も、モデルの構造化出力から返す。"""
    engine = LocalInferenceEngine(
        lambda _p, _a: '{"language":"en","text":"Do not send 10 files."}',
        lambda: None,
    )
    stage = LocalMultimodalStage(engine=engine, broker=VRAMBroker(budget_mb=7500))
    wav = wrap_wav16(b"\x00\x01" * 16000, 16000)
    assert await stage.transcribe_with_detection(wav, "ja") == (
        "Do not send 10 files.",
        "en",
    )


@pytest.mark.asyncio
async def test_long_audio_and_vram_shortage_do_not_invoke_model() -> None:
    """上限超過音声と予算不足はモデル実行前に拒否する。"""
    calls: list[str] = []
    engine = LocalInferenceEngine(lambda p, _a: calls.append(p) or "bad", lambda: None)
    stage = LocalMultimodalStage(engine=engine, broker=VRAMBroker(budget_mb=1))
    assert await stage.translate_text("hello", "en", "ja") == ""
    wav = wrap_wav16(bytes(16000 * 2 * 31), 16000)
    assert await stage.transcribe_audio(wav, "en") == ""
    assert calls == []


def test_closed_engine_releases_references_and_cannot_run() -> None:
    """退避は解放処理を一度実行し、解放済みモデルの再使用を拒否する。"""
    released: list[bool] = []
    engine = LocalInferenceEngine(lambda _p, _a: "x", lambda: released.append(True))
    engine.close()
    engine.close()
    assert released == [True]
    with pytest.raises(RuntimeError, match="解放"):
        engine.generate("x", None)


@pytest.mark.asyncio
async def test_cancellation_waits_for_gpu_worker_before_releasing_model() -> None:
    """要求をキャンセルしても実推論が終わるまでモデルを退避可能にしない。"""
    started, finish = threading.Event(), threading.Event()

    def infer(_prompt: str, _audio: object) -> str:
        started.set()
        finish.wait(timeout=2)
        return "done"

    engine = LocalInferenceEngine(infer, lambda: None)
    stage = LocalMultimodalStage(engine=engine, broker=VRAMBroker(budget_mb=7500))
    task = asyncio.create_task(stage.translate_text("hello", "en", "ja"))
    assert await asyncio.to_thread(started.wait, 1)
    task.cancel()
    try:
        await asyncio.sleep(0.02)
        assert not task.done(), "GPU ワーカーより先に要求がモデルを解放しました"
    finally:
        finish.set()
        await asyncio.gather(task, return_exceptions=True)
