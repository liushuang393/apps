"""
LAMS 認証APIルート
ユーザー登録・ログイン・プロフィール取得
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.jwt_handler import (
    Token,
    create_access_token,
    hash_password,
    verify_password,
)
from app.db.database import get_db
from app.db.models import User

router = APIRouter()


class UserCreate(BaseModel):
    """ユーザー登録リクエスト"""

    email: EmailStr
    password: str
    display_name: str
    native_language: str = "ja"


class UserLogin(BaseModel):
    """ログインリクエスト"""

    email: EmailStr
    password: str


class UserResponse(BaseModel):
    """ユーザー情報レスポンス"""

    id: str
    email: str
    display_name: str
    native_language: str

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    """認証レスポンス（トークン＋ユーザー情報）"""

    access_token: str
    token_type: str = "bearer"
    user: UserResponse


@router.post("/register", response_model=AuthResponse)
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    """新規ユーザー登録"""
    # メールアドレス重複チェック
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="このメールアドレスは既に登録されています",
        )

    # ユーザー作成
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        native_language=data.native_language,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # トークン＋ユーザー情報を返す
    return AuthResponse(
        access_token=create_access_token(
            {
                "user_id": str(user.id),
                "email": user.email,
                "native_language": user.native_language,
            }
        ),
        user=UserResponse(
            id=str(user.id),
            email=user.email,
            display_name=user.display_name,
            native_language=user.native_language,
        ),
    )


@router.post("/login", response_model=AuthResponse)
async def login(creds: UserLogin, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    """ユーザーログイン"""
    result = await db.execute(select(User).where(User.email == creds.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(creds.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="メールアドレスまたはパスワードが正しくありません",
        )

    # トークン＋ユーザー情報を返す
    return AuthResponse(
        access_token=create_access_token(
            {
                "user_id": str(user.id),
                "email": user.email,
                "native_language": user.native_language,
            }
        ),
        user=UserResponse(
            id=str(user.id),
            email=user.email,
            display_name=user.display_name,
            native_language=user.native_language,
        ),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)) -> User:
    """現在のユーザー情報取得"""
    return user
