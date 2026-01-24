"""
LAMS 認証APIルート
ユーザー登録・ログイン・プロフィール取得・パスワードリセット
"""

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.jwt_handler import (
    create_access_token,
    hash_password,
    verify_password,
)
from app.db.database import get_db
from app.db.models import PasswordResetToken, User

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
    role: str = "user"
    is_active: bool = True

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    """認証レスポンス（トークン＋ユーザー情報）"""

    access_token: str
    token_type: str = "bearer"
    user: UserResponse


@router.post("/register", response_model=AuthResponse)
async def register(
    data: UserCreate, db: AsyncSession = Depends(get_db)
) -> AuthResponse:
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
                "role": user.role,
            }
        ),
        user=UserResponse(
            id=str(user.id),
            email=user.email,
            display_name=user.display_name,
            native_language=user.native_language,
            role=user.role,
            is_active=user.is_active,
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

    # アカウントが無効化されている場合
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アカウントが無効化されています",
        )

    # トークン＋ユーザー情報を返す
    return AuthResponse(
        access_token=create_access_token(
            {
                "user_id": str(user.id),
                "email": user.email,
                "native_language": user.native_language,
                "role": user.role,
            }
        ),
        user=UserResponse(
            id=str(user.id),
            email=user.email,
            display_name=user.display_name,
            native_language=user.native_language,
            role=user.role,
            is_active=user.is_active,
        ),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)) -> User:
    """現在のユーザー情報取得"""
    return user


# ===========================================
# パスワードリセット関連
# ===========================================


class PasswordResetRequest(BaseModel):
    """パスワードリセットリクエスト（メールアドレスでトークン発行）"""

    email: EmailStr


class PasswordResetConfirm(BaseModel):
    """パスワードリセット確認（トークンと新パスワード）"""

    token: str
    new_password: str


class PasswordResetResponse(BaseModel):
    """パスワードリセットレスポンス"""

    message: str
    reset_token: str | None = None  # MVP用：実際はメールで送信


@router.post("/password-reset/request", response_model=PasswordResetResponse)
async def request_password_reset(
    data: PasswordResetRequest, db: AsyncSession = Depends(get_db)
) -> PasswordResetResponse:
    """
    パスワードリセットトークン発行
    MVP版：トークンを直接返す（本番環境ではメール送信）
    """
    # ユーザー検索
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if not user:
        # セキュリティ：ユーザーが存在しなくても成功を返す
        return PasswordResetResponse(
            message="メールアドレスが登録されている場合、リセットリンクを送信しました"
        )

    # トークン生成（64文字のランダム文字列）
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

    # 既存の未使用トークンを無効化
    existing_tokens = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id, PasswordResetToken.used == False
        )
    )
    for old_token in existing_tokens.scalars():
        old_token.used = True

    # 新しいトークン作成
    reset_token = PasswordResetToken(
        user_id=user.id,
        token=token,
        expires_at=expires_at,
    )
    db.add(reset_token)
    await db.commit()

    # MVP版：トークンを直接返す
    return PasswordResetResponse(
        message="パスワードリセットトークンを発行しました（MVP版）",
        reset_token=token,
    )


@router.post("/password-reset/confirm", response_model=PasswordResetResponse)
async def confirm_password_reset(
    data: PasswordResetConfirm, db: AsyncSession = Depends(get_db)
) -> PasswordResetResponse:
    """
    パスワードリセット実行
    トークンを検証して新しいパスワードを設定
    """
    # トークン検索
    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token == data.token)
    )
    reset_token = result.scalar_one_or_none()

    if not reset_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無効なリセットトークンです",
        )

    if reset_token.used:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="このトークンは既に使用されています",
        )

    if reset_token.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="トークンの有効期限が切れています",
        )

    # パスワード更新
    user_result = await db.execute(select(User).where(User.id == reset_token.user_id))
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ユーザーが見つかりません",
        )

    # パスワード更新
    user.password_hash = hash_password(data.new_password)
    reset_token.used = True

    await db.commit()

    return PasswordResetResponse(message="パスワードが正常に更新されました")
