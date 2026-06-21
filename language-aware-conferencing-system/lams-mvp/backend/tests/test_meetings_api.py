"""
会議モード API（Phase 3）の単体テスト。

DB/Redis 非依存で検証するため、SQLAlchemy セッションは結果をキューで返す
FakeSession で差し替え、room_manager.update_preference は monkeypatch する。
検証対象: バリデーション・RBAC・モード解決・翻訳音声マッピング。
"""

import pytest
from fastapi import HTTPException

from app.db.models import MeetingMode, MeetingSession, Room, User, UserRole
from app.meetings import routes as m
from app.meetings.routes import (
    MeetingCreate,
    ModeUpdate,
    VoiceTranslationUpdate,
    start_meeting,
    update_meeting_mode,
    update_voice_translation,
)


class _FakeResult:
    """db.execute の戻り値（scalar_one_or_none のみ提供）。"""

    def __init__(self, value: object) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object:
        return self._value


class _FakeSession:
    """execute をキュー順に返し、commit/refresh は最小の正規化のみ行う。"""

    def __init__(self, results: list[object]) -> None:
        self._results = list(results)
        self.added: list[object] = []

    async def execute(self, _query: object) -> _FakeResult:
        return _FakeResult(self._results.pop(0))

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        return None

    async def refresh(self, obj: object) -> None:
        if isinstance(obj, MeetingSession):
            if obj.id is None:
                obj.id = "sess-new"
            if obj.is_active is None:
                obj.is_active = True
            if obj.mode is None:
                obj.mode = MeetingMode.HYBRID.value


def _room(**kw: object) -> Room:
    """テスト用 Room（mode 設定は既定値、上書き可）。"""
    defaults: dict[str, object] = {
        "id": "room1",
        "creator_id": "owner",
        "default_mode": MeetingMode.HYBRID.value,
        "enable_openai_s2s": True,
        "language_routes": {},
        "allow_mode_switch": True,
    }
    defaults.update(kw)
    return Room(**defaults)


def _user(uid: str, role: UserRole = UserRole.USER) -> User:
    return User(id=uid, role=role.value)


def test_validators_reject_invalid_mode_and_routes() -> None:
    """不正な mode と language_routes は Pydantic 検証で弾かれる。"""
    with pytest.raises(ValueError):
        MeetingCreate(room_id="r", mode="x")
    with pytest.raises(ValueError):
        MeetingCreate(room_id="r", language_routes={"ja->en": {"mode": "z"}})
    with pytest.raises(ValueError):
        MeetingCreate(room_id="r", language_routes={"ja->en": "notdict"})


@pytest.mark.asyncio
async def test_start_meeting_creates_session_with_room_default_mode() -> None:
    """セッション未作成時、mode 未指定なら Room.default_mode を採用して作成する。"""
    room = _room(default_mode=MeetingMode.B.value)
    db = _FakeSession([room, None])  # _load_room→room, active session→None
    res = await start_meeting(
        MeetingCreate(room_id="room1"), user=_user("owner"), db=db
    )
    assert res.mode == MeetingMode.B.value
    assert res.is_active is True
    assert len(db.added) == 1


@pytest.mark.asyncio
async def test_start_meeting_rbac_denies_non_owner_non_moderator() -> None:
    """作成者でもモデレーターでもないユーザーは 403。"""
    db = _FakeSession([_room()])
    with pytest.raises(HTTPException) as ei:
        await start_meeting(
            MeetingCreate(room_id="room1"), user=_user("intruder"), db=db
        )
    assert ei.value.status_code == 403


@pytest.mark.asyncio
async def test_update_mode_changes_active_session() -> None:
    """PATCH /mode は session.mode と会議レベル S2S 設定を更新する。"""
    session = MeetingSession(id="s1", room_id="room1", mode="hybrid", is_active=True)
    room = _room()
    db = _FakeSession([session, room])  # _load_session→session, _load_room→room
    res = await update_meeting_mode(
        "s1",
        ModeUpdate(mode=MeetingMode.A.value, enable_openai_s2s=False),
        user=_user("owner"),
        db=db,
    )
    assert res.mode == MeetingMode.A.value
    assert res.enable_openai_s2s is False


@pytest.mark.asyncio
async def test_voice_translation_maps_enabled_and_blocks_when_locked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """enabled=True→translated。allow_mode_switch=False の本人切替は 403。"""
    captured: dict[str, object] = {}

    async def fake_update(_room_id, uid, audio_mode=None, target_language=None):  # noqa: ANN001
        captured.update(audio_mode=audio_mode, target_language=target_language)
        return type(
            "P",
            (),
            {
                "user_id": uid,
                "audio_mode": audio_mode,
                "target_language": target_language,
            },
        )()

    monkeypatch.setattr(m.room_manager, "update_preference", fake_update)

    session = MeetingSession(id="s1", room_id="room1", mode="hybrid", is_active=True)
    db = _FakeSession([session, _room()])
    out = await update_voice_translation(
        "s1",
        "u1",
        VoiceTranslationUpdate(enabled=True, target_language="en"),
        user=_user("u1"),
        db=db,
    )
    assert out["audio_mode"] == "translated"
    assert captured["target_language"] == "en"

    locked = MeetingSession(id="s2", room_id="room1", mode="hybrid", is_active=True)
    db2 = _FakeSession([locked, _room(allow_mode_switch=False)])
    with pytest.raises(HTTPException) as ei:
        await update_voice_translation(
            "s2", "u1", VoiceTranslationUpdate(enabled=True), user=_user("u1"), db=db2
        )
    assert ei.value.status_code == 403
