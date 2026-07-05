"""
会議室APIの session 単位挙動テスト。

目的:
    - transcript が active/latest session を既定選択すること
    - 不正な session_id を 404 にすること
    - LiveKit トークン発行時に session を事前確保すること
"""

from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.db.models import (
    MeetingSession,
    Room,
    TranscriptSegment,
    TranslationSegment,
    User,
    utc_now,
)
from app.rooms import routes as room_routes
from app.rooms.routes import get_room_transcript, issue_livekit_token


class _FakeScalarResult:
    def __init__(self, value: object) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object:
        return self._value

    def scalars(self) -> "_FakeScalarResult":
        return self

    def all(self) -> list[object]:
        if isinstance(self._value, list):
            return self._value
        return []


class _FakeSession:
    def __init__(self, results: list[object]) -> None:
        self._results = list(results)

    async def execute(self, _query: object) -> _FakeScalarResult:
        return _FakeScalarResult(self._results.pop(0))


def _room() -> Room:
    return Room(
        id="room1",
        name="定例会議",
        creator_id="owner",
        allowed_languages=["ja", "en", "zh", "vi"],
        default_audio_mode="original",
        allow_mode_switch=True,
        default_mode="hybrid",
        enable_openai_s2s=True,
        language_routes={},
        is_private=False,
        is_active=True,
    )


def _user(user_id: str = "owner") -> User:
    return User(id=user_id, display_name="Owner", role="admin")


def _session(session_id: str, *, is_active: bool, minutes_offset: int) -> MeetingSession:
    session = MeetingSession(
        id=session_id,
        room_id="room1",
        is_active=is_active,
        mode="hybrid",
        started_at=utc_now(),
    )
    session.started_at = session.started_at + timedelta(minutes=minutes_offset)
    return session


def _segment(session_id: str) -> TranscriptSegment:
    segment = TranscriptSegment(
        id="seg1",
        room_id="room1",
        session_id=session_id,
        speaker_id="speaker1",
        source_language="ja",
        text="こんにちは",
        created_at=utc_now(),
    )
    segment.translations = [
        TranslationSegment(
            id="tr1",
            transcript_segment_id="seg1",
            source_language="ja",
            target_language="en",
            translated_text="Hello",
        )
    ]
    return segment


@pytest.mark.asyncio
async def test_get_room_transcript_uses_active_session_by_default() -> None:
    room = _room()
    active = _session("sess-active", is_active=True, minutes_offset=1)
    ended = _session("sess-ended", is_active=False, minutes_offset=0)
    segment = _segment(active.id)
    speaker = User(id="speaker1", display_name="話者", role="user")
    db = _FakeSession([room, [active, ended], [segment], [speaker]])

    response = await get_room_transcript("room1", user=_user(), db=db)

    assert response.selected_session_id == "sess-active"
    assert response.total == 1
    assert response.sessions[0].id == "sess-active"
    assert response.subtitles[0].translations["en"] == "Hello"


@pytest.mark.asyncio
async def test_get_room_transcript_rejects_unknown_session() -> None:
    db = _FakeSession([_room(), [_session("sess-known", is_active=True, minutes_offset=0)]])

    with pytest.raises(HTTPException) as ei:
        await get_room_transcript(
            "room1",
            session_id="sess-missing",
            user=_user(),
            db=db,
        )
    assert ei.value.status_code == 404


@pytest.mark.asyncio
async def test_issue_livekit_token_starts_or_reuses_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    async def fake_get_or_create_session(room_id: str) -> str:
        captured["room_id"] = room_id
        return "sess-active"

    def fake_create_join_token(**kwargs) -> str:
        captured["token_kwargs"] = kwargs
        return "join-token"

    def fake_ensure_running(room_id: str) -> None:
        captured["ensure_running"] = room_id

    monkeypatch.setattr(room_routes, "get_or_create_session", fake_get_or_create_session)
    monkeypatch.setattr(room_routes, "create_join_token", fake_create_join_token)
    monkeypatch.setattr(room_routes.agent_supervisor, "ensure_running", fake_ensure_running)

    response = await issue_livekit_token("room1", user=_user(), db=_FakeSession([_room()]))

    assert response.token == "join-token"
    assert captured["room_id"] == "room1"
    assert captured["ensure_running"] == "room1"
