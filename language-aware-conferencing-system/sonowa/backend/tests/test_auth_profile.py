"""
自己プロフィール更新（PATCH /api/auth/me）の単体テスト。

対象: app.auth.routes.update_me
方針:
    - DB は FakeSession。JWT 再発行は decode_token で検証する。
    - 空更新・空表示名・不正言語は 400。
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import decode_token
from app.auth.routes import UserSelfUpdate, update_me
from app.db.models import User


class _FakeSession:
    """commit / refresh だけを記録する最小セッション。"""

    def __init__(self) -> None:
        self.committed = False
        self.refreshed: list[object] = []

    async def commit(self) -> None:
        self.committed = True

    async def refresh(self, obj: object) -> None:
        self.refreshed.append(obj)


def _user() -> User:
    return User(
        id="u1",
        email="a@example.com",
        password_hash="x",
        display_name="旧名",
        native_language="ja",
        role="user",
        is_active=True,
    )


def test_update_me_reissues_token_with_new_native_language() -> None:
    """母語更新後の JWT に新しい native_language が入る。"""
    user = _user()
    db = _FakeSession()
    result = asyncio.run(
        update_me(UserSelfUpdate(native_language="en"), user=user, db=db)
    )
    assert result.user.native_language == "en"
    assert result.user.display_name == "旧名"
    token = decode_token(result.access_token)
    assert token is not None
    assert token.native_language == "en"
    assert token.user_id == "u1"
    assert db.committed is True


def test_update_me_changes_display_name() -> None:
    """表示名だけ更新できる。"""
    user = _user()
    result = asyncio.run(
        update_me(UserSelfUpdate(display_name=" 新名 "), user=user, db=_FakeSession())
    )
    assert result.user.display_name == "新名"
    assert result.user.native_language == "ja"


def test_update_me_rejects_empty_payload() -> None:
    """フィールド未指定は 400。"""
    with pytest.raises(HTTPException) as exc:
        asyncio.run(update_me(UserSelfUpdate(), user=_user(), db=_FakeSession()))
    assert exc.value.status_code == 400


def test_update_me_rejects_blank_display_name() -> None:
    """空白のみの表示名は 400。"""
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            update_me(
                UserSelfUpdate(display_name="  "), user=_user(), db=_FakeSession()
            )
        )
    assert exc.value.status_code == 400


def test_update_me_rejects_unknown_language() -> None:
    """未対応言語は 400。"""
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            update_me(
                UserSelfUpdate(native_language="xx"), user=_user(), db=_FakeSession()
            )
        )
    assert exc.value.status_code == 400
