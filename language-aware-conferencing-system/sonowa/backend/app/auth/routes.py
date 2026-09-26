"""
Sonowa 認証APIルート
ユーザー登録・ログイン・プロフィール取得・パスワードリセット
"""

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.jwt_handler import (
    create_access_token,
    hash_password,
    verify_password,
)
from app.config import settings
from app.db.database import get_db
from app.db.models import Participant, PasswordResetToken, Room, User
from app.languages import ALL_SUPPORTED_LANGUAGES

router = APIRouter()

# 画面の入力欄（minLength=8・「8文字以上」表示）と揃える最小パスワード長。
MIN_PASSWORD_LENGTH = 8


class UserCreate(BaseModel):
    """ユーザー登録リクエスト"""

    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)
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


class UserSelfUpdate(BaseModel):
    """自己プロフィール更新（表示名・母語のみ）"""

    display_name: str | None = None
    native_language: str | None = None


class HistoryItem(BaseModel):
    """会議参加履歴の1行"""

    room_id: str
    room_name: str
    is_private: bool
    joined_at: str
    updated_at: str


def _build_auth_response(user: User) -> AuthResponse:
    """ユーザーから JWT 付き認証レスポンスを組み立てる。"""
    return AuthResponse(
        access_token=create_access_token(
            {
                "user_id": str(user.id),
                "email": user.email,
                "native_language": user.native_language,
                "role": user.role,
                "tv": user.token_version or 0,  # INSERT 前の新規ユーザーは None
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

    # ユーザー作成（並列登録の UNIQUE 競合は 400 に正規化する）
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        native_language=data.native_language,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="このメールアドレスは既に登録されています",
        ) from exc
    await db.refresh(user)

    return _build_auth_response(user)


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

    return _build_auth_response(user)


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)) -> User:
    """現在のユーザー情報取得"""
    return user


@router.patch("/me", response_model=AuthResponse)
async def update_me(
    data: UserSelfUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """
    自己プロフィール更新（表示名・母語）。
    母語は JWT に載るため、更新後はトークンを再発行する。
    """
    if data.display_name is None and data.native_language is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="display_name または native_language を指定してください",
        )

    if data.display_name is not None:
        name = data.display_name.strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="表示名は空にできません",
            )
        user.display_name = name

    if data.native_language is not None:
        if data.native_language not in ALL_SUPPORTED_LANGUAGES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"無効な言語: {data.native_language}",
            )
        user.native_language = data.native_language

    await db.commit()
    await db.refresh(user)
    return _build_auth_response(user)


@router.get("/history", response_model=list[HistoryItem])
async def get_my_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[HistoryItem]:
    """
    自分の会議参加履歴。
    participant を一次ソースとし、他ユーザーの行は返さない。
    """
    result = await db.execute(
        select(Participant, Room)
        .join(Room, Participant.room_id == Room.id)
        .where(Participant.user_id == user.id)
        .order_by(Participant.updated_at.desc())
    )
    items: list[HistoryItem] = []
    for participant, room in result.all():
        if participant.user_id != user.id:
            continue
        items.append(
            HistoryItem(
                room_id=room.id,
                room_name=room.name,
                is_private=room.is_private,
                joined_at=participant.joined_at.isoformat(),
                updated_at=participant.updated_at.isoformat(),
            )
        )
    return items


# ===========================================
# パスワードリセット関連
# ===========================================


class PasswordResetRequest(BaseModel):
    """パスワードリセットリクエスト（メールアドレスでトークン発行）"""

    email: EmailStr


class PasswordResetConfirm(BaseModel):
    """パスワードリセット確認（トークンと新パスワード）"""

    token: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class PasswordChange(BaseModel):
    """ログイン中の本人によるパスワード変更"""

    current_password: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class PasswordResetResponse(BaseModel):
    """パスワードリセットレスポンス"""

    message: str
    reset_token: str | None = None  # MVP用：実際はメールで送信


RESET_TOKEN_TTL = timedelta(hours=1)


async def issue_reset_token(db: AsyncSession, user: User) -> str:
    """ユーザーの未使用トークンを無効化し、1時間有効な新しいリセットトークンを発行する。

    パスワード忘れ（開発環境）と管理者によるリセットリンク発行（本番）の共通処理。
    """
    token = secrets.token_urlsafe(48)  # 64文字のランダム文字列
    existing_tokens = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used.is_(False),
        )
    )
    for old_token in existing_tokens.scalars():
        old_token.used = True
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=datetime.now(timezone.utc) + RESET_TOKEN_TTL,
        )
    )
    await db.commit()
    return token


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
        if settings.password_reset_self_service:
            # 本人がその場で再設定する方式では、入力ミスに気付けるよう未登録を伝える。
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="このメールアドレスは登録されていません",
            )
        # メールで届ける方式では、登録有無を明かさず成功を返す。
        return PasswordResetResponse(
            message="メールアドレスが登録されている場合、リセットリンクを送信しました"
        )

    token = await issue_reset_token(db, user)

    # 本人再設定方式（既定）はトークンを返し、画面が再設定ページへそのまま進む。
    return PasswordResetResponse(
        message="メールアドレスが登録されている場合、リセットリンクを送信しました",
        reset_token=token if settings.password_reset_self_service else None,
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
    user.token_version += 1  # 既存セッションをすべて失効
    reset_token.used = True

    await db.commit()

    return PasswordResetResponse(message="パスワードが正常に更新されました")


@router.post("/me/password", response_model=AuthResponse)
async def change_my_password(
    data: PasswordChange,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """
    本人がパスワードを変更する（現在のパスワードの確認が必須）。
    他端末のセッションは失効させ、変更した端末には新しいトークンを返す。
    """
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="現在のパスワードが正しくありません",
        )
    user.password_hash = hash_password(data.new_password)
    user.token_version += 1
    await db.commit()
    return _build_auth_response(user)
