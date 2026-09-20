"""VRAM Broker v1 の単体テスト（予算会計・優先度退避・バージョン・アイドル卸載）。"""

import asyncio
import threading

import pytest
from app.ai_pipeline.vram_broker import (
    PRIORITY_ASR,
    PRIORITY_LLM,
    PRIORITY_MT,
    PRIORITY_TTS,
    VRAMBroker,
    VRAMCapacityError,
)


class FakeClock:
    """テスト用の手動時計。"""

    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def _loader(tag: str):
    """タグ付きダミーモデルを返す loader を作る。"""
    return lambda: {"tag": tag}


@pytest.mark.asyncio
async def test_cancelled_load_keeps_lock_until_model_can_be_accounted() -> None:
    """ロード取消でも実スレッドの完了を待ち、生成モデルを idle として管理する。"""
    broker = VRAMBroker(budget_mb=1000)
    started = threading.Event()
    finish = threading.Event()
    model = object()

    def load() -> object:
        started.set()
        assert finish.wait(timeout=5)
        return model

    task = asyncio.create_task(
        broker.get_or_load(
            "asr:x", loader=load, size_mb=800, priority=PRIORITY_ASR, version="v1"
        )
    )
    try:
        assert await asyncio.to_thread(started.wait, 5)
        task.cancel()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not task.done()
        assert broker._lock.locked()
    finally:
        finish.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert broker.used_mb == 800
    assert broker._entries["asr:x"].refs == 0
    assert broker._entries["asr:x"].model is model
    await broker.warmup(
        "asr:y", loader=object, size_mb=800, priority=PRIORITY_ASR, version="v1"
    )
    assert broker.resident_keys() == ["asr:y"]


@pytest.mark.asyncio
async def test_get_or_load_caches_same_version() -> None:
    broker = VRAMBroker(budget_mb=1000)
    m1 = await broker.get_or_load(
        "asr:x", loader=_loader("a"), size_mb=100, priority=PRIORITY_ASR, version="v1"
    )
    # 同一 version の再取得は同一実体（再ロードしない）。
    m2 = await broker.get_or_load(
        "asr:x", loader=_loader("b"), size_mb=100, priority=PRIORITY_ASR, version="v1"
    )
    assert m1 is m2
    assert m1["tag"] == "a"
    assert broker.used_mb == 100


@pytest.mark.asyncio
async def test_waiting_tts_loads_after_parallel_asr_releases() -> None:
    """並行字幕が使用中のモデルを解放するまで TTS が待機する。"""
    broker = VRAMBroker(budget_mb=1000, allow_idle_preemption=True)
    await broker.get_or_load(
        "asr", loader=object, size_mb=800, priority=PRIORITY_ASR, version="v1"
    )
    task = asyncio.create_task(
        broker.get_or_load(
            "tts",
            loader=object,
            size_mb=800,
            priority=PRIORITY_TTS,
            version="v1",
            wait_timeout=2,
        )
    )
    await asyncio.sleep(0)
    assert not task.done()
    assert broker.resident_keys() == ["asr"]
    await broker.release("asr")
    await task
    assert broker.resident_keys() == ["tts"]


@pytest.mark.asyncio
async def test_capacity_wait_is_bounded() -> None:
    """使用中モデルが解放されない場合も待機上限で明示エラーにする。"""
    broker = VRAMBroker(budget_mb=1000, allow_idle_preemption=True)
    await broker.get_or_load(
        "asr", loader=object, size_mb=800, priority=PRIORITY_ASR, version="v1"
    )
    with pytest.raises(VRAMCapacityError, match="待機"):
        await broker.get_or_load(
            "tts",
            loader=object,
            size_mb=800,
            priority=PRIORITY_TTS,
            version="v1",
            wait_timeout=0.01,
        )
    assert broker.resident_keys() == ["asr"]


@pytest.mark.asyncio
async def test_version_change_reloads_when_idle() -> None:
    broker = VRAMBroker(budget_mb=1000)
    await broker.warmup(
        "mt:x", loader=_loader("old"), size_mb=100, priority=PRIORITY_MT, version="v1"
    )
    m = await broker.get_or_load(
        "mt:x", loader=_loader("new"), size_mb=100, priority=PRIORITY_MT, version="v2"
    )
    assert m["tag"] == "new"


@pytest.mark.asyncio
async def test_version_change_blocked_while_in_use() -> None:
    broker = VRAMBroker(budget_mb=1000)
    await broker.get_or_load(
        "mt:x", loader=_loader("old"), size_mb=100, priority=PRIORITY_MT, version="v1"
    )  # refs=1（未 release）
    with pytest.raises(VRAMCapacityError):
        await broker.get_or_load(
            "mt:x",
            loader=_loader("new"),
            size_mb=100,
            priority=PRIORITY_MT,
            version="v2",
        )


@pytest.mark.asyncio
async def test_evicts_lower_priority_idle_under_pressure() -> None:
    clock = FakeClock()
    broker = VRAMBroker(budget_mb=1000, clock=clock)
    # 低優先度 LLM を 800MB 常駐（idle）。
    await broker.warmup(
        "llm:x", loader=_loader("llm"), size_mb=800, priority=PRIORITY_LLM, version="v1"
    )
    clock.t = 1.0
    # 高優先度 ASR 400MB を要求 → 予算超過で LLM を退避して確保。
    await broker.get_or_load(
        "asr:x", loader=_loader("asr"), size_mb=400, priority=PRIORITY_ASR, version="v1"
    )
    assert "asr:x" in broker.resident_keys()
    assert "llm:x" not in broker.resident_keys()
    assert broker.used_mb == 400


