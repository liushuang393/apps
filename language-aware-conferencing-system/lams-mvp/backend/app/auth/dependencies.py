"""
LAMS 認証・認可依存性
FastAPIの依存性注入用
"""

from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt_handler import decode_token
from app.db.database import get_db
from app.db.models import User, UserRole

# Bearer認証スキーム
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    現在の認証済みユーザーを取得
    無効なトークンの場合は401エラー
    """
    token_data = decode_token(credentials.credentials)
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="無効なトークンです"
        )

    result = await db.execute(select(User).where(User.id == token_data.user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="ユーザーが見つかりません"
        )

    # アカウントが無効化されている場合
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アカウントが無効化されています",
        )

    return user


async def get_current_active_user(
    user: User = Depends(get_current_user),
) -> User:
    """
    アクティブなユーザーを取得（get_current_userのエイリアス）
    """
    return user


def require_roles(*roles: UserRole) -> Callable:
    """
    特定のロールを要求するデコレーター
    使用例: @router.get("/admin", dependencies=[Depends(require_roles(UserRole.ADMIN))])
    """

    async def role_checker(user: User = Depends(get_current_user)) -> User:
        if not user.has_role(*roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="このアクションを実行する権限がありません",
            )
        return user

    return role_checker


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """管理者権限を要求"""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="管理者権限が必要です",
        )
    return user


async def require_moderator(user: User = Depends(get_current_user)) -> User:
    """モデレーター以上の権限を要求"""
    if not user.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="モデレーター権限が必要です",
        )
    return user
