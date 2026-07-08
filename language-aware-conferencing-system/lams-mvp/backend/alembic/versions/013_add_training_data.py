"""訓練データ闭环テーブル追加（改善.md §5.2 / P3-C）

ASR/翻訳の訂正ペア、話者エンロールメント、TTS 同意、評価集を追加する。評価集は
訓練テーブルと物理的に分離し「評価データは学習に混入させない」不変条件を担保する。
音声バイト列は保存せず audio_hash（暗号化アーカイブ参照）のみを持つ。

Revision ID: 013_training_data
Revises: 012_default_mode_a
Create Date: 2026-07-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "013_training_data"
down_revision: str | None = "012_default_mode_a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """訓練データ闭环の 5 テーブルを作成する。"""
    op.create_table(
        "asr_correction",
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
        sa.Column("source_language", sa.String(10), nullable=False),
        sa.Column("audio_hash", sa.String(64), nullable=True),
        sa.Column("asr_text", sa.Text, nullable=False),
        sa.Column("corrected_text", sa.Text, nullable=False),
        sa.Column("corrected_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("split", sa.String(10), nullable=False, server_default="train"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_asr_correction_room_id", "asr_correction", ["room_id"])
    op.create_index("ix_asr_correction_session_id", "asr_correction", ["session_id"])
    op.create_index(
        "ix_asr_correction_segment",
        "asr_correction",
        ["transcript_segment_id"],
    )
    op.create_index("ix_asr_correction_lang", "asr_correction", ["source_language"])
    op.create_index("ix_asr_correction_split", "asr_correction", ["split"])
    op.create_index("ix_asr_correction_created", "asr_correction", ["created_at"])

    op.create_table(
        "translation_correction",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "translation_segment_id",
            sa.String(36),
            sa.ForeignKey("translation_segment.id"),
            nullable=True,
        ),
        sa.Column("source_language", sa.String(10), nullable=False),
        sa.Column("target_language", sa.String(10), nullable=False),
        sa.Column("source_text", sa.Text, nullable=False),
        sa.Column("mt_text", sa.Text, nullable=False),
        sa.Column("corrected_text", sa.Text, nullable=False),
        sa.Column("corrected_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("glossary_version", sa.String(50), nullable=True),
        sa.Column("split", sa.String(10), nullable=False, server_default="train"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_tc_segment", "translation_correction", ["translation_segment_id"]
    )
    op.create_index("ix_tc_src", "translation_correction", ["source_language"])
    op.create_index("ix_tc_tgt", "translation_correction", ["target_language"])
    op.create_index("ix_tc_split", "translation_correction", ["split"])
    op.create_index("ix_tc_created", "translation_correction", ["created_at"])

    op.create_table(
        "speaker_enrollment",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=True),
        sa.Column("speaker_label", sa.String(100), nullable=False),
        sa.Column("embedding", sa.JSON, nullable=True),
        sa.Column("consent", sa.Boolean, nullable=False, server_default=sa.false()),
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
    op.create_index("ix_enrollment_user_id", "speaker_enrollment", ["user_id"])
    op.create_index("ix_enrollment_room_id", "speaker_enrollment", ["room_id"])
    op.create_index(
        "ix_enrollment_user_label",
        "speaker_enrollment",
        ["user_id", "speaker_label"],
        unique=True,
    )

    op.create_table(
        "tts_consent",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("voice_id", sa.String(100), nullable=False),
        sa.Column("scope", sa.String(30), nullable=False, server_default="meeting"),
        sa.Column("granted", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column(
            "watermark_required", sa.Boolean, nullable=False, server_default=sa.true()
        ),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_tts_consent_user_id", "tts_consent", ["user_id"])
    op.create_index("ix_tts_consent_voice_id", "tts_consent", ["voice_id"])

    op.create_table(
        "evaluation_sample",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("source_language", sa.String(10), nullable=False),
        sa.Column("target_language", sa.String(10), nullable=True),
        sa.Column("input_text", sa.Text, nullable=True),
        sa.Column("audio_hash", sa.String(64), nullable=True),
        sa.Column("reference_text", sa.Text, nullable=False),
        sa.Column("notes", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_eval_stage", "evaluation_sample", ["stage"])
    op.create_index("ix_eval_src", "evaluation_sample", ["source_language"])


def downgrade() -> None:
    """訓練データ闭环テーブルを削除する。"""
    op.drop_table("evaluation_sample")
    op.drop_table("tts_consent")
    op.drop_table("speaker_enrollment")
    op.drop_table("translation_correction")
    op.drop_table("asr_correction")
