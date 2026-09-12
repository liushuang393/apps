"""[smoke] 字幕履歴の DB 保存が話者ラベル付きで成功することを実 DB で確認する（ブロッカー2）。

背景:
    受入時は ``transcript_segment.speaker_label`` 列が無く、実保存が
    ``UndefinedColumnError`` で継続的に失敗していた。保存側は例外を warning に
    落として続行する設計のため、症状は「静かなデータ欠落」として現れる。

実行:
    docker compose exec -T backend python /tmp/smoke_db.py <room_id> <speaker_user_id>

判定:
    exit 0 = 緑（segment id が返り、speaker_label と翻訳行が実 DB に残る）
    exit 1 = 赤（保存失敗＝ユーザー症状）

注意:
    ``speaker_id`` は ``users`` への外部キーであるため、実在するユーザー id を渡す。
"""

from __future__ import annotations

import asyncio
import sys

SPEAKER_LABEL = "受入再検証ユーザー"
SOURCE_TEXT = "予算は 1,200 万円、納期は 2026-06-24 です"
TRANSLATIONS = {"en": "The budget is 12 million yen and the due date is 2026-06-24"}


async def main(room_id: str, speaker_id: str) -> int:
    """実 DB へ 1 発話を保存し、話者ラベルと翻訳行の永続化を検証する。"""
    from sqlalchemy import select

    from app.db.database import async_session
    from app.db.models import TranscriptSegment, TranslationSegment
    from app.webrtc.persistence import save_transcript_segment

    seg_id = await save_transcript_segment(
        room_id=room_id,
        speaker_id=speaker_id,
        source_language="ja",
        text=SOURCE_TEXT,
        translations=TRANSLATIONS,
        tags=[{"target_language": "en", "subtitle_mainline": "hearing"}],
        speaker_label=SPEAKER_LABEL,
    )
    if seg_id is None:
        print("[SMOKE-DB] RED: save_transcript_segment が None（保存失敗）")
        return 1

    async with async_session() as db:
        seg = (
            await db.execute(
                select(TranscriptSegment).where(TranscriptSegment.id == seg_id)
            )
        ).scalar_one_or_none()
        translations = (
            (
                await db.execute(
                    select(TranslationSegment).where(
                        TranslationSegment.transcript_segment_id == seg_id
                    )
                )
            )
            .scalars()
            .all()
        )

    if seg is None:
        print("[SMOKE-DB] RED: 保存した segment が読み出せない")
        return 1
    print(f"[SMOKE-DB] segment id       : {seg.id}")
    print(f"[SMOKE-DB] speaker_label    : {seg.speaker_label}")
    print(f"[SMOKE-DB] source_language  : {seg.source_language}")
    print(f"[SMOKE-DB] translation rows : {len(translations)}")
    for row in translations:
        print(f"[SMOKE-DB]   {row.target_language} provider={row.provider}")

    if seg.speaker_label != SPEAKER_LABEL:
        print("[SMOKE-DB] RED: speaker_label が永続化されていない")
        return 1
    if not translations:
        print("[SMOKE-DB] RED: 翻訳行が保存されていない")
        return 1
    print("[SMOKE-DB] GREEN: 話者ラベル付きで字幕履歴が保存された")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(
            "usage: python smoke_transcript_persistence.py <room_id> <speaker_user_id>"
        )
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1], sys.argv[2])))
