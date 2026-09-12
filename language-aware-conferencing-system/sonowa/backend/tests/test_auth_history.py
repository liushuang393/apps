"""
会議参加履歴（GET /api/auth/history）の単体テスト。

対象: app.auth.routes.get_my_history
方針:
    - FakeSession が返す行を写像する。
    - 他ユーザーの行は Python 側でも除外する。
"""

import asyncio
from datetime import datetime, timezone

from app.auth.routes import get_my_history
from app.db.models import Participant, Room, User


class _FakeResult:
    """select(Participant, Room) の all() 相当。"""

    def __init__(self, rows: list[tuple[Participant, Room]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[Participant, Room]]:
        return list(self._rows)


class _FakeSession:
    """execute が固定行を返すセッション。"""

    def __init__(self, rows: list[tuple[Participant, Room]]) -> None:
        self._rows = rows

    async def execute(self, _query: object) -> _FakeResult:
        return _FakeResult(self._rows)


def _ts() -> datetime:
    return datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def _user(uid: str) -> User:
    return User(
        id=uid,
        email=f"{uid}@example.com",
        password_hash="x",
        display_name=uid,
        native_language="ja",
    )


def _room(rid: str, name: str, *, private: bool = False) -> Room:
    return Room(id=rid, name=name, creator_id="owner", is_private=private)


def _participant(uid: str, room: Room) -> Participant:
    return Participant(
        room_id=room.id,
        user_id=uid,
        display_name=uid,
        preferred_language="ja",
        output_language="ja",
        joined_at=_ts(),
        updated_at=_ts(),
    )


def test_history_maps_own_rooms() -> None:
    """自ユーザーの参加部屋が room_name 付きで返る。"""
    room = _room("r1", "定例", private=True)
    rows = [(_participant("u1", room), room)]
    items = asyncio.run(get_my_history(user=_user("u1"), db=_FakeSession(rows)))
    assert len(items) == 1
    assert items[0].room_id == "r1"
    assert items[0].room_name == "定例"
    assert items[0].is_private is True


def test_history_excludes_other_users() -> None:
    """他ユーザーの参加行は混ざらない。"""
    own = _room("r1", "自分の会議")
    other = _room("r2", "他人の会議")
    rows = [
        (_participant("u1", own), own),
        (_participant("u2", other), other),
    ]
    items = asyncio.run(get_my_history(user=_user("u1"), db=_FakeSession(rows)))
    assert [item.room_id for item in items] == ["r1"]


def test_history_empty() -> None:
    """参加が無ければ空配列。"""
    items = asyncio.run(get_my_history(user=_user("u1"), db=_FakeSession([])))
    assert items == []
