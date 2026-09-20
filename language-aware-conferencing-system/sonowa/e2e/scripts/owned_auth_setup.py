#!/usr/bin/env python3
"""専用Dockerアプリで正規ログインし、ロール別Playwright状態を保存する。

入力: 専用ランタイム状態とE2E_DB_URL。出力: 認証状態と非秘密の照合証拠。
ユーザー昇格や認証バイパスは行わず、事前seedされた3ロールでログインする。
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from owned_runtime import API, FRONTEND, ROOT, load_state, postgres, resources


def request(
    path: str, *, body: dict | None = None, token: str | None = None
) -> tuple[int, dict]:
    """固定された専用APIへ要求し、資格情報をログに出さない。"""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, {}


def main() -> int:
    """ログイン・自分の情報・管理者境界・実DBのロールを照合する。"""
    state = load_state()
    resources(state)
    db = postgres()
    db_state = db.load_state()
    code, identity = request("/api/__testing_kit_identity")
    if code != 200 or identity.get("owner_id") != state["owner_id"]:
        raise ValueError("authentication target is not the owned application")
    report = {"passed": False, "owner_id": state["owner_id"], "roles": []}
    for role in ("admin", "moderator", "user"):
        code, login = request(
            "/api/auth/login",
            body={
                "email": f"{role}@cert.sonowa.example.com",
                "password": state["user_password"],
            },
        )
        if code != 200:
            raise RuntimeError(f"real login failed for {role}: HTTP {code}")
        token = login["access_token"]
        code, user = request("/api/auth/me", token=token)
        if (
            code != 200
            or user.get("role") != role
            or user.get("id") != login["user"]["id"]
        ):
            raise ValueError("authenticated role or subject does not match")
        code, _ = request("/api/admin/users", token=token)
        admin_status = code
        expected = 200 if role == "admin" else 403
        if code != expected:
            raise ValueError(
                f"administrator access boundary changed: {role}, expected={expected}, actual={code}"
            )
        if role == "admin":
            code, settings = request("/api/admin/settings/ai-pipeline", token=token)
            if code != 200:
                raise ValueError("pipeline settings cannot be observed")
            effective = settings["effective"]
            for key, value in {
                "asr_provider": "local",
                "mt_provider": "local",
                "tts_provider": "local",
                "default_mode": "hybrid",
                "enable_partial_subtitles": False,
                "llm_correction_enabled": False,
            }.items():
                if effective.get(key) != value:
                    raise ValueError("owned pipeline is not fully local")
            report["pipeline_settings"] = effective
        persisted = db.sql(
            db_state,
            f"SELECT role FROM users WHERE email='{role}@cert.sonowa.example.com';",
        )
        if persisted != role:
            raise ValueError("API role differs from independent database observation")
        frontend_user = {
            "id": user["id"],
            "email": user["email"],
            "displayName": user["display_name"],
            "nativeLanguage": user["native_language"],
            "role": role,
            "isActive": user["is_active"],
        }
        auth = {
            "state": {"token": token, "user": frontend_user, "isAuthenticated": True},
            "version": 0,
        }
        storage = {
            "cookies": [],
            "origins": [
                {
                    "origin": FRONTEND,
                    "localStorage": [
                        {"name": "sonowa-auth", "value": json.dumps(auth)}
                    ],
                }
            ],
        }
        path = ROOT / "e2e/certification/.auth" / f"{role}.json"
        db.write_private(path, json.dumps(storage).encode())
        report["roles"].append(
            {
                "role": role,
                "login_status": 200,
                "admin_users_status": admin_status,
                "database_role": persisted,
                "storage_state": path.relative_to(ROOT).as_posix(),
            }
        )
    report["passed"] = len(report["roles"]) == 3
    db.write_private(
        ROOT / "e2e/.runtime/owned-auth-evidence.json", json.dumps(report).encode()
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
