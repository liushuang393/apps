"""
LAMS データベースモデル
ユーザー、会議室、設定の定義
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """SQLAlchemy ベースクラス"""

    pass


def generate_uid() -> str:
    """UUID生成ヘルパー"""
    return str(uuid.uuid4())


def utc_now() -> datetime:
    """現在時刻（UTC）取得ヘルパー"""
    return datetime.now(timezone.utc)


class User(Base):
    """
    ユーザーモデル
    社内メンバーの認証情報と言語設定を管理
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(100))

    # 母語設定（翻訳先のデフォルト言語）
    native_language: Mapped[str] = mapped_column(String(10), default="ja")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    # リレーション
    created_rooms: Mapped[list["Room"]] = relationship(back_populates="creator")


class Room(Base):
    """
    会議室モデル
    会議の言語ポリシーを管理
    """

    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    creator_id: Mapped[str] = mapped_column(ForeignKey("users.id"))

    # 会議言語ポリシー
    allowed_languages: Mapped[list[str]] = mapped_column(
        JSON, default=lambda: ["ja", "en", "zh", "vi"]
    )
    default_audio_mode: Mapped[str] = mapped_column(
        String(20),
        default="original",  # original または translated
    )
    allow_mode_switch: Mapped[bool] = mapped_column(Boolean, default=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    # リレーション
    creator: Mapped["User"] = relationship(back_populates="created_rooms")
