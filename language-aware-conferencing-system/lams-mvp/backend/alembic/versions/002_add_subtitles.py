"""subtitles テーブル追加 - 会議字幕の永続化

Revision ID: 002_subtitles
Revises: 001_initial
Create Date: 2026-01-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# リビジョン識別子
revision: str = "002_subtitles"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """マイグレーション適用（アップグレード）"""
    # subtitles テーブル
    op.create_table(
        "subtitles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=False, index=True),
        sa.Column("speaker_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("original_text", sa.Text, nullable=False),
        sa.Column("original_language", sa.String(10), nullable=False),
        sa.Column("translations", sa.JSON, nullable=False, server_default='{}'),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    """マイグレーションロールバック（ダウングレード）"""
    op.drop_table("subtitles")
