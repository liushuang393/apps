"""TTS 音色クローン同意判定（P4-B）の単体テスト：既定拒否・有効同意・失効・障害。"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.ai_pipeline import voice_consent
from app.db.models import Base, TTSConsent, utc_now


async def _setup(monkeypatch) -> async_sessionmaker:
    """in-memory sqlite を作り voice_consent.async_session を差し替える。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(voice_consent, "async_session", maker)
    return maker


async def _add_consent(maker, **kw) -> None:
    async with maker() as db:
        db.add(TTSConsent(**kw))
        await db.commit()


@pytest.mark.asyncio
async def test_no_record_denies(monkeypatch) -> None:
    """同意レコードが無ければ既定拒否（§4.4 無同意クローン禁止）。"""
    await _setup(monkeypatch)
    d = await voice_consent.check_clone_consent("u1", "v1")
    assert d.allowed is False and d.watermark_required is True


@pytest.mark.asyncio
async def test_granted_allows_with_watermark(monkeypatch) -> None:
    """有効同意（granted・未失効）→ 許可、透かし必須はレコード値を尊重。"""
    maker = await _setup(monkeypatch)
    await _add_consent(
        maker,
        user_id="u1",
        voice_id="v1",
        scope="meeting",
        granted=True,
        watermark_required=True,
        granted_at=utc_now(),
    )
    d = await voice_consent.check_clone_consent("u1", "v1")
    assert d.allowed is True and d.watermark_required is True and d.reason == "granted"


@pytest.mark.asyncio
async def test_not_granted_denies(monkeypatch) -> None:
    """granted=False は拒否。"""
    maker = await _setup(monkeypatch)
    await _add_consent(
        maker, user_id="u1", voice_id="v1", scope="meeting", granted=False
    )
    assert (await voice_consent.check_clone_consent("u1", "v1")).allowed is False


@pytest.mark.asyncio
async def test_revoked_denies(monkeypatch) -> None:
    """失効（revoked_at 設定済み）は拒否。"""
    maker = await _setup(monkeypatch)
    await _add_consent(
        maker,
        user_id="u1",
        voice_id="v1",
        scope="meeting",
        granted=True,
        granted_at=utc_now(),
        revoked_at=utc_now(),
    )
    assert (await voice_consent.check_clone_consent("u1", "v1")).allowed is False


@pytest.mark.asyncio
async def test_scope_mismatch_denies(monkeypatch) -> None:
    """スコープ不一致は拒否（用途限定）。"""
    maker = await _setup(monkeypatch)
    await _add_consent(
        maker,
        user_id="u1",
        voice_id="v1",
        scope="org",
        granted=True,
        granted_at=utc_now(),
    )
    # meeting スコープでは引けない
    assert (
        await voice_consent.check_clone_consent("u1", "v1", scope="meeting")
    ).allowed is False
    assert (
        await voice_consent.check_clone_consent("u1", "v1", scope="org")
    ).allowed is True


@pytest.mark.asyncio
async def test_watermark_optional_when_record_allows(monkeypatch) -> None:
    """watermark_required=False の同意はその値を返す（許可・透かし任意）。"""
    maker = await _setup(monkeypatch)
    await _add_consent(
        maker,
        user_id="u1",
        voice_id="v1",
        scope="meeting",
        granted=True,
        watermark_required=False,
        granted_at=utc_now(),
    )
    d = await voice_consent.check_clone_consent("u1", "v1")
    assert d.allowed is True and d.watermark_required is False


@pytest.mark.asyncio
async def test_missing_identifiers_denies(monkeypatch) -> None:
    """user_id/voice_id 欠落は拒否。"""
    await _setup(monkeypatch)
    assert (await voice_consent.check_clone_consent("", "v1")).allowed is False
    assert (await voice_consent.check_clone_consent("u1", "")).allowed is False


@pytest.mark.asyncio
async def test_db_error_fails_closed(monkeypatch) -> None:
    """DB 障害時は fail-closed（拒否）。"""

    class _Boom:
        def __call__(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(voice_consent, "async_session", _Boom())
    d = await voice_consent.check_clone_consent("u1", "v1")
    assert d.allowed is False and d.reason == "consent_check_error"
