"""
LAMS データベース接続モジュール
非同期PostgreSQL接続を管理
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

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


async def init_db() -> None:
    """データベース初期化（テーブル作成）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


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
