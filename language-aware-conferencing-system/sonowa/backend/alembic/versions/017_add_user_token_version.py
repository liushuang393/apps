"""users.token_version を追加（パスワード変更・再設定時のセッション失効）

JWT の tv クレームと照合し、パスワード変更・再設定より前のトークンを失効させる。
既存ユーザーは 0。tv を持たない旧トークンも 0 とみなすため、デプロイ直後の再ログインは不要。

Revision ID: 017_user_token_version
Revises: 016_experiment_metric
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.migration_guards import add_column_if_absent, has_column

revision: str = "017_user_token_version"
down_revision: str | None = "016_experiment_metric"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """users.token_version（既定 0）を追加する（既存列は skip し冪等）。"""
    add_column_if_absent(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    """users.token_version を削除する。"""
    if has_column("users", "token_version"):
        op.drop_column("users", "token_version")
