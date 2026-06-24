"""participant テーブル追加（改善.md §13.2）

参加者設定（Redis/room_manager）の耐久記録。会議後の履歴・監査・再入室時の
設定復元の一次ソース。(room_id, user_id) で一意（write-through の upsert キー）。

Revision ID: 011_participant
Revises: 010_qos_summary
Create Date: 2026-06-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "011_participant"
down_revision: str | None = "010_qos_summary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """participant テーブルを作成する。"""
    op.create_table(
        "participant",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=False),
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("meeting_sessions.id"),
            nullable=True,
        ),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("preferred_language", sa.String(10), nullable=False),
        sa.Column("output_language", sa.String(10), nullable=False),
        sa.Column(
            "voice_translation_enabled",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_participant_room_id", "participant", ["room_id"])
    op.create_index("ix_participant_session_id", "participant", ["session_id"])
    op.create_index("ix_participant_user_id", "participant", ["user_id"])
    op.create_index(
        "ix_participant_room_user", "participant", ["room_id", "user_id"], unique=True
    )


def downgrade() -> None:
    """participant テーブルを削除する。"""
    op.drop_table("participant")
