"""
LAMS JWT認証ハンドラー
トークン生成・検証を担当
"""

from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt
from pydantic import BaseModel

from app.config import settings


class TokenData(BaseModel):
    """トークンに含まれるユーザー情報"""

    user_id: str
    email: str
    native_language: str = "ja"
    role: str = "user"


class Token(BaseModel):
    """認証トークンレスポンス"""

    access_token: str
    token_type: str = "bearer"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    パスワード検証
    bcrypt 4.x対応版
    """
    try:
        password_bytes = plain_password.encode("utf-8")
        hash_bytes = hashed_password.encode("utf-8")
        return bcrypt.checkpw(password_bytes, hash_bytes)
    except Exception:
        return False


def hash_password(password: str) -> str:
    """
    パスワードハッシュ化
    bcrypt 4.x対応版
    """
    password_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def create_access_token(data: dict[str, str]) -> str:
    """
    JWTアクセストークン生成
    有効期限: settings.jwt_expire_minutes
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> TokenData | None:
    """
    JWTトークン検証・デコード
    無効な場合はNoneを返す
    """
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        return TokenData(
            user_id=payload.get("user_id", ""),
            email=payload.get("email", ""),
            native_language=payload.get("native_language", "ja"),
            role=payload.get("role", "user"),
        )
    except JWTError:
        return None
