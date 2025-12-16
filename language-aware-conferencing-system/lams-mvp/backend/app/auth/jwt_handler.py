"""
LAMS JWT認証ハンドラー
トークン生成・検証を担当
"""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from app.config import settings

# パスワードハッシュ設定
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class TokenData(BaseModel):
    """トークンに含まれるユーザー情報"""

    user_id: str
    email: str
    native_language: str = "ja"


class Token(BaseModel):
    """認証トークンレスポンス"""

    access_token: str
    token_type: str = "bearer"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """パスワード検証"""
    return pwd_context.verify(plain_password, hashed_password)


def hash_password(password: str) -> str:
    """パスワードハッシュ化"""
    return pwd_context.hash(password)


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
        )
    except JWTError:
        return None
