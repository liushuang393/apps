"""
LAMS データベース接続モジュール
非同期PostgreSQL接続を管理
"""

import asyncio
import logging
import os
from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

logger = logging.getLogger(__name__)

# backend ルート（alembic.ini / alembic ディレクトリの所在）
_BACKEND_ROOT = Path(__file__).resolve().parents[2]

# 非同期エンジン作成（postgresql → postgresql+asyncpg）
_db_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")
engine = create_async_engine(
    _db_url,
    echo=(settings.env == "development"),
    pool_pre_ping=True,
)

# セッションファクトリ
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def _reconcile_legacy_schema(conn: AsyncConnection) -> None:
    """旧版の既存テーブルへ現行モデルで必須となる列を補完する。

    Args:
        conn: 初期化トランザクションで使用する非同期DB接続。

    Returns:
        None。

    Notes:
        Alembic 管理導入前に作成された永続ボリューム（alembic_version を持たず
        旧スキーマのままのもの）を現行スキーマへ安全に収束させる互換層。各DDLは
        ``IF NOT EXISTS`` を使用し、再起動時にも冪等である。
    """
    statements = (
        "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "
        "default_mode VARCHAR(10) NOT NULL DEFAULT 'a'",
        "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "
        "enable_openai_s2s BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "
        "language_routes JSON NOT NULL DEFAULT '{}'::json",
        "ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS "
        "mode VARCHAR(10) NOT NULL DEFAULT 'a'",
        "ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS qos_summary JSON",
    )
    for statement in statements:
        await conn.execute(text(statement))


def _upgrade_to_head(database_url: str) -> None:
    """同期スレッドで ``alembic upgrade head`` を実行する。

    Args:
        database_url: 対象DBの接続URL（env.py が ``DATABASE_URL`` として参照）。

    Returns:
        None。

    Notes:
        alembic の env.py は内部で ``asyncio.run`` を呼ぶため、実行中の
        イベントループからは直接呼べない（別スレッドで実行する）。
        ``alembic.ini`` を読み込ませない（config_file_name を None に保つ）ことで
        env.py 側の ``fileConfig`` によるアプリのログ設定上書きを避ける。
    """
    from alembic.config import Config

    from alembic import command

    config = Config()
    config.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    try:
        command.upgrade(config, "head")
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous


async def run_migrations_to_head(database_url: str | None = None) -> None:
    """スキーマを Alembic head へ収束させる（スキーマ権威は Alembic 単一）。

    Args:
        database_url: 対象DB。省略時は設定値（``settings.database_url``）。

    Returns:
        None。

    Raises:
        Exception: マイグレーション失敗時（起動を継続せず即座に失敗させる）。

    Notes:
        起動時に ``create_all`` でテーブルを先行作成するとマイグレーション履歴と
        実スキーマが乖離し、既存テーブルへの列追加が永久に欠落する。スキーマの
        生成・変更は本関数（Alembic）のみが行う。
    """
    url = database_url or settings.database_url
    try:
        await asyncio.to_thread(_upgrade_to_head, url)
    except Exception:
        logger.error(
            "DBマイグレーション（alembic upgrade head）に失敗した。"
            "スキーマが不整合のため起動を中止する。"
            "`alembic current` / `alembic history` で履歴を確認すること。"
        )
        raise


async def init_db() -> None:
    """スキーマを head へ収束させ、Alembic 管理前の永続スキーマを補完する。"""
    await run_migrations_to_head()
    async with engine.begin() as conn:
        await _reconcile_legacy_schema(conn)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    データベースセッション取得（依存性注入用）
    使用後は自動的にクローズ
    """
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
