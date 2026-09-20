"""専用DBに正規の認証ユーザーと完全ローカル設定を準備する。

入力は所有者ID・生成済みパスワードと専用DATABASE_URL。外部DBを拒否する。
製品のハッシュ関数と永続化処理を使い、認証バイパスを追加しない。
"""

import asyncio
import os
import re

from app.ai_pipeline.effective_config import (
    PipelineSettingsValues,
    save_pipeline_settings,
)
from app.auth.jwt_handler import hash_password
from app.db.database import async_session, engine
from app.db.models import User
from sqlalchemy import text


async def seed() -> None:
    """新規の専用DBだけを初期化し、テスト用ロールを実データとして作る。"""
    owner = os.environ["SONOWA_CERT_OWNER"]
    password = os.environ["SONOWA_CERT_USER_PASSWORD"]
    if not re.fullmatch(r"[a-f0-9]{32}", owner) or len(password) < 32:
        raise ValueError("invalid certification seed input")
    async with async_session() as db:
        database = await db.scalar(text("SELECT current_database()"))
        if database != "sonowa_cert_e2e":
            raise ValueError("certification seed requires its dedicated database")
        if await db.scalar(text("SELECT count(*) FROM users")):
            raise ValueError("certification seed requires an empty users table")
        await db.execute(
            text(
                "CREATE TABLE certification_identity (owner_id text PRIMARY KEY, "
                "app text NOT NULL, environment text NOT NULL, seed_marker text NOT NULL)"
            )
        )
        await db.execute(
            text(
                "INSERT INTO certification_identity VALUES (:owner, 'sonowa', 'e2e', 'certification')"
            ),
            {"owner": owner},
        )
        for role in ("admin", "moderator", "user"):
            db.add(
                User(
                    email=f"{role}@cert.sonowa.example.com",
                    password_hash=hash_password(password),
                    display_name=f"Certification {role}",
                    native_language="ja",
                    role=role,
                    is_active=True,
                )
            )
        await db.flush()
        await save_pipeline_settings(
            db,
            PipelineSettingsValues(
                ai_provider="gpt4o_transcribe",
                asr_provider="local",
                mt_provider="local",
                tts_provider="local",
                default_mode="hybrid",
                enable_partial_subtitles=False,
                llm_correction_enabled=False,
            ),
            updated_by=None,
        )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
