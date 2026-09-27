"""
初期ユーザー投入（app.auth.seed_users）の単体テスト。

方針:
    - DB は FakeSession（execute は email 検索のみ、add / commit を記録）。
    - 新規作成・既存は不変・--reset-password・ロール補正・短いパスワード拒否を検証する。
"""

import asyncio

import pytest

from app.auth.jwt_handler import verify_password
from app.auth.seed_users import SeedSpec, resolve_password, upsert_user
from app.db.models import User


class _Result:
    def __init__(self, user: User | None) -> None:
        self._user = user

    def scalar_one_or_none(self) -> User | None:
        return self._user


class _FakeSession:
    """email で 1 件だけ引ける最小セッション。"""

    def __init__(self, existing: User | None = None) -> None:
        self.existing = existing
        self.added: list[User] = []
        self.committed = False

    async def execute(self, _stmt: object) -> _Result:
        return _Result(self.existing)

    def add(self, obj: User) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.committed = True


def _spec(role: str = "admin") -> SeedSpec:
    return SeedSpec(
        email="demo.admin@example.com",
        display_name="Demo Admin",
        native_language="ja",
        role=role,
        password="Passw0rd-seed",
    )


def _existing(role: str = "user") -> User:
    return User(
        id="u1",
        email="demo.admin@example.com",
        password_hash="old-hash",
        display_name="Old",
        native_language="en",
        role=role,
        is_active=False,
        token_version=3,
    )


def test_creates_new_user_with_role_and_hash() -> None:
    db = _FakeSession()
    status = asyncio.run(upsert_user(db, _spec(), reset_password=False))
    assert status == "created"
    assert db.committed
    user = db.added[0]
    assert user.role == "admin"
    assert user.native_language == "ja"
    assert verify_password("Passw0rd-seed", user.password_hash)


def test_existing_user_keeps_password_but_fixes_role_and_active() -> None:
    user = _existing()
    db = _FakeSession(existing=user)
    status = asyncio.run(upsert_user(db, _spec(), reset_password=False))
    assert status == "updated"
    assert user.password_hash == "old-hash"
    assert user.role == "admin"
    assert user.is_active is True
    assert user.token_version == 3
    assert not db.added


def test_reset_password_rehashes_and_revokes_sessions() -> None:
    user = _existing(role="admin")
    user.is_active = True
    db = _FakeSession(existing=user)
    status = asyncio.run(upsert_user(db, _spec(), reset_password=True))
    assert status == "password-reset"
    assert verify_password("Passw0rd-seed", user.password_hash)
    assert user.token_version == 4


def test_unchanged_when_nothing_to_do() -> None:
    user = _existing(role="admin")
    user.is_active = True
    db = _FakeSession(existing=user)
    assert asyncio.run(upsert_user(db, _spec(), reset_password=False)) == "unchanged"


def test_resolve_password_uses_env_or_generates() -> None:
    assert resolve_password("Given-pass-123") == ("Given-pass-123", False)
    generated, is_generated = resolve_password(None)
    assert is_generated
    assert len(generated) >= 8
    assert resolve_password(None)[0] != generated


def test_resolve_password_rejects_short() -> None:
    with pytest.raises(ValueError):
        resolve_password("short")
