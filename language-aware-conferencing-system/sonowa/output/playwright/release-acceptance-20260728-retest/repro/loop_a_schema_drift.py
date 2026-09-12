"""[debug harness] Alembic schema drift の再現ループ（ブロッカー1・2）。

目的:
    受入時の実DB状態（alembic_version=012 のまま、013 以降のテーブルは
    ``Base.metadata.create_all`` で先に作られている）を scratch DB 上へ再現し、
    ``alembic upgrade head`` と ``transcript_segment.speaker_label`` の
    2 つの症状を 1 コマンドで赤／緑判定する。

実行:
    docker compose exec -T backend python - < loop_a_schema_drift.py

判定:
    exit 0 = 緑（upgrade head 成功 + speaker_label 存在）
    exit 1 = 赤（いずれかの症状が再現）

注意:
    使い捨てのデバッグ用ハーネス。scratch DB のみを作成・破棄し、本番 DB
    （lams）へは一切書き込まない。接続情報は環境変数からのみ取得し出力しない。
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys

SCRATCH_DB = "lams_drift_repro"


def _scratch_url(sync: bool = False) -> str:
    """本番 DATABASE_URL の DB 名だけを scratch DB へ差し替えた URL を返す。"""
    url = os.environ["DATABASE_URL"]
    base, _, _ = url.rpartition("/")
    scratch = f"{base}/{SCRATCH_DB}"
    if sync:
        return scratch
    return scratch


def _admin_dsn() -> str:
    """scratch DB を作成/破棄するための管理接続（postgres DB）を返す。"""
    url = os.environ["DATABASE_URL"]
    base, _, _ = url.rpartition("/")
    return f"{base}/postgres"


async def _recreate_scratch() -> None:
    """scratch DB を作り直す（既存があれば破棄）。"""
    import asyncpg

    dsn = _admin_dsn().replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{SCRATCH_DB}"')
        await conn.execute(f'CREATE DATABASE "{SCRATCH_DB}"')
    finally:
        await conn.close()


def _alembic(target: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """scratch DB に対して alembic upgrade を実行する。"""
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", target],
        cwd="/app",
        env=env,
        capture_output=True,
        text=True,
    )


async def _create_all_like_startup() -> None:
    """アプリ起動時の init_db 相当（現行モデルの create_all）を scratch DB へ適用。"""
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.db.models import Base

    url = _scratch_url().replace("postgresql://", "postgresql+asyncpg://")
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()


async def _column_exists(table: str, column: str) -> bool:
    """scratch DB の指定列が存在するかを返す。"""
    import asyncpg

    dsn = _scratch_url().replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    try:
        row = await conn.fetchval(
            "select count(*) from information_schema.columns "
            "where table_name=$1 and column_name=$2",
            table,
            column,
        )
        return bool(row)
    finally:
        await conn.close()


async def main() -> int:
    """ドリフト状態を再現し 2 症状を判定する。"""
    env = dict(os.environ)
    env["DATABASE_URL"] = _scratch_url()

    await _recreate_scratch()

    step = _alembic("012_default_mode_a", env)
    if step.returncode != 0:
        print("[LOOP-A] 前提失敗: 012 までの upgrade が失敗した")
        print(step.stdout[-3000:])
        print(step.stderr[-3000:])
        return 1
    print("[LOOP-A] 前提OK: alembic upgrade 012_default_mode_a 成功")

    await _create_all_like_startup()
    print("[LOOP-A] 前提OK: init_db 相当の create_all を適用（ドリフト再現）")

    failures: list[str] = []

    head = _alembic("head", env)
    if head.returncode != 0:
        tail = (head.stderr or head.stdout).strip().splitlines()[-6:]
        failures.append("症状1: alembic upgrade head が失敗")
        print("[LOOP-A] 症状1 再現: alembic upgrade head 失敗")
        for line in tail:
            print(f"        {line}")
    else:
        print("[LOOP-A] 症状1 なし: alembic upgrade head 成功")

    has_col = await _column_exists("transcript_segment", "speaker_label")
    if not has_col:
        failures.append("症状2: transcript_segment.speaker_label が存在しない")
        print("[LOOP-A] 症状2 再現: transcript_segment.speaker_label が存在しない")
    else:
        print("[LOOP-A] 症状2 なし: transcript_segment.speaker_label 存在")

    if failures:
        print(f"[LOOP-A] RED ({len(failures)} 症状)")
        return 1
    print("[LOOP-A] GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
