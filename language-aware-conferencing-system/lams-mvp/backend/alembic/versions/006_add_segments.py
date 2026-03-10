"""transcript_segment / translation_segment テーブル追加 - 議事録データ設計

改善.md 13.3 / 13.4 に対応する高精度記録テーブルを追加する:
- transcript_segment: ASR 発話単位（provider / confidence / is_final / 時刻）
- translation_segment: 各 target_language の翻訳（provider / llm_provider /
  glossary_version / quality_score）を正規化保存（transcript に対し 1:N）

既存テーブル（subtitles 等）は変更せず、新規テーブルのみを追加する（後方互換）。

Revision ID: 006_segments
Revises: 005_glossary
Create Date: 2026-06-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# リビジョン識別子
revision: str = "006_segments"
down_revision: str | None = "005_glossary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """マイグレーション適用（アップグレード）"""
    # 文字起こしセグメント（改善.md 13.3）
    op.create_table(
        "transcript_segment",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=False),
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("meeting_sessions.id"),
            nullable=True,
        ),
        sa.Column(
            "speaker_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("source_language", sa.String(10), nullable=False),
        sa.Column("start_time_ms", sa.Integer, nullable=True),
        sa.Column("end_time_ms", sa.Integer, nullable=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("is_final", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("provider", sa.String(30), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_transcript_segment_room_id", "transcript_segment", ["room_id"])
    op.create_index(
        "ix_transcript_segment_session_id", "transcript_segment", ["session_id"]
    )
    op.create_index(
        "ix_transcript_segment_created_at", "transcript_segment", ["created_at"]
    )
    # 会議回ごとの時系列読み出し用の複合インデックス
    op.create_index(
        "ix_transcript_session_time",
        "transcript_segment",
        ["session_id", "created_at"],
    )

    # 翻訳セグメント（改善.md 13.4）
    op.create_table(
        "translation_segment",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "transcript_segment_id",
            sa.String(36),
            sa.ForeignKey("transcript_segment.id"),
            nullable=False,
        ),
        sa.Column("source_language", sa.String(10), nullable=False),
        sa.Column("target_language", sa.String(10), nullable=False),
        sa.Column("translated_text", sa.Text, nullable=False),
        sa.Column("provider", sa.String(30), nullable=True),
        sa.Column("llm_provider", sa.String(30), nullable=True),
        sa.Column("glossary_version", sa.String(50), nullable=True),
        sa.Column("quality_score", sa.Float, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_translation_segment_transcript_segment_id",
        "translation_segment",
        ["transcript_segment_id"],
    )
    # セグメント＋対象言語での絞り込み用の複合インデックス
    op.create_index(
        "ix_translation_lookup",
        "translation_segment",
        ["transcript_segment_id", "target_language"],
    )


def downgrade() -> None:
    """マイグレーションロールバック（ダウングレード）"""
    op.drop_index("ix_translation_lookup", table_name="translation_segment")
    op.drop_index(
        "ix_translation_segment_transcript_segment_id",
        table_name="translation_segment",
    )
    op.drop_table("translation_segment")

    op.drop_index("ix_transcript_session_time", table_name="transcript_segment")
    op.drop_index("ix_transcript_segment_created_at", table_name="transcript_segment")
    op.drop_index("ix_transcript_segment_session_id", table_name="transcript_segment")
    op.drop_index("ix_transcript_segment_room_id", table_name="transcript_segment")
    op.drop_table("transcript_segment")
