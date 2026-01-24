"""
LAMS 会議室APIルート
会議室の作成・一覧・取得
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.db.models import Room, Subtitle, User
from app.rooms.manager import room_manager

router = APIRouter()


class RoomCreate(BaseModel):
    """会議室作成リクエスト"""

    name: str
    description: str | None = None
    allowed_languages: list[str] = ["ja", "en", "zh", "vi"]
    default_audio_mode: str = "original"  # デフォルトは原声
    allow_mode_switch: bool = True
    is_private: bool = False  # 私有会議（他ユーザーの一覧に非表示）


class RoomResponse(BaseModel):
    """会議室レスポンス"""

    id: str
    name: str
    description: str | None
    creator_id: str
    allowed_languages: list[str]
    default_audio_mode: str
    allow_mode_switch: bool
    is_private: bool  # 私有/公開状態
    is_active: bool
    participant_count: int = 0

    class Config:
        from_attributes = True


@router.post("", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
    data: RoomCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoomResponse:
    """新規会議室作成"""
    room = Room(
        name=data.name,
        description=data.description,
        creator_id=user.id,
        allowed_languages=data.allowed_languages,
        default_audio_mode=data.default_audio_mode,
        allow_mode_switch=data.allow_mode_switch,
        is_private=data.is_private,
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)

    # Redis に会議室状態を作成
    await room_manager.create_room_state(room.id)

    return RoomResponse(
        id=room.id,
        name=room.name,
        description=room.description,
        creator_id=room.creator_id,
        allowed_languages=room.allowed_languages,
        default_audio_mode=room.default_audio_mode,
        allow_mode_switch=room.allow_mode_switch,
        is_private=room.is_private,
        is_active=room.is_active,
    )


@router.get("")
async def list_rooms(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """
    アクティブな会議室一覧取得
    私有会議は作成者のみ表示
    """
    from sqlalchemy import or_

    # 公開会議 OR 自分が作成した私有会議のみ表示
    result = await db.execute(
        select(Room)
        .where(Room.is_active.is_(True))
        .where(or_(Room.is_private.is_(False), Room.creator_id == user.id))
        .order_by(Room.created_at.desc())
    )
    rooms = result.scalars().all()

    response_rooms = []
    for room in rooms:
        participants = await room_manager.get_participants(room.id)
        response_rooms.append(
            RoomResponse(
                id=room.id,
                name=room.name,
                description=room.description,
                creator_id=room.creator_id,
                allowed_languages=room.allowed_languages,
                default_audio_mode=room.default_audio_mode,
                allow_mode_switch=room.allow_mode_switch,
                is_private=room.is_private,
                is_active=room.is_active,
                participant_count=len(participants),
            )
        )

    return {"rooms": response_rooms, "total": len(response_rooms)}


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(
    room_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoomResponse:
    """
    会議室詳細取得
    私有会議は作成者のみアクセス可能
    """
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="会議室が見つかりません"
        )

    # 私有会議は作成者以外アクセス不可
    if room.is_private and room.creator_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この会議室にはアクセスできません",
        )

    participants = await room_manager.get_participants(room.id)

    return RoomResponse(
        id=room.id,
        name=room.name,
        description=room.description,
        creator_id=room.creator_id,
        allowed_languages=room.allowed_languages,
        default_audio_mode=room.default_audio_mode,
        allow_mode_switch=room.allow_mode_switch,
        is_private=room.is_private,
        is_active=room.is_active,
        participant_count=len(participants),
    )


class SubtitleResponse(BaseModel):
    """字幕レスポンス"""

    id: str
    speaker_id: str
    speaker_name: str
    original_text: str
    original_language: str
    translations: dict
    timestamp: str  # ISO format

    class Config:
        from_attributes = True


class TranscriptResponse(BaseModel):
    """会議記録レスポンス"""

    room_id: str
    room_name: str
    subtitles: list[SubtitleResponse]
    total: int


@router.get("/{room_id}/transcript", response_model=TranscriptResponse)
async def get_room_transcript(
    room_id: str,
    lang: str | None = None,  # 出力言語（指定しない場合は全言語）
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    """
    会議記録（字幕履歴）を取得
    - lang パラメータで出力言語を指定可能
    - 全ユーザーが同じ内容を取得（言語のみ異なる可能性）
    """
    # 会議室の存在確認
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="会議室が見つかりません"
        )

    # 字幕を取得（時系列順）
    result = await db.execute(
        select(Subtitle)
        .where(Subtitle.room_id == room_id)
        .order_by(Subtitle.timestamp.asc())
    )
    subtitles = result.scalars().all()

    # ユーザー情報を取得してマッピング
    user_ids = list(set(s.speaker_id for s in subtitles))
    if user_ids:
        result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_list = result.scalars().all()
        users_map = {u.id: u.display_name for u in users_list}
    else:
        users_map = {}

    # レスポンス構築
    subtitle_responses = []
    for s in subtitles:
        # 指定言語がある場合は翻訳テキストを使用
        if lang and lang in s.translations:
            text = s.translations[lang]
        elif lang and lang == s.original_language:
            text = s.original_text
        else:
            text = s.original_text

        subtitle_responses.append(
            SubtitleResponse(
                id=s.id,
                speaker_id=s.speaker_id,
                speaker_name=users_map.get(s.speaker_id, "不明"),
                original_text=s.original_text if not lang else text,
                original_language=s.original_language,
                translations=s.translations,
                timestamp=s.timestamp.isoformat(),
            )
        )

    return TranscriptResponse(
        room_id=room.id,
        room_name=room.name,
        subtitles=subtitle_responses,
        total=len(subtitle_responses),
    )
