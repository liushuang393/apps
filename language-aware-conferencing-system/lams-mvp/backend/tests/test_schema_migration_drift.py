"""create_all 先行によるスキーマドリフトからの Alembic 収束を検証する。

背景:
    起動時の ``Base.metadata.create_all`` は未適用マイグレーションのテーブルを
    先に作る一方、既存テーブルへ列を追加しない。このため ``alembic_version`` が
    古いまま新テーブルだけが存在する状態（ドリフト）に陥り、
    ``alembic upgrade head`` が DuplicateTable で失敗し、後続マイグレーションが
    追加すべき列（transcript_segment.speaker_label）も永久に欠落する。

検証内容:
    実 PostgreSQL 上の scratch DB へ受入時と同じドリフト（012 まで migration →
    create_all）を再現し、head へ非破壊で収束できることを確認する。あわせて
    「モデル定義のテーブルは全てマイグレーションで作られる」不変条件を検証し、
    起動時 create_all をスキーマ権威に戻さないことを担保する。

注意:
    実 DB 接続が必要なため、接続できない環境では skip する。本番 DB は変更せず
    scratch DB のみを作成・破棄する。
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.config import settings

DRIFT_DB = "lams_migration_drift_test"
FRESH_DB = "lams_migration_fresh_test"
BASELINE_REVISION = "012_default_mode_a"
HEAD_REVISION = "016_experiment_metric"
BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _base_dsn() -> str:
    """設定 DATABASE_URL から DB 名を除いた接続先を返す。"""
    base, _, _ = settings.database_url.rpartition("/")
    return base


def _dsn(db_name: str) -> str:
    """指定 DB への同期 DSN（asyncpg 用）を返す。"""
    return f"{_base_dsn()}/{db_name}"


async def _connect(dsn: str):
    """asyncpg 接続を 5 秒タイムアウトで開く。"""
    import asyncpg

    return await asyncio.wait_for(asyncpg.connect(dsn), timeout=5)


async def _probe() -> None:
    """接続可否のみを確認する（skip 判定用）。"""
    conn = await _connect(_dsn("postgres"))
    await conn.close()


async def _recreate_db(db_name: str) -> None:
    """scratch DB を作り直す（既存があれば破棄）。"""
    conn = await _connect(_dsn("postgres"))
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
        await conn.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        await conn.close()


async def _drop_db(db_name: str) -> None:
    """scratch DB を破棄する（後片付け）。"""
    conn = await _connect(_dsn("postgres"))
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
    finally:
        await conn.close()


async def _apply_create_all(db_name: str) -> None:
    """アプリ旧起動時の create_all 相当を scratch DB へ適用する。"""
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.db.models import Base

    url = _dsn(db_name).replace("postgresql://", "postgresql+asyncpg://")
    engine = create_async_engine(url)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await engine.dispose()


async def _query_scalar(db_name: str, sql: str) -> object:
    """scratch DB に対する単一値クエリを実行する。"""
    conn = await _connect(_dsn(db_name))
    try:
        return await conn.fetchval(sql)
    finally:
        await conn.close()


async def _table_columns(db_name: str, table: str) -> set[str]:
    """scratch DB の指定テーブルの列名集合を返す。"""
    conn = await _connect(_dsn(db_name))
    try:
        rows = await conn.fetch(
            "select column_name from information_schema.columns where table_name=$1",
            table,
        )
        return {row["column_name"] for row in rows}
    finally:
        await conn.close()


async def _table_names(db_name: str) -> set[str]:
    """scratch DB の public スキーマのテーブル名集合を返す。"""
    conn = await _connect(_dsn(db_name))
    try:
        rows = await conn.fetch(
            "select table_name from information_schema.tables "
            "where table_schema='public'"
        )
        return {row["table_name"] for row in rows} - {"alembic_version"}
    finally:
        await conn.close()


def _alembic_upgrade(db_name: str, target: str) -> subprocess.CompletedProcess[str]:
    """scratch DB に対する alembic upgrade を CLI で実行する。"""
    env = {**os.environ, "DATABASE_URL": _dsn(db_name)}
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", target],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )


def _skip_unless_postgres() -> None:
    """PostgreSQL へ接続できない環境では skip する。"""
    try:
        asyncio.run(_probe())
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"PostgreSQL へ接続できないため skip: {type(exc).__name__}")


@pytest.fixture(scope="module")
def drifted_cli_upgrade() -> dict[str, object]:
    """ドリフト DB へ alembic CLI で head を適用した結果を返す。"""
    _skip_unless_postgres()
    asyncio.run(_recreate_db(DRIFT_DB))
    baseline = _alembic_upgrade(DRIFT_DB, BASELINE_REVISION)
    assert baseline.returncode == 0, (
        f"前提の {BASELINE_REVISION} への upgrade が失敗した: {baseline.stderr[-2000:]}"
    )
    asyncio.run(_apply_create_all(DRIFT_DB))

    head = _alembic_upgrade(DRIFT_DB, "head")
    columns = asyncio.run(_table_columns(DRIFT_DB, "transcript_segment"))
    asyncio.run(_drop_db(DRIFT_DB))
    return {
        "returncode": head.returncode,
        "stderr": head.stderr,
        "columns": columns,
    }


@pytest.fixture(scope="module")
def drifted_startup_upgrade() -> dict[str, object]:
    """ドリフト DB へ起動時マイグレーション（init_db 相当）を適用した結果を返す。"""
    _skip_unless_postgres()
    from app.db.database import run_migrations_to_head

    asyncio.run(_recreate_db(FRESH_DB))
    baseline = _alembic_upgrade(FRESH_DB, BASELINE_REVISION)
    assert baseline.returncode == 0, (
        f"前提の {BASELINE_REVISION} への upgrade が失敗した: {baseline.stderr[-2000:]}"
    )
    asyncio.run(_apply_create_all(FRESH_DB))

    asyncio.run(run_migrations_to_head(_dsn(FRESH_DB)))
    version = asyncio.run(
        _query_scalar(FRESH_DB, "select version_num from alembic_version")
    )
    columns = asyncio.run(_table_columns(FRESH_DB, "transcript_segment"))
    tables = asyncio.run(_table_names(FRESH_DB))
    asyncio.run(_drop_db(FRESH_DB))
    return {"version": version, "columns": columns, "tables": tables}


def test_upgrade_head_succeeds_after_create_all_drift(
    drifted_cli_upgrade: dict[str, object],
) -> None:
    """create_all 先行で作られたテーブルがあっても head へ収束できる。"""
    stderr = str(drifted_cli_upgrade["stderr"])[-1500:]
    assert drifted_cli_upgrade["returncode"] == 0, (
        f"alembic upgrade head が失敗した: {stderr}"
    )


def test_speaker_label_column_added_after_create_all_drift(
    drifted_cli_upgrade: dict[str, object],
) -> None:
    """ドリフト DB でも transcript_segment.speaker_label が補完される。"""
    columns = drifted_cli_upgrade["columns"]
    assert isinstance(columns, set)
    assert "speaker_label" in columns, (
        "transcript_segment.speaker_label が欠落している（字幕履歴保存が失敗する）"
    )


def test_startup_migration_converges_drifted_db_to_head(
    drifted_startup_upgrade: dict[str, object],
) -> None:
    """起動時マイグレーションがドリフト DB を head まで収束させる。"""
    assert drifted_startup_upgrade["version"] == HEAD_REVISION


def test_startup_migration_adds_missing_speaker_label(
    drifted_startup_upgrade: dict[str, object],
) -> None:
    """起動時マイグレーションが欠落列 speaker_label を補完する。"""
    columns = drifted_startup_upgrade["columns"]
    assert isinstance(columns, set)
    assert "speaker_label" in columns


def test_migrations_cover_all_model_tables(
    drifted_startup_upgrade: dict[str, object],
) -> None:
    """モデル定義の全テーブルがマイグレーション適用後に存在する。

    起動時 create_all をスキーマ権威に戻さないための不変条件。
    """
    from app.db.models import Base

    tables = drifted_startup_upgrade["tables"]
    assert isinstance(tables, set)
    missing = set(Base.metadata.tables.keys()) - tables
    assert not missing, f"マイグレーションで作られないモデルテーブルがある: {missing}"
