"""
LAMS データベース接続モジュール
非同期PostgreSQL接続を管理
"""

from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.db.models import Base

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
        ``create_all`` は既存テーブルへ列を追加しないため、Alembic 管理導入前に
        作成された永続ボリュームを現行スキーマへ安全に収束させる。各DDLは
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


async def init_db() -> None:
    """現行テーブルを作成し、旧版の永続スキーマを補完する。"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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
