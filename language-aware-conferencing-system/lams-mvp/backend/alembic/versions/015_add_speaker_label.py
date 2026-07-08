"""話者分離ラベル列を追加（改善案 §4 / P4-A diarization）

TranscriptSegment / PipelineEvent に speaker_label（識別/クラスタリング結果の表示
ラベル）を追加する。speaker_id（LiveKit track 由来の権威）は不変で、本列は増強情報。

Revision ID: 015_speaker_label
Revises: 014_pipeline_event
Create Date: 2026-07-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "015_speaker_label"
down_revision: str | None = "014_pipeline_event"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """transcript_segment / pipeline_event に speaker_label を追加する。"""
    op.add_column(
        "transcript_segment",
        sa.Column("speaker_label", sa.String(100), nullable=True),
    )
    op.add_column(
        "pipeline_event",
        sa.Column("speaker_label", sa.String(100), nullable=True),
    )


def downgrade() -> None:
    """speaker_label 列を削除する。"""
    op.drop_column("pipeline_event", "speaker_label")
    op.drop_column("transcript_segment", "speaker_label")
