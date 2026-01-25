"""
LAMS データベースモデル
ユーザー、会議室、設定の定義
"""

import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
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


class UserRole(str, Enum):
    """
    ユーザーロール定義
    RBAC（Role-Based Access Control）用
    """

    ADMIN = "admin"  # 管理者：全権限
    MODERATOR = "moderator"  # モデレーター：会議室管理
    USER = "user"  # 一般ユーザー：基本機能のみ


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

    # ロール（RBAC）
    role: Mapped[str] = mapped_column(String(20), default=UserRole.USER.value)

    # アカウント状態
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )

    # リレーション
    created_rooms: Mapped[list["Room"]] = relationship(back_populates="creator")

    def has_role(self, *roles: UserRole) -> bool:
        """指定されたロールのいずれかを持っているかチェック"""
        return self.role in [r.value for r in roles]

    @property
    def is_admin(self) -> bool:
        """管理者かどうか"""
        return self.role == UserRole.ADMIN.value

    @property
    def is_moderator(self) -> bool:
        """モデレーター以上かどうか"""
        return self.role in [UserRole.ADMIN.value, UserRole.MODERATOR.value]


class PasswordResetToken(Base):
    """
    パスワードリセットトークンモデル
    パスワード忘れ時のリセット用トークンを管理
    """

    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )

    # リレーション
    user: Mapped["User"] = relationship()


class MeetingSession(Base):
    """
    会議セッションモデル
    一つの会議室で複数回の会議を管理

    セッションライフサイクル:
    - 開始: 最初の参加者が発言した時点
    - 終了: 全参加者が退室した時点
    """

    __tablename__ = "meeting_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)

    # セッション開始・終了時刻
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # セッション状態
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # リレーション
    room: Mapped["Room"] = relationship()
    subtitles: Mapped[list["Subtitle"]] = relationship(back_populates="session")


class Subtitle(Base):
    """
    字幕モデル
    会議の発言記録を保存（多言語翻訳含む）
    """

    __tablename__ = "subtitles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)
    # セッションID（会議回ごとに字幕を分離）
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("meeting_sessions.id"), index=True, nullable=True
    )
    speaker_id: Mapped[str] = mapped_column(ForeignKey("users.id"))

    # 原文
    original_text: Mapped[str] = mapped_column(Text)
    original_language: Mapped[str] = mapped_column(String(10))

    # 翻訳結果（JSON: {"en": "Hello", "zh": "你好", ...}）
    translations: Mapped[dict] = mapped_column(JSON, default=dict)

    # タイムスタンプ
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )

    # リレーション
    room: Mapped["Room"] = relationship()
    session: Mapped["MeetingSession | None"] = relationship(back_populates="subtitles")
    speaker: Mapped["User"] = relationship()


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

    # 私有/公開設定（私有会議は作成者以外一覧に表示されない）
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )

    # リレーション
    creator: Mapped["User"] = relationship(back_populates="created_rooms")


class SystemConfig(Base):
    """
    システム全体設定モデル
    言語設定など、システム全体で共有される設定を管理
    """

    __tablename__ = "system_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    value: Mapped[str] = mapped_column(Text)  # JSON文字列で保存
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
