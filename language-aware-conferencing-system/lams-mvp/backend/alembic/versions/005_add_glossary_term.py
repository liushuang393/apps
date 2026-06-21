"""glossary_term テーブル追加 - 用語集エンジン

Mode B（ASR→MT+用語集→字幕）の精度の核となる用語集を管理するテーブル:
- source_term / target_term: 用語と指定訳
- do_not_translate: 翻訳禁止語フラグ（原語保持）
- priority: 適用優先度（大きいほど優先）
- enabled: 有効/無効
- tenant_id: 将来のマルチテナント拡張用（None=グローバル）

既存テーブルは変更せず、新規テーブルのみを追加する（後方互換）。

Revision ID: 005_glossary
Revises: 004_sysconfig
Create Date: 2026-06-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# リビジョン識別子
revision: str = "005_glossary"
down_revision: str | None = "004_sysconfig"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """マイグレーション適用（アップグレード）"""
    op.create_table(
        "glossary_term",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=True),
        sa.Column("source_language", sa.String(10), nullable=False),
        sa.Column("target_language", sa.String(10), nullable=False),
        sa.Column("source_term", sa.String(255), nullable=False),
        sa.Column("target_term", sa.String(255), nullable=True),
        sa.Column(
            "term_type", sa.String(30), nullable=False, server_default="general"
        ),
        sa.Column("priority", sa.Integer, nullable=False, server_default="100"),
        sa.Column(
            "do_not_translate",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
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
    # tenant_id 単体インデックス
    op.create_index(
        "ix_glossary_term_tenant_id", "glossary_term", ["tenant_id"]
    )
    # source_term 単体インデックス
    op.create_index(
        "ix_glossary_term_source_term", "glossary_term", ["source_term"]
    )
    # 翻訳ホットパス用の複合インデックス（言語ペア＋有効フラグ）
    op.create_index(
        "ix_glossary_lookup",
        "glossary_term",
        ["source_language", "target_language", "enabled"],
    )


def downgrade() -> None:
    """マイグレーションロールバック（ダウングレード）"""
    op.drop_index("ix_glossary_lookup", table_name="glossary_term")
    op.drop_index("ix_glossary_term_source_term", table_name="glossary_term")
    op.drop_index("ix_glossary_term_tenant_id", table_name="glossary_term")
    op.drop_table("glossary_term")
