"""
LAMS 管理者API
ユーザー管理、システム設定
"""

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin, get_current_user
from app.db.database import get_db
from app.db.models import User, UserRole, Room, Subtitle

router = APIRouter()


class UserResponse(BaseModel):
    """ユーザーレスポンス"""
    id: str
    email: str
    display_name: str
    native_language: str
    role: str
    is_active: bool
    created_at: str

    class Config:
        from_attributes = True


class UserUpdateRequest(BaseModel):
    """ユーザー更新リクエスト"""
    display_name: str | None = None
    native_language: str | None = None
    role: str | None = None
    is_active: bool | None = None


class SystemStatsResponse(BaseModel):
    """システム統計レスポンス"""
    total_users: int
    active_users: int
    total_rooms: int
    active_rooms: int
    total_subtitles: int


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[UserResponse]:
    """
    全ユーザー一覧取得（管理者のみ）
    """
    result = await db.execute(
        select(User).order_by(User.created_at.desc())
    )
    users = result.scalars().all()

    return [
        UserResponse(
            id=u.id,
            email=u.email,
            display_name=u.display_name,
            native_language=u.native_language,
            role=u.role,
            is_active=u.is_active,
            created_at=u.created_at.isoformat(),
        )
        for u in users
    ]


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """
    ユーザー詳細取得（管理者のみ）
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ユーザーが見つかりません"
        )

    return UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        native_language=user.native_language,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat(),
    )


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    data: UserUpdateRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """
    ユーザー更新（管理者のみ）
    - ロール変更
    - アカウント有効/無効化
    - 表示名変更
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ユーザーが見つかりません"
        )

    # 自分自身のロール変更を防止
    if user_id == admin.id and data.role and data.role != admin.role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="自分自身のロールは変更できません"
        )

    # 自分自身の無効化を防止
    if user_id == admin.id and data.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="自分自身を無効化できません"
        )

    # ロール検証
    if data.role:
        valid_roles = [r.value for r in UserRole]
        if data.role not in valid_roles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"無効なロール: {data.role}。有効なロール: {valid_roles}"
            )

    # 更新
    if data.display_name is not None:
        user.display_name = data.display_name
    if data.native_language is not None:
        user.native_language = data.native_language
    if data.role is not None:
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active

    await db.commit()
    await db.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        native_language=user.native_language,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat(),
    )


@router.get("/stats", response_model=SystemStatsResponse)
async def get_system_stats(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> SystemStatsResponse:
    """
    システム統計取得（管理者のみ）
    """
    # ユーザー統計
    total_users = await db.scalar(select(func.count()).select_from(User))
    active_users = await db.scalar(
        select(func.count()).select_from(User).where(User.is_active.is_(True))
    )

    # 会議室統計
    total_rooms = await db.scalar(select(func.count()).select_from(Room))
    active_rooms = await db.scalar(
        select(func.count()).select_from(Room).where(Room.is_active.is_(True))
    )

    # 字幕統計
    total_subtitles = await db.scalar(select(func.count()).select_from(Subtitle))

    return SystemStatsResponse(
        total_users=total_users or 0,
        active_users=active_users or 0,
        total_rooms=total_rooms or 0,
        active_rooms=active_rooms or 0,
        total_subtitles=total_subtitles or 0,
    )
