"""system_config テーブル追加 - システム全体設定管理

対応言語設定など、システム全体で共有される設定を管理するためのテーブル:
- key: 設定キー（unique）
- value: JSON文字列
- updated_at: 更新日時
- updated_by: 更新ユーザーID

Revision ID: 004_sysconfig
Revises: 003_sessions
Create Date: 2026-01-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# リビジョン識別子
revision: str = "004_sysconfig"
down_revision: Union[str, None] = "003_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """マイグレーション適用（アップグレード）"""
    # system_config テーブル作成
    op.create_table(
        "system_config",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(50), unique=True, nullable=False, index=True),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("updated_by", sa.String(36), nullable=True),
    )

    # デフォルトの言語設定を挿入
    op.execute(
        """
        INSERT INTO system_config (key, value, updated_at)
        VALUES ('enabled_languages', '["ja", "en", "zh", "vi"]', NOW())
    """
    )


def downgrade() -> None:
    """マイグレーションロールバック（ダウングレード）"""
    op.drop_table("system_config")
