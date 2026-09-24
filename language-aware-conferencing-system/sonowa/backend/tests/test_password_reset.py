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
