"""subtitles テーブルを廃止（segment へ一本化）

改善.md §13.3/§13.4 の transcript_segment / translation_segment へ移行（008）した後、
旧 subtitles テーブルを drop する。読み書きは既に segment 側へ切替済み。

downgrade では subtitles テーブルを再作成する（002 と同等の定義）。データは復元しない。

Revision ID: 009_drop_subtitles
Revises: 008_migrate_subtitles
Create Date: 2026-06-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "009_drop_subtitles"
down_revision: str | None = "008_migrate_subtitles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """subtitles テーブルを削除する。"""
    op.drop_table("subtitles")


def downgrade() -> None:
    """subtitles テーブルを再作成する（002 相当。データは復元しない）。"""
    op.create_table(
        "subtitles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=False),
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("meeting_sessions.id"),
            nullable=True,
        ),
        sa.Column(
            "speaker_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("original_text", sa.Text, nullable=False),
        sa.Column("original_language", sa.String(10), nullable=False),
        sa.Column("translations", sa.JSON, nullable=False, server_default="{}"),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_subtitles_room_id", "subtitles", ["room_id"])
    op.create_index("ix_subtitles_session_id", "subtitles", ["session_id"])
    op.create_index("ix_subtitles_timestamp", "subtitles", ["timestamp"])
