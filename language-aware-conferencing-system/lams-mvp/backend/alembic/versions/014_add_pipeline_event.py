"""中間パイプライン事件・離線重跑結果テーブル追加（改善.md §5.3 / P3-D）

会議後に最強モデルで再処理（離線重跑）するための回放ログ（pipeline_event）と、
高品質再処理結果（rerun_result）を追加する。音声バイト列は保存せず audio_hash
（暗号化アーカイブ参照）のみを持つ。実時記録テーブルは不変で、高品質版は分離する。

Revision ID: 014_pipeline_event
Revises: 013_training_data
Create Date: 2026-07-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "014_pipeline_event"
down_revision: str | None = "013_training_data"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """回放ログと重跑結果の 2 テーブルを作成する。"""
    op.create_table(
        "pipeline_event",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=True),
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("meeting_sessions.id"),
            nullable=True,
        ),
        sa.Column(
            "transcript_segment_id",
            sa.String(36),
            sa.ForeignKey("transcript_segment.id"),
            nullable=True,
        ),
        sa.Column(
            "speaker_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("seq", sa.Integer, nullable=True),
        sa.Column("source_language", sa.String(10), nullable=False),
        sa.Column("audio_hash", sa.String(64), nullable=True),
        sa.Column("asr_text", sa.Text, nullable=False),
        sa.Column("translations", sa.JSON, nullable=True),
        sa.Column("tags", sa.JSON, nullable=True),
        sa.Column("degraded", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("trace_id", sa.String(100), nullable=True),
        sa.Column(
            "rerun_status", sa.String(10), nullable=False, server_default="pending"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_pipeline_event_room_id", "pipeline_event", ["room_id"])
    op.create_index("ix_pipeline_event_session_id", "pipeline_event", ["session_id"])
    op.create_index(
        "ix_pipeline_event_segment", "pipeline_event", ["transcript_segment_id"]
    )
    op.create_index("ix_pipeline_event_created", "pipeline_event", ["created_at"])
    op.create_index(
        "ix_pipeline_event_session_status",
        "pipeline_event",
        ["session_id", "rerun_status"],
    )

    op.create_table(
        "rerun_result",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "pipeline_event_id",
            sa.String(36),
            sa.ForeignKey("pipeline_event.id"),
            nullable=False,
        ),
        sa.Column(
            "transcript_segment_id",
            sa.String(36),
            sa.ForeignKey("transcript_segment.id"),
            nullable=True,
        ),
        sa.Column("source_language", sa.String(10), nullable=False),
        sa.Column("asr_text", sa.Text, nullable=False),
        sa.Column("translations", sa.JSON, nullable=True),
        sa.Column("asr_model", sa.String(50), nullable=True),
        sa.Column("mt_model", sa.String(50), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_rerun_result_event", "rerun_result", ["pipeline_event_id"])
    op.create_index(
        "ix_rerun_result_segment", "rerun_result", ["transcript_segment_id"]
    )


def downgrade() -> None:
    """回放ログと重跑結果テーブルを削除する（FK 逆順）。"""
    op.drop_table("rerun_result")
    op.drop_table("pipeline_event")
