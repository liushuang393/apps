"""
LAMS Alembic 環境設定
マイグレーション実行時の環境を設定
"""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# モデルのインポート（メタデータ取得用）
from app.db.models import Base

# Alembic Config オブジェクト
config = context.config

# ログ設定
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# メタデータ（マイグレーション自動生成用）
target_metadata = Base.metadata


def get_url() -> str:
    """
    データベースURLを取得
    環境変数 DATABASE_URL があれば優先、なければalembic.iniの設定を使用
    非同期ドライバ(asyncpg)用にURLを変換
    """
    url = os.environ.get("DATABASE_URL")
    if url:
        # postgresql:// → postgresql+asyncpg:// に変換
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url
    return config.get_main_option("sqlalchemy.url", "")


def run_migrations_offline() -> None:
    """
    オフラインモードでマイグレーション実行
    SQLスクリプトを生成するだけで、DBに接続しない
    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """マイグレーション実行（内部関数）"""
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """
    非同期モードでマイグレーション実行
    実際にDBに接続してマイグレーションを適用
    """
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_url()
    
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """
    オンラインモードでマイグレーション実行
    非同期エンジンを使用
    """
    import asyncio
    asyncio.run(run_async_migrations())


# 実行モード判定
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

