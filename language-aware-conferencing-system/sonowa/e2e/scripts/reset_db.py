"""Sonowa MVP E2E DB リセット / snapshot / restore CLI。

3 つのモード:
    1. デフォルト          : DB を初期化（sqlite: ファイル削除、postgres: alembic downgrade→upgrade）
    2. --snapshot <path>   : 現在の DB 状態を <path> に保存（再現性 baseline 用）
    3. --restore <path>    : <path> から DB を復元（テスト後の状態復旧用）

fail-closed: E2E_DB_URL 未設定なら exit 2、本番 DB 名 (prod/production/staging/release) 含むと exit 3。

設計:
    - 各 test の前後で DB 状態が一致することを保証する基盤
    - playwright.config の globalSetup/globalTeardown から呼び出す
    - sqlite はファイルコピーで snapshot、postgres は pg_dump 想定（実装は --alembic-ini 経由）
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

APP_NAME = "sonowa"
# e2e/ ルート（scripts/ の親）。snapshot 既定パス解決に使用する。
APP_E2E_ROOT = Path(__file__).resolve().parent.parent


def _is_safe_e2e_url(url: str) -> bool:
    lowered = url.lower()
    if any(marker in lowered for marker in ("prod", "production", "staging", "release")):
        return False
    parsed = urlparse(url)
    haystack = f"{parsed.hostname or ''} {parsed.path or ''}"
    return any(marker in haystack for marker in ("test", "e2e", "ci"))


def _detect_dialect(url: str) -> str:
    if url.startswith("sqlite"):
        return "sqlite"
    if url.startswith(("postgres", "postgresql")):
        return "postgresql"
    if url.startswith("mysql"):
        return "mysql"
    return "unknown"


def _sqlite_path(url: str) -> Path:
    match = re.match(r"sqlite(?:\+\w+)?:///(?P<path>.+)$", url)
    if match is None:
        raise SystemExit(f"sqlite URL を解釈できない: {url}")
    return Path(match.group("path"))


def _reset_sqlite(url: str) -> None:
    db_path = _sqlite_path(url)
    if db_path.exists():
        db_path.unlink()
        print(f"[{APP_NAME}/reset_db] sqlite 削除: {db_path}")
    else:
        print(f"[{APP_NAME}/reset_db] sqlite 新規: {db_path}")


def _snapshot_sqlite(url: str, snapshot_path: Path) -> None:
    db_path = _sqlite_path(url)
    if not db_path.exists():
        # 新規 baseline: 空ファイルを snapshot として保存
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        snapshot_path.write_bytes(b"")
        print(f"[{APP_NAME}/snapshot] 空 baseline 保存: {snapshot_path}")
        return
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(db_path, snapshot_path)
    print(f"[{APP_NAME}/snapshot] {db_path} → {snapshot_path}")


def _restore_sqlite(url: str, snapshot_path: Path) -> None:
    if not snapshot_path.exists():
        raise SystemExit(
            f"[{APP_NAME}/restore] snapshot が無い: {snapshot_path}\n"
            "  先に --snapshot を実行してください"
        )
    db_path = _sqlite_path(url)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if snapshot_path.stat().st_size == 0:
        # 空 baseline → DB ファイルを削除
        if db_path.exists():
            db_path.unlink()
        print(f"[{APP_NAME}/restore] 空 baseline から復元（DB 削除）")
    else:
        shutil.copy2(snapshot_path, db_path)
        print(f"[{APP_NAME}/restore] {snapshot_path} → {db_path}")


def _seed_all() -> None:
    seed_script = Path(__file__).with_name("seed.py")
    if not seed_script.is_file():
        raise SystemExit(f"[{APP_NAME}/bootstrap] seed.py が無い: {seed_script}")
    result = subprocess.run([sys.executable, str(seed_script), "--all"], check=False)
    if result.returncode != 0:
        raise SystemExit(f"[{APP_NAME}/bootstrap] seed --all 失敗 (exit={result.returncode})")


def _reset_via_alembic(url: str, alembic_ini: Path) -> None:
    if not alembic_ini.exists():
        raise SystemExit(f"alembic.ini が無い: {alembic_ini}")
    env = os.environ.copy()
    env["E2E_DB_URL"] = url
    env["DATABASE_URL"] = url
    subprocess.run(
        ["alembic", "-c", str(alembic_ini), "downgrade", "base"],
        env=env,
        check=True,
    )
    subprocess.run(
        ["alembic", "-c", str(alembic_ini), "upgrade", "head"],
        env=env,
        check=True,
    )


def _snapshot_postgres(url: str, snapshot_path: Path) -> None:
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    # pg_dump は環境変数 PGURL / PGPASSWORD を使う想定。簡易実装
    result = subprocess.run(
        ["pg_dump", "--dbname", url, "--file", str(snapshot_path), "--format", "c"],
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"[{APP_NAME}/snapshot] pg_dump 失敗。手動で snapshot を取ってください"
        )
    print(f"[{APP_NAME}/snapshot] postgres → {snapshot_path}")


def _restore_postgres(url: str, snapshot_path: Path) -> None:
    if not snapshot_path.exists():
        raise SystemExit(f"snapshot が無い: {snapshot_path}")
    result = subprocess.run(
        ["pg_restore", "--clean", "--dbname", url, str(snapshot_path)],
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"[{APP_NAME}/restore] pg_restore 失敗")
    print(f"[{APP_NAME}/restore] {snapshot_path} → postgres")


def main() -> int:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} E2E DB リセット/snapshot/restore")
    parser.add_argument("--alembic-ini", type=Path, default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--bootstrap-baseline",
        action="store_true",
        help="DB をリセットして baseline snapshot を作成する",
    )
    parser.add_argument(
        "--snapshot",
        type=Path,
        help="現在の DB を指定パスに保存（baseline 用）",
    )
    parser.add_argument(
        "--restore",
        type=Path,
        help="指定パスから DB を復元（test 後の状態復旧用）",
    )
    args = parser.parse_args()

    url = os.environ.get("E2E_DB_URL")
    if not url:
        print(f"[{APP_NAME}/reset_db] FAIL: E2E_DB_URL 未設定", file=sys.stderr)
        return 2

    if not args.force and not _is_safe_e2e_url(url):
        print(
            f"[{APP_NAME}/reset_db] FAIL: 'test'/'e2e' を含まない: {url}",
            file=sys.stderr,
        )
        return 3

    dialect = _detect_dialect(url)

    if args.bootstrap_baseline:
        if args.alembic_ini is not None:
            _reset_via_alembic(url, args.alembic_ini)
        elif dialect == "sqlite":
            _reset_sqlite(url)
        else:
            print(
                f"[{APP_NAME}/bootstrap] FAIL: {dialect} は --alembic-ini 無しの --bootstrap-baseline 未対応",
                file=sys.stderr,
            )
            return 5
        _seed_all()
        snapshot_path = args.snapshot or (APP_E2E_ROOT / ".snapshots" / "baseline.snap")
        if dialect == "sqlite":
            _snapshot_sqlite(url, snapshot_path)
        elif dialect == "postgresql":
            _snapshot_postgres(url, snapshot_path)
        return 0

    # snapshot モード
    if args.snapshot:
        if dialect == "sqlite":
            _snapshot_sqlite(url, args.snapshot)
        elif dialect == "postgresql":
            _snapshot_postgres(url, args.snapshot)
        else:
            raise SystemExit(f"snapshot 未対応 dialect: {dialect}")
        return 0

    # restore モード
    if args.restore:
        if dialect == "sqlite":
            _restore_sqlite(url, args.restore)
        elif dialect == "postgresql":
            _restore_postgres(url, args.restore)
        else:
            raise SystemExit(f"restore 未対応 dialect: {dialect}")
        return 0

    # reset モード（デフォルト）
    if args.alembic_ini is not None:
        _reset_via_alembic(url, args.alembic_ini)
        return 0

    if dialect == "sqlite":
        _reset_sqlite(url)
        return 0

    print(
        f"[{APP_NAME}/reset_db] FAIL: postgres/mysql は --alembic-ini 必須",
        file=sys.stderr,
    )
    return 4


if __name__ == "__main__":
    raise SystemExit(main())
