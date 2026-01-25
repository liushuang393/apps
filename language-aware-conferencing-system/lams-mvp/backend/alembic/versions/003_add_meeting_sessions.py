"""meeting_sessions テーブル追加 - 会議セッション管理

一つの会議室で複数回の会議を管理するためのテーブル:
- セッション開始: 最初の参加者が発言した時点
- セッション終了: 全参加者が退室した時点

Revision ID: 003_sessions
Revises: 002_subtitles
Create Date: 2026-01-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# リビジョン識別子
revision: str = "003_sessions"
down_revision: Union[str, None] = "002_subtitles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """マイグレーション適用（アップグレード）"""
    # meeting_sessions テーブル作成
    op.create_table(
        "meeting_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "room_id",
            sa.String(36),
            sa.ForeignKey("rooms.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
    )

    # subtitles テーブルに session_id カラムを追加
    op.add_column(
        "subtitles",
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("meeting_sessions.id"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    """マイグレーションロールバック（ダウングレード）"""
    # subtitles テーブルから session_id カラムを削除
    op.drop_column("subtitles", "session_id")

    # meeting_sessions テーブル削除
    op.drop_table("meeting_sessions")

