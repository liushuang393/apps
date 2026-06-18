"""
LAMS 会議モード API（Phase 3 ハイブリッド 2 主線）

目的:
    会議の既定モード（a/b/hybrid）・聞く主線（S2S）許可・言語ペア上書きを
    セッション/会議レベルで管理し、参加者個別の翻訳音声 ON/OFF を切り替える。
    永続値は Mode Router（主線選択）の入力となる（transport 非依存）。

エンドポイント:
    - POST  /api/meetings                                   セッション開始/取得
    - PATCH /api/meetings/{session_id}/mode                 モード/会議設定の更新
    - PATCH /api/meetings/{session_id}/participants/{pid}/voice-translation
                                                            参加者の翻訳音声切替
RBAC:
    会議設定の変更は「会議室の作成者 または モデレーター以上」。
    参加者の翻訳音声切替は「本人 または モデレーター以上」。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.db.models import MeetingMode, MeetingSession, Room, User
from app.rooms.manager import room_manager

logger = logging.getLogger(__name__)
router = APIRouter()

_VALID_MODES = {m.value for m in MeetingMode}


def _validate_language_routes(routes: dict | None) -> dict:
    """language_routes の最小検証（各値は dict、mode 値は有効列挙のみ）。"""
    if not routes:
        return {}
    for key, override in routes.items():
        if not isinstance(override, dict):
            raise ValueError(f"language_routes['{key}'] は object である必要があります")
        m = override.get("mode")
        if m is not None and m not in _VALID_MODES:
            raise ValueError(f"language_routes['{key}'].mode が不正です: {m}")
    return routes


class MeetingCreate(BaseModel):
    """セッション開始リクエスト（mode 未指定なら Room.default_mode を採用）。"""

    room_id: str
    mode: str | None = None
    enable_openai_s2s: bool | None = None
    language_routes: dict | None = None

    @field_validator("mode")
    @classmethod
    def _check_mode(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_MODES:
            raise ValueError(f"mode は {sorted(_VALID_MODES)} のいずれかです")
        return v

    @field_validator("language_routes")
    @classmethod
    def _check_routes(cls, v: dict | None) -> dict | None:
        return _validate_language_routes(v)


class ModeUpdate(BaseModel):
    """進行中セッションのモード/会議設定の部分更新。"""

    mode: str | None = None
    enable_openai_s2s: bool | None = None
    language_routes: dict | None = None

    @field_validator("mode")
    @classmethod
    def _check_mode(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_MODES:
            raise ValueError(f"mode は {sorted(_VALID_MODES)} のいずれかです")
        return v

    @field_validator("language_routes")
    @classmethod
    def _check_routes(cls, v: dict | None) -> dict | None:
        return _validate_language_routes(v)


class VoiceTranslationUpdate(BaseModel):
    """参加者の翻訳音声（聞く主線）ON/OFF と目標言語。"""

    enabled: bool
    target_language: str | None = None


class MeetingResponse(BaseModel):
    """セッション + 会議レベル主線設定の統合ビュー。"""

    id: str
    room_id: str
    mode: str
    is_active: bool
    enable_openai_s2s: bool
    language_routes: dict


def _to_response(session: MeetingSession, room: Room) -> MeetingResponse:
    """セッションと会議設定を 1 つのレスポンスへ統合する。"""
    return MeetingResponse(
        id=session.id,
        room_id=session.room_id,
        mode=session.mode,
        is_active=session.is_active,
        enable_openai_s2s=room.enable_openai_s2s,
        language_routes=room.language_routes or {},
    )


async def _load_room_for_management(room_id: str, user: User, db: AsyncSession) -> Room:
    """会議設定変更用に Room を取得し RBAC（作成者 or モデレーター）を検証する。"""
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="会議室が見つかりません"
        )
    if room.creator_id != user.id and not user.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="会議設定を変更する権限がありません",
        )
    return room


async def _load_session(session_id: str, db: AsyncSession) -> MeetingSession:
    """セッションを取得（存在しなければ 404）。"""
    result = await db.execute(
        select(MeetingSession).where(MeetingSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="セッションが見つかりません"
        )
    return session


@router.post("", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
async def start_meeting(
    data: MeetingCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingResponse:
    """
    会議室のアクティブセッションを開始/取得し、モードと会議設定を確定する。

    - mode 未指定時は Room.default_mode を採用。
    - enable_openai_s2s / language_routes が指定されれば会議レベルへ反映。
    - 既にアクティブセッションがあれば mode のみ上書きして再利用する。
    """
    room = await _load_room_for_management(data.room_id, user, db)

    if data.enable_openai_s2s is not None:
        room.enable_openai_s2s = data.enable_openai_s2s
    if data.language_routes is not None:
        room.language_routes = data.language_routes

    result = await db.execute(
        select(MeetingSession).where(
            MeetingSession.room_id == data.room_id,
            MeetingSession.is_active.is_(True),
        )
    )
    session = result.scalar_one_or_none()
    resolved_mode = data.mode or room.default_mode

    if session is None:
        session = MeetingSession(room_id=data.room_id, mode=resolved_mode)
        db.add(session)
    else:
        session.mode = resolved_mode

    await db.commit()
    await db.refresh(session)
    await db.refresh(room)
    logger.info(
        "[Meeting] セッション確定: room=%s session=%s mode=%s",
        room.id,
        session.id,
        session.mode,
    )
    return _to_response(session, room)


@router.patch("/{session_id}/mode", response_model=MeetingResponse)
async def update_meeting_mode(
    session_id: str,
    data: ModeUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingResponse:
    """進行中セッションのモードと会議レベル主線設定を部分更新する。"""
    session = await _load_session(session_id, db)
    room = await _load_room_for_management(session.room_id, user, db)

    if data.mode is not None:
        session.mode = data.mode
    if data.enable_openai_s2s is not None:
        room.enable_openai_s2s = data.enable_openai_s2s
    if data.language_routes is not None:
        room.language_routes = data.language_routes

    await db.commit()
    await db.refresh(session)
    await db.refresh(room)
    logger.info(
        "[Meeting] モード更新: session=%s mode=%s s2s=%s",
        session.id,
        session.mode,
        room.enable_openai_s2s,
    )
    return _to_response(session, room)


@router.patch("/{session_id}/participants/{pid}/voice-translation")
async def update_voice_translation(
    session_id: str,
    pid: str,
    data: VoiceTranslationUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    参加者個別の翻訳音声（聞く主線）を ON/OFF する。

    - enabled=True で audio_mode=translated（目標言語の翻訳音声を受信）。
    - 本人以外が変更する場合はモデレーター以上が必要。
    - allow_mode_switch=False の会議では本人による切替を禁止する。
    """
    session = await _load_session(session_id, db)
    result = await db.execute(select(Room).where(Room.id == session.room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="会議室が見つかりません"
        )

    is_self = user.id == pid
    if not is_self and not user.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="他の参加者の設定を変更する権限がありません",
        )
    if is_self and not user.is_moderator and not room.allow_mode_switch:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この会議ではモード切替が許可されていません",
        )

    audio_mode = "translated" if data.enabled else "original"
    updated = await room_manager.update_preference(
        session.room_id,
        pid,
        audio_mode=audio_mode,
        target_language=data.target_language,
    )
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="参加者が見つかりません",
        )
    return {
        "user_id": updated.user_id,
        "audio_mode": updated.audio_mode,
        "target_language": updated.target_language,
    }
