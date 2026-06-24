"""meeting_sessions に qos_summary 列を追加（改善.md §15 品質ゲート）

会議終了時に書き込む QoS サマリ（現状は数字保持率）を保持する JSON 列。
追加のみ・nullable のため後方互換。

Revision ID: 010_qos_summary
Revises: 009_drop_subtitles
Create Date: 2026-06-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "010_qos_summary"
down_revision: str | None = "009_drop_subtitles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """qos_summary 列を追加する。"""
    op.add_column(
        "meeting_sessions",
        sa.Column("qos_summary", sa.JSON, nullable=True),
    )


def downgrade() -> None:
    """qos_summary 列を削除する。"""
    op.drop_column("meeting_sessions", "qos_summary")
