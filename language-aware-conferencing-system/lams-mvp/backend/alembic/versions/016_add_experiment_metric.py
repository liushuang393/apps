"""A/B 実験の観測指標テーブルを追加（改善案 §5.1 / P4-C）

experiment_metric（実験群ごとの品質/遅延などの観測値）を追加する。実験の配信判定は
ab_testing.py（純ロジック・決定的）が行い、本テーブルは結果の永続層のみを担う。

Revision ID: 016_experiment_metric
Revises: 015_speaker_label
Create Date: 2026-07-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "016_experiment_metric"
down_revision: str | None = "015_speaker_label"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """experiment_metric テーブルと索引を作成する。"""
    op.create_table(
        "experiment_metric",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("experiment_key", sa.String(length=100), nullable=False),
        sa.Column("variant", sa.String(length=50), nullable=False),
        sa.Column("unit_id", sa.String(length=100), nullable=True),
        sa.Column("stage", sa.String(length=20), nullable=True),
        sa.Column("metric_name", sa.String(length=50), nullable=False),
        sa.Column("metric_value", sa.Float(), nullable=False),
        sa.Column("room_id", sa.String(length=36), nullable=True),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["meeting_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_experiment_metric_experiment_key",
        "experiment_metric",
        ["experiment_key"],
    )
    op.create_index(
        "ix_experiment_metric_created_at",
        "experiment_metric",
        ["created_at"],
    )
    op.create_index(
        "ix_experiment_metric_key_variant",
        "experiment_metric",
        ["experiment_key", "variant"],
    )


def downgrade() -> None:
    """experiment_metric テーブルと索引を削除する。"""
    op.drop_index("ix_experiment_metric_key_variant", table_name="experiment_metric")
    op.drop_index("ix_experiment_metric_created_at", table_name="experiment_metric")
    op.drop_index(
        "ix_experiment_metric_experiment_key", table_name="experiment_metric"
    )
    op.drop_table("experiment_metric")
