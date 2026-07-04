"""default_mode の既定値を mode2 基線へ揃える

README / 実装方針では、直近の出荷基線は mode2（`a`）とする。
既存 migration 007 では `rooms.default_mode` / `meeting_sessions.mode` の
server_default が `hybrid` のため、DB 直接挿入や旧 fixture 経由で静かにずれる。

Revision ID: 012_default_mode_a
Revises: 011_participant
Create Date: 2026-07-04
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "012_default_mode_a"
down_revision: str | None = "011_participant"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """rooms / meeting_sessions の既定 mode を `a` へ揃える。"""
    op.alter_column(
        "rooms",
        "default_mode",
        existing_type=sa.String(length=10),
        server_default="a",
        existing_nullable=False,
    )
    op.alter_column(
        "meeting_sessions",
        "mode",
        existing_type=sa.String(length=10),
        server_default="a",
        existing_nullable=False,
    )


def downgrade() -> None:
    """server_default を従来の `hybrid` へ戻す。"""
    op.alter_column(
        "meeting_sessions",
        "mode",
        existing_type=sa.String(length=10),
        server_default="hybrid",
        existing_nullable=False,
    )
    op.alter_column(
        "rooms",
        "default_mode",
        existing_type=sa.String(length=10),
        server_default="hybrid",
        existing_nullable=False,
    )
