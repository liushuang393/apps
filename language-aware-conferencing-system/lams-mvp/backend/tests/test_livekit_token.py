"""
LiveKit 参加トークン（app.webrtc.token）と発行 API（rooms.routes）の単体テスト。

方針: I/O・LiveKit サーバ非依存。鍵は settings を monkeypatch で注入し、
発行 JWT を python-jose で復号して claims を検証する。エンドポイントは
FakeSession でハンドラを直接呼び、404/403/503/成功の各分岐を確認する。
"""

import pytest
from fastapi import HTTPException
from jose import jwt

from app.db.models import Room, User
from app.rooms import routes as room_routes
from app.rooms.routes import issue_livekit_token
from app.webrtc import token as tk
from app.webrtc.token import LiveKitNotConfiguredError, create_join_token

_KEY = "devkey"
_SECRET = "devsecret-0123456789-abcdefghij"


class _FakeResult:
    def __init__(self, value: object) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object:
        return self._value


class _FakeSession:
    def __init__(self, results: list[object]) -> None:
        self._results = list(results)

    async def execute(self, _query: object) -> _FakeResult:
        return _FakeResult(self._results.pop(0))


def _enable(monkeypatch: pytest.MonkeyPatch) -> None:
    """settings に LiveKit 鍵を注入して発行可能状態にする。"""
    monkeypatch.setattr(tk.settings, "livekit_api_key", _KEY)
    monkeypatch.setattr(tk.settings, "livekit_api_secret", _SECRET)
    monkeypatch.setattr(tk.settings, "livekit_agent_name", None)


def _room(**kw: object) -> Room:
    defaults: dict[str, object] = {"id": "room1", "creator_id": "owner"}
    defaults.update(kw)
    return Room(**defaults)


def _user(uid: str) -> User:
    return User(id=uid, display_name=f"name-{uid}")


def test_create_token_raises_when_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """鍵未設定なら LiveKitNotConfiguredError。"""
    monkeypatch.setattr(tk.settings, "livekit_api_key", None)
    monkeypatch.setattr(tk.settings, "livekit_api_secret", None)
    with pytest.raises(LiveKitNotConfiguredError):
        create_join_token(room_id="r", identity="u", display_name="U")


def test_create_token_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    """発行 JWT に room_join / room / identity が含まれる。"""
    _enable(monkeypatch)
    raw = create_join_token(room_id="room1", identity="u1", display_name="U1")
    claims = jwt.decode(
        raw, _SECRET, algorithms=["HS256"], options={"verify_aud": False}
    )
    assert claims["sub"] == "u1"
    assert claims["video"]["room"] == "room1"
    assert claims["video"]["roomJoin"] is True
    assert claims["video"]["canPublish"] is True
    # setAttributes（言語・音声モード同期）に必須。無いと入室が失敗扱いになる。
    assert claims["video"]["canUpdateOwnMetadata"] is True


@pytest.mark.asyncio
async def test_endpoint_success(monkeypatch: pytest.MonkeyPatch) -> None:
    """成功時は server_url と token を返す。"""
    _enable(monkeypatch)
    monkeypatch.setattr(tk.settings, "livekit_ws_url", "wss://edge.example")

    async def fake_get_or_create_session(_room_id: str) -> str:
        return "sess-active"

    monkeypatch.setattr(room_routes, "get_or_create_session", fake_get_or_create_session)
    monkeypatch.setattr(room_routes.agent_supervisor, "ensure_running", lambda _room_id: None)

    db = _FakeSession([_room(is_private=False)])
    res = await issue_livekit_token("room1", user=_user("owner"), db=db)
    assert res.server_url == "wss://edge.example"
    assert res.identity == "owner"
    claims = jwt.decode(
        res.token, _SECRET, algorithms=["HS256"], options={"verify_aud": False}
    )
    assert claims["video"]["room"] == "room1"


@pytest.mark.asyncio
async def test_endpoint_404_when_room_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """room 不在は 404。"""
    _enable(monkeypatch)
    db = _FakeSession([None])
    with pytest.raises(HTTPException) as ei:
        await issue_livekit_token("nope", user=_user("owner"), db=db)
    assert ei.value.status_code == 404


@pytest.mark.asyncio
async def test_endpoint_403_for_private_non_owner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """私有会議に作成者以外は 403。"""
    _enable(monkeypatch)
    db = _FakeSession([_room(is_private=True, creator_id="owner")])
    with pytest.raises(HTTPException) as ei:
        await issue_livekit_token("room1", user=_user("intruder"), db=db)
    assert ei.value.status_code == 403


@pytest.mark.asyncio
async def test_endpoint_503_when_keys_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """鍵未設定は 503（room アクセスは許可済みでも発行不可）。"""
    monkeypatch.setattr(tk.settings, "livekit_api_key", None)
    monkeypatch.setattr(tk.settings, "livekit_api_secret", None)
    db = _FakeSession([_room(is_private=False)])
    with pytest.raises(HTTPException) as ei:
        await issue_livekit_token("room1", user=_user("owner"), db=db)
    assert ei.value.status_code == 503