@pytest.mark.asyncio
async def test_in_use_model_not_evicted() -> None:
    broker = VRAMBroker(budget_mb=1000)
    # 使用中（refs>0）の LLM は退避されない。
    await broker.get_or_load(
        "llm:x", loader=_loader("llm"), size_mb=800, priority=PRIORITY_LLM, version="v1"
    )
    with pytest.raises(VRAMCapacityError):
        await broker.get_or_load(
            "asr:x",
            loader=_loader("asr"),
            size_mb=400,
            priority=PRIORITY_ASR,
            version="v1",
        )


@pytest.mark.asyncio
async def test_higher_priority_not_evicted_by_lower() -> None:
    broker = VRAMBroker(budget_mb=1000)
    await broker.warmup(
        "asr:x", loader=_loader("asr"), size_mb=800, priority=PRIORITY_ASR, version="v1"
    )
    # 低優先度 LLM は高優先度 ASR(idle) を退避できない。
    with pytest.raises(VRAMCapacityError):
        await broker.get_or_load(
            "llm:x",
            loader=_loader("llm"),
            size_mb=400,
            priority=PRIORITY_LLM,
            version="v1",
        )


@pytest.mark.asyncio
async def test_request_over_budget_raises() -> None:
    broker = VRAMBroker(budget_mb=500)
    with pytest.raises(VRAMCapacityError):
        await broker.get_or_load(
            "asr:x",
            loader=_loader("asr"),
            size_mb=600,
            priority=PRIORITY_ASR,
            version="v1",
        )


@pytest.mark.asyncio
async def test_use_context_releases() -> None:
    broker = VRAMBroker(budget_mb=1000)
    async with broker.use(
        "asr:x", loader=_loader("asr"), size_mb=400, priority=PRIORITY_ASR, version="v1"
    ) as model:
        assert model["tag"] == "asr"
    # release 後は refs==0 → 退避候補になり、別モデルが確保可能。
    await broker.get_or_load(
        "asr:y", loader=_loader("y"), size_mb=800, priority=PRIORITY_ASR, version="v1"
    )
    assert "asr:x" not in broker.resident_keys()


@pytest.mark.asyncio
async def test_unload_idle_by_ttl() -> None:
    clock = FakeClock()
    broker = VRAMBroker(budget_mb=1000, clock=clock)
    await broker.warmup(
        "mt:x", loader=_loader("mt"), size_mb=100, priority=PRIORITY_MT, version="v1"
    )
    clock.t = 5.0
    unloaded = await broker.unload_idle(max_idle_s=3.0)
    assert unloaded == ["mt:x"]
    assert broker.used_mb == 0


@pytest.mark.asyncio
async def test_close_called_on_version_change() -> None:
    broker = VRAMBroker(budget_mb=1000)
    closed = []

    class Model:
        def close(self) -> None:
            closed.append(True)

    await broker.warmup(
        "mt:x", loader=lambda: Model(), size_mb=100, priority=PRIORITY_MT, version="v1"
    )
    # バージョン更新（idle）で旧モデルの close が呼ばれる。
    await broker.get_or_load(
        "mt:x", loader=_loader("new"), size_mb=100, priority=PRIORITY_MT, version="v2"
    )
    assert closed == [True]


@pytest.mark.asyncio
async def test_local_cascade_can_swap_idle_stages_within_budget() -> None:
    """逐次ローカル処理は ASR→MT→TTS→次の ASR を予算内で完走する。"""
    broker = VRAMBroker(budget_mb=7500, allow_idle_preemption=True)
    for key, size, priority in [
        ("asr", 1500, PRIORITY_ASR),
        ("mt", 2500, PRIORITY_MT),
        ("tts", 7500, PRIORITY_TTS),
        ("asr", 1500, PRIORITY_ASR),
        ("mt", 2500, PRIORITY_MT),
    ]:
        async with broker.use(
            key, loader=_loader(key), size_mb=size, priority=priority, version="v1"
        ):
            assert broker.used_mb <= broker.budget_mb


@pytest.mark.asyncio
async def test_local_preemption_never_evicts_active_model() -> None:
    """段階入れ替えを許可しても推論中の参照は保護する。"""
    broker = VRAMBroker(budget_mb=7500, allow_idle_preemption=True)
    async with broker.use(
        "asr", loader=_loader("asr"), size_mb=1500, priority=PRIORITY_ASR, version="v1"
    ):
        with pytest.raises(VRAMCapacityError):
            await broker.get_or_load(
                "tts",
                loader=_loader("tts"),
                size_mb=7500,
                priority=PRIORITY_TTS,
                version="v1",
            )


@pytest.mark.asyncio
async def test_close_called_on_evict() -> None:
    broker = VRAMBroker(budget_mb=1000)
    closed = []

    class Model:
        def close(self) -> None:
            closed.append(True)

    await broker.warmup(
        "llm:x",
        loader=lambda: Model(),
        size_mb=800,
        priority=PRIORITY_LLM,
        version="v1",
    )
    await broker.get_or_load(
        "asr:x", loader=_loader("asr"), size_mb=400, priority=PRIORITY_ASR, version="v1"
    )
    assert closed == [True]
