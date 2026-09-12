#!/usr/bin/env python3
"""Sonowa E2E data lifecycle no-op（self seed / 共有 DB 安全弁）。

目的:
    seed_mode=self + requires_db=false では共有 DB の wipe/snapshot/restore を拒否する。
    危険な DATABASE_URL / E2E_DB_URL（prod/staging 等）が渡されても変更せず exit 0。

使い方:
    python e2e/scripts/safe_noop_data.py identity|reset|snapshot|restore
"""

from __future__ import annotations

import os
import sys
from urllib.parse import urlparse

APP_NAME = "sonowa"
UNSAFE_MARKERS = ("prod", "production", "staging", "release")


def _looks_unsafe(url: str) -> bool:
    lowered = url.lower()
    if any(m in lowered for m in UNSAFE_MARKERS):
        return True
    parsed = urlparse(url)
    hay = f"{parsed.hostname or ''} {parsed.path or ''}"
    # test/e2e/ci を含まないホスト/パスは共有本番寄りとみなし拒否メッセージを強める
    return not any(m in hay for m in ("test", "e2e", "ci", "localhost", "127.0.0.1"))


def main(argv: list[str]) -> int:
    action = (argv[1] if len(argv) > 1 else "reset").lower()
    db_url = os.environ.get("E2E_DB_URL") or os.environ.get("DATABASE_URL") or ""

    if db_url and _looks_unsafe(db_url):
        print(
            f"[{APP_NAME}/safe_noop_data] REFUSED: unsafe DB URL detected for action={action}. "
            "共有/本番っぽい URL への wipe は行わない（値は表示しない）。"
        )
        return 0

    print(
        f"[{APP_NAME}/safe_noop_data] action={action}: "
        "shared DB wipe/snapshot/restore は拒否（self seed）。exit 0."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
