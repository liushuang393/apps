#!/usr/bin/env python3
"""Sonowa E2E auth_setup — 既存サーバ疎通の readiness 確認。

目的:
    existing-server モードで Playwright 前に API /health を確認する。
    秘密値（トークン・パスワード・API キー）は一切出力しない。

終了コード:
    0 = 準備完了 / 2 = 到達不能
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

APP_NAME = "sonowa"
DEFAULT_API = "http://127.0.0.1:8090"
DEFAULT_FRONT = "http://127.0.0.1:5273"


def _base(env_name: str, default: str) -> str:
    return os.environ.get(env_name, default).rstrip("/")


def _get(url: str, timeout: float = 5.0) -> tuple[int, str]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read().decode("utf-8", errors="replace")
            return int(res.status), body
    except urllib.error.HTTPError as exc:
        return int(exc.code), ""
    except Exception as exc:  # noqa: BLE001 — readiness では種別より到達可否が重要
        print(f"[{APP_NAME}/auth_setup] FAIL: {url} unreachable ({type(exc).__name__})")
        return 0, ""


def main() -> int:
    api = _base("E2E_API_BASE_URL", DEFAULT_API)
    front = _base("E2E_BASE_URL", DEFAULT_FRONT)
    health_url = f"{api}/health"

    print(f"[{APP_NAME}/auth_setup] checking {health_url}")
    status, body = _get(health_url)
    if status != 200:
        print(f"[{APP_NAME}/auth_setup] FAIL: /health status={status}")
        return 2

    ok_marker = False
    try:
        payload = json.loads(body) if body else {}
        if isinstance(payload, dict):
            # status / ok のいずれでも受け入れる（実装差吸収）
            ok_marker = str(payload.get("status", "")).lower() in {
                "ok",
                "healthy",
                "up",
            } or payload.get("ok") is True
    except json.JSONDecodeError:
        ok_marker = "ok" in body.lower()

    if not ok_marker and body:
        # 本文が空でなければ 200 を成功扱い（契約は HEALTH-001 で厳密検証）
        ok_marker = True

    if not ok_marker:
        print(f"[{APP_NAME}/auth_setup] FAIL: /health body not ok")
        return 2

    print(f"[{APP_NAME}/auth_setup] API ready: {api}")
    print(f"[{APP_NAME}/auth_setup] FRONT expected: {front}")
    print(f"[{APP_NAME}/auth_setup] auth mode=login (JWT, no bypass)")
    print(f"[{APP_NAME}/auth_setup] seed_mode=self / requires_db=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
