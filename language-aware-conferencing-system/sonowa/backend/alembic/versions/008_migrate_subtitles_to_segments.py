"""既存 subtitles を transcript_segment / translation_segment へ前進移行

改善.md §13.3/§13.4 への一本化に伴い、旧 Subtitle（翻訳を JSON 1 行で保持）を
正規化テーブルへ移す。各 subtitle 1 行 → transcript_segment 1 行 ＋ translations の
言語数ぶんの translation_segment 行へ展開する。

provider / confidence 等のメタデータは旧データに存在しないため null とする。
冪等性のため、既に transcript_segment が存在する環境では何もしない（二重移行防止）。
downgrade はデータ移行のため no-op（segment 側は 006 の downgrade で破棄される）。

Revision ID: 008_migrate_subtitles
Revises: 007_meeting_mode
Create Date: 2026-06-24
"""

import json
import logging
import uuid
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "008_migrate_subtitles"
down_revision: str | None = "007_meeting_mode"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.migration")


def upgrade() -> None:
    """subtitles 行を segment テーブルへ前進変換する（冪等）。"""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    # subtitles が無い、または移行先が無ければ何もしない
    if "subtitles" not in tables or "transcript_segment" not in tables:
        return
    # 既に移行済み（segment にデータあり）ならスキップ（二重移行防止）
    existing = bind.execute(sa.text("SELECT COUNT(*) FROM transcript_segment")).scalar()
    if existing:
        logger.info("[008] transcript_segment に既存データあり。移行スキップ")
        return

    rows = (
        bind.execute(
            sa.text(
                "SELECT id, room_id, session_id, speaker_id, original_text, "
                "original_language, translations, timestamp FROM subtitles"
            )
        )
        .mappings()
        .all()
    )

    migrated_ts = 0
    migrated_tr = 0
    for r in rows:
        seg_id = str(uuid.uuid4())
        bind.execute(
            sa.text(
                "INSERT INTO transcript_segment "
                "(id, room_id, session_id, speaker_id, source_language, text, "
                " is_final, created_at) "
                "VALUES (:id, :room_id, :session_id, :speaker_id, :src, :text, "
                " :is_final, :created_at)"
            ),
            {
                "id": seg_id,
                "room_id": r["room_id"],
                "session_id": r["session_id"],
                "speaker_id": r["speaker_id"],
                "src": r["original_language"],
                "text": r["original_text"],
                "is_final": True,
                "created_at": r["timestamp"],
            },
        )
        migrated_ts += 1

        translations = r["translations"]
        if isinstance(translations, str):
            try:
                translations = json.loads(translations)
            except (ValueError, TypeError):
                translations = {}
        for target_lang, translated_text in (translations or {}).items():
            if not translated_text:
                continue
            bind.execute(
                sa.text(
                    "INSERT INTO translation_segment "
                    "(id, transcript_segment_id, source_language, target_language, "
                    " translated_text, created_at) "
                    "VALUES (:id, :tsid, :src, :tgt, :txt, :created_at)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tsid": seg_id,
                    "src": r["original_language"],
                    "tgt": target_lang,
                    "txt": translated_text,
                    "created_at": r["timestamp"],
                },
            )
            migrated_tr += 1

    logger.info(
        "[008] 移行完了: transcript_segment=%d, translation_segment=%d",
        migrated_ts,
        migrated_tr,
    )


def downgrade() -> None:
    """データ移行のため downgrade は何もしない（segment は 006 の downgrade で破棄）。"""
    pass
