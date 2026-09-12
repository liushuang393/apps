"""会議モード設定の追加 - Phase 3 ハイブリッド 2 主線

README §0 / Phase 3 のハイブリッド設計に対応するため、会議/セッション単位の
モード設定を additive 追加する（既存テーブル・既存行を壊さない後方互換）:
- rooms.default_mode: 会議の既定モード（a / b / hybrid）
- rooms.enable_openai_s2s: 聞く主線（S2S 翻訳音声）の会議レベル許可フラグ
- rooms.language_routes: 言語ペア単位の主線/プロバイダー上書き（JSON）
- meeting_sessions.mode: 進行中セッションのアクティブモード（切替可能）

既存行には server_default で安全な既定値（hybrid / true）を補完する。
language_routes は NULL 許容とし、ORM 既定（空辞書）で新規行を補う。

Revision ID: 007_meeting_mode
Revises: 006_segments
Create Date: 2026-06-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# リビジョン識別子
revision: str = "007_meeting_mode"
down_revision: str | None = "006_segments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """マイグレーション適用（アップグレード）"""
    # --- rooms: 会議の既定モード設定 ---
    op.add_column(
        "rooms",
        sa.Column(
            "default_mode",
            sa.String(10),
            nullable=False,
            server_default="hybrid",
        ),
    )
    op.add_column(
        "rooms",
        sa.Column(
            "enable_openai_s2s",
            sa.Boolean,
            nullable=False,
            server_default=sa.true(),
        ),
    )
    # language_routes は JSON。既存行は NULL 許容とし ORM 既定（空辞書）で補う。
    op.add_column(
        "rooms",
        sa.Column("language_routes", sa.JSON, nullable=True),
    )

    # --- meeting_sessions: 進行中セッションのアクティブモード ---
    op.add_column(
        "meeting_sessions",
        sa.Column(
            "mode",
            sa.String(10),
            nullable=False,
            server_default="hybrid",
        ),
    )


def downgrade() -> None:
    """マイグレーションロールバック（ダウングレード）"""
    op.drop_column("meeting_sessions", "mode")
    op.drop_column("rooms", "language_routes")
    op.drop_column("rooms", "enable_openai_s2s")
    op.drop_column("rooms", "default_mode")
