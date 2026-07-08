"""VRAM Broker v1 の単体テスト（予算会計・優先度退避・バージョン・アイドル卸載）。"""

import pytest

from app.ai_pipeline.vram_broker import (
    PRIORITY_ASR,
    PRIORITY_LLM,
    PRIORITY_MT,
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
            "mt:x", loader=_loader("new"), size_mb=100, priority=PRIORITY_MT,
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
            "asr:x", loader=_loader("asr"), size_mb=400, priority=PRIORITY_ASR,
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
            "llm:x", loader=_loader("llm"), size_mb=400, priority=PRIORITY_LLM,
            version="v1",
        )


@pytest.mark.asyncio
async def test_request_over_budget_raises() -> None:
    broker = VRAMBroker(budget_mb=500)
    with pytest.raises(VRAMCapacityError):
        await broker.get_or_load(
            "asr:x", loader=_loader("asr"), size_mb=600, priority=PRIORITY_ASR,
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
async def test_close_called_on_evict() -> None:
    broker = VRAMBroker(budget_mb=1000)
    closed = []

    class Model:
        def close(self) -> None:
            closed.append(True)

    await broker.warmup(
        "llm:x", loader=lambda: Model(), size_mb=800, priority=PRIORITY_LLM,
        version="v1",
    )
    await broker.get_or_load(
        "asr:x", loader=_loader("asr"), size_mb=400, priority=PRIORITY_ASR, version="v1"
    )
    assert closed == [True]
