"""パスワード再設定トークンの発行（共通処理・管理者発行 API）を検証する。"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.admin.routes import issue_user_password_reset
from app.auth.routes import RESET_TOKEN_TTL, issue_reset_token
from app.db.models import PasswordResetToken


def _db(first_result: object) -> Mock:
    """execute の1回目に first_result、2回目に未使用トークン一覧を返す偽セッション。"""
    old = Mock(used=False)
    tokens = Mock()
    tokens.scalars.return_value = [old]
    db = Mock()
    db.execute = AsyncMock(side_effect=[first_result, tokens])
    db.commit = AsyncMock()
    db.old_token = old
    return db


@pytest.mark.asyncio
async def test_issue_invalidates_old_tokens_and_expires_in_one_hour() -> None:
    """古い未使用トークンを無効化し、1時間有効な新トークンを保存する。"""
    tokens = Mock()
    old = Mock(used=False)
    tokens.scalars.return_value = [old]
    db = Mock(execute=AsyncMock(return_value=tokens), commit=AsyncMock())
    user = Mock(id="u1")

    token = await issue_reset_token(db, user)

    assert len(token) >= 60
    assert old.used is True
    saved = db.add.call_args.args[0]
    assert isinstance(saved, PasswordResetToken)
    assert saved.user_id == "u1" and saved.token == token
    remaining = saved.expires_at - datetime.now(timezone.utc)
    assert RESET_TOKEN_TTL.total_seconds() - 60 < remaining.total_seconds()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_admin_issues_token_for_existing_user() -> None:
    """管理者はメール無しでも本人へ渡す再設定トークンを得られる。"""
    found = Mock()
    found.scalar_one_or_none.return_value = Mock(id="u1")
    db = _db(found)

    response = await issue_user_password_reset("u1", _admin=Mock(), db=db)

    assert response.reset_token and response.expires_in_minutes == 60
    assert db.old_token.used is True


@pytest.mark.asyncio
async def test_admin_reset_for_unknown_user_is_404() -> None:
    """存在しない利用者にはトークンを発行しない。"""
    missing = Mock()
    missing.scalar_one_or_none.return_value = None
    db = _db(missing)

    with pytest.raises(HTTPException) as err:
        await issue_user_password_reset("nope", _admin=Mock(), db=db)
    assert err.value.status_code == 404
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_change_own_password_requires_current_password() -> None:
    """ログイン中の本人は、現在のパスワードが正しいときだけ変更できる。"""
    from app.auth.jwt_handler import hash_password, verify_password
    from app.auth.routes import PasswordChange, change_my_password

    user = Mock(
        id="u1",
        email="a@example.com",
        display_name="A",
        native_language="ja",
        role="user",
        is_active=True,
        token_version=0,
        password_hash=hash_password("Current-Pass-1"),
    )
    db = Mock(commit=AsyncMock())

    with pytest.raises(HTTPException) as err:
        await change_my_password(
            PasswordChange(current_password="wrong-pass", new_password="Brand-New-2"),
            user=user,
            db=db,
        )
    assert err.value.status_code == 400
    db.commit.assert_not_awaited()

    result = await change_my_password(
        PasswordChange(current_password="Current-Pass-1", new_password="Brand-New-2"),
        user=user,
        db=db,
    )
    assert result.access_token
    assert verify_password("Brand-New-2", user.password_hash)
    db.commit.assert_awaited_once()


def test_new_passwords_must_be_at_least_8_characters() -> None:
    """登録・再設定・変更のいずれも 8 文字未満のパスワードを受け付けない。"""
    from pydantic import ValidationError

    from app.auth.routes import PasswordChange, PasswordResetConfirm, UserCreate

    with pytest.raises(ValidationError):
        PasswordChange(current_password="whatever", new_password="short")
    with pytest.raises(ValidationError):
        PasswordResetConfirm(token="t", new_password="short")
    with pytest.raises(ValidationError):
        UserCreate(email="a@example.com", password="short", display_name="A")


@pytest.mark.asyncio
async def test_forgot_password_returns_token_in_production_for_self_reset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """本番でも本人がその場で再設定できるよう、トークンを返す（メール送信が無いため）。"""
    from app.auth.routes import PasswordResetRequest, request_password_reset
    from app.config import settings

    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "password_reset_self_service", True)
    found = Mock()
    found.scalar_one_or_none.return_value = Mock(id="u1")
    db = _db(found)

    response = await request_password_reset(
        PasswordResetRequest(email="a@example.com"), db=db
    )

    assert response.reset_token


@pytest.mark.asyncio
async def test_forgot_password_unknown_email_is_reported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """本人がその場で再設定する方式では、未登録アドレスをはっきり伝える。"""
    from app.auth.routes import PasswordResetRequest, request_password_reset
    from app.config import settings

    monkeypatch.setattr(settings, "password_reset_self_service", True)
    missing = Mock()
    missing.scalar_one_or_none.return_value = None
    db = _db(missing)

    with pytest.raises(HTTPException) as err:
        await request_password_reset(
            PasswordResetRequest(email="no@example.com"), db=db
        )
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_self_service_off_hides_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """メール送信を導入して本人再設定を止めた場合は、トークンを応答に含めない。"""
    from app.auth.routes import PasswordResetRequest, request_password_reset
    from app.config import settings

    monkeypatch.setattr(settings, "password_reset_self_service", False)
    found = Mock()
    found.scalar_one_or_none.return_value = Mock(id="u1")
    db = _db(found)

    response = await request_password_reset(
        PasswordResetRequest(email="a@example.com"), db=db
    )

    assert response.reset_token is None


def _bearer(token: str) -> Mock:
    """HTTPBearer が返す資格情報の代わり。"""
    return Mock(credentials=token)


def _db_returning(user: object) -> Mock:
    """User 検索の結果として user を返す偽セッション。"""
    found = Mock()
    found.scalar_one_or_none.return_value = user
    return Mock(execute=AsyncMock(return_value=found), commit=AsyncMock())


@pytest.mark.asyncio
async def test_password_change_revokes_old_tokens_and_reissues_one() -> None:
    """変更前のトークンは失効し、変更した端末には新しいトークンが返る。"""
    from app.auth.dependencies import get_current_user
    from app.auth.jwt_handler import hash_password
    from app.auth.routes import PasswordChange, _build_auth_response, change_my_password

    user = Mock(
        id="u1",
        email="a@example.com",
        display_name="A",
        native_language="ja",
        role="user",
        is_active=True,
        token_version=0,
        password_hash=hash_password("Current-Pass-1"),
    )
    old_token = _build_auth_response(user).access_token

    result = await change_my_password(
        PasswordChange(current_password="Current-Pass-1", new_password="Brand-New-2"),
        user=user,
        db=Mock(commit=AsyncMock()),
    )

    with pytest.raises(HTTPException) as err:
        await get_current_user(_bearer(old_token), db=_db_returning(user))
    assert err.value.status_code == 401
    assert (
        await get_current_user(_bearer(result.access_token), db=_db_returning(user))
        is user
    )


@pytest.mark.asyncio
async def test_password_reset_revokes_old_tokens() -> None:
    """再設定でパスワードを変えると、それ以前のトークンは使えなくなる。"""
    from app.auth.dependencies import get_current_user
    from app.auth.routes import (
        PasswordResetConfirm,
        _build_auth_response,
        confirm_password_reset,
    )

    user = Mock(
        id="u1",
        email="a@example.com",
        display_name="A",
        native_language="ja",
        role="user",
        is_active=True,
        token_version=0,
    )
    old_token = _build_auth_response(user).access_token
    reset = Mock(
        used=False,
        user_id="u1",
        expires_at=datetime.now(timezone.utc) + RESET_TOKEN_TTL,
    )
    token_found = Mock()
    token_found.scalar_one_or_none.return_value = reset
    user_found = Mock()
    user_found.scalar_one_or_none.return_value = user
    db = Mock(
        execute=AsyncMock(side_effect=[token_found, user_found]), commit=AsyncMock()
    )

    await confirm_password_reset(
        PasswordResetConfirm(token="t", new_password="Brand-New-2"), db=db
    )

    with pytest.raises(HTTPException) as err:
        await get_current_user(_bearer(old_token), db=_db_returning(user))
    assert err.value.status_code == 401


@pytest.mark.asyncio
async def test_token_without_version_claim_is_version_zero() -> None:
    """デプロイ前に発行されたトークン（tv なし）は、未変更のユーザーなら有効のまま。"""
    from app.auth.dependencies import get_current_user
    from app.auth.jwt_handler import create_access_token

    user = Mock(id="u1", is_active=True, token_version=0)
    legacy = create_access_token({"user_id": "u1", "email": "a@example.com"})

    assert await get_current_user(_bearer(legacy), db=_db_returning(user)) is user
