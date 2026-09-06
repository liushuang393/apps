"""[smoke] 管理者 AI パイプライン設定の実機 E2E。

目的:
    Docker 上の backend に対し、admin UI 相当の API 経路を検証する。
    - GET /api/admin/settings/ai-pipeline
    - PUT で切替・revision bump・永続化
    - 不正 enum → 400
    - 非 admin → 403
    - 最後に gpt4o_transcribe / default_mode=a へ復元

実行（backend / postgres 稼働下）:
    python scripts/smoke_ai_pipeline_settings.py
    # または
    powershell -File scripts/smoke_ai_pipeline_settings.ps1

環境変数:
    LAMS_API_BASE   既定 http://localhost:8090
    LAMS_FRONTEND   既定 http://localhost:5273（省略可・到達確認用）

注意:
    一時ユーザーを登録し postgres で admin 昇格する。秘密値は出力しない。
    exit 0 = 緑 / exit 1 = 赤
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any

API_BASE = os.environ.get("LAMS_API_BASE", "http://localhost:8090").rstrip("/")
FRONTEND = os.environ.get("LAMS_FRONTEND", "http://localhost:5273").rstrip("/")
PASSWORD = "E2eTestPass123!"

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("smoke_ai_pipeline")

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class SmokeError(RuntimeError):
    """スモーク失敗。"""


def _log(message: str) -> None:
    """スモーク進捗を logging 経由で出す（print 禁止規約に合わせる）。"""
    logger.info(message)


def _request(
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict[str, Any] | None = None,
    expect_status: int | None = None,
) -> tuple[int, Any]:
    """JSON API を呼び、(status, body) を返す。"""
    url = f"{API_BASE}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            status = resp.status
            parsed: Any = json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        status = e.code
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = raw
    if expect_status is not None and status != expect_status:
        raise SmokeError(f"{method} {path}: expected {expect_status}, got {status}: {parsed}")
    return status, parsed


def _promote_admin(user_id: str) -> None:
    """docker compose 経由で users.role を admin にする（psql 変数で SQL 注入を避ける）。"""
    if not _UUID_RE.match(user_id):
        raise SmokeError(f"admin 昇格に使う user_id が UUID 形式ではない: {user_id!r}")
    cmd = [
        "docker",
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "lams",
        "-d",
        "lams",
        "-v",
        f"uid={user_id}",
        "-c",
        "UPDATE users SET role = 'admin' WHERE id = :'uid';",
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        check=False,
    )
    if result.returncode != 0:
        raise SmokeError(
            f"admin 昇格失敗: rc={result.returncode} stderr={result.stderr.strip()}"
        )
    if "UPDATE 1" not in (result.stdout + result.stderr):
        raise SmokeError(f"admin 昇格が反映されませんでした: {result.stdout!r}")


def _check_frontend() -> None:
    """フロントが応答することだけ確認する（画面操作はしない）。"""
    if not FRONTEND:
        return
    req = urllib.request.Request(FRONTEND + "/", method="GET")
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status != 200:
            raise SmokeError(f"frontend status={resp.status}")


def main() -> int:
    """スモーク本体。成功 0 / 失敗 1。"""
    rnd = random.randint(100000, 999999)
    admin_email = f"e2e_pipeline_{rnd}@example.com"
    user_email = f"e2e_user_{rnd}@example.com"

    try:
        # health
        status, health = _request("GET", "/health", expect_status=200)
        if not isinstance(health, dict) or health.get("status") != "ok":
            raise SmokeError(f"health 異常: {health}")
        _log(f"[SMOKE-PIPELINE] health ok ({API_BASE})")

        # register + promote + login
        _, reg = _request(
            "POST",
            "/api/auth/register",
            body={
                "email": admin_email,
                "password": PASSWORD,
                "display_name": "E2E Pipeline",
                "native_language": "ja",
            },
            expect_status=200,
        )
        user_id = reg["user"]["id"]
        _log(f"[SMOKE-PIPELINE] registered admin-candidate id={user_id}")
        _promote_admin(user_id)
        _, login = _request(
            "POST",
            "/api/auth/login",
            body={"email": admin_email, "password": PASSWORD},
            expect_status=200,
        )
        if login["user"]["role"] != "admin":
            raise SmokeError(f"login role が admin ではない: {login['user']['role']}")
        admin_token = login["access_token"]
        _log("[SMOKE-PIPELINE] login as admin ok")

        # GET baseline
        _, get1 = _request(
            "GET",
            "/api/admin/settings/ai-pipeline",
            token=admin_token,
            expect_status=200,
        )
        rev1 = int(get1["revision"])
        _log(
            "[SMOKE-PIPELINE] GET1 "
            f"effective={get1['effective']['ai_provider']} "
            f"env={get1['env_defaults']['ai_provider']} rev={rev1}"
        )

        # PUT switch
        _, put1 = _request(
            "PUT",
            "/api/admin/settings/ai-pipeline",
            token=admin_token,
            body={
                "ai_provider": "gpt_realtime",
                "asr_provider": "auto",
                "mt_provider": "auto",
                "tts_provider": "auto",
                "default_mode": "b",
            },
            expect_status=200,
        )
        if put1["effective"]["ai_provider"] != "gpt_realtime":
            raise SmokeError("PUT1 ai_provider 不一致")
        if put1["effective"]["default_mode"] != "b":
            raise SmokeError("PUT1 default_mode 不一致")
        if int(put1["revision"]) <= rev1:
            raise SmokeError("revision が bump していない")
        _log(
            "[SMOKE-PIPELINE] PUT1 ok "
            f"ai_provider=gpt_realtime default_mode=b rev={put1['revision']}"
        )

        # GET persistence
        _, get2 = _request(
            "GET",
            "/api/admin/settings/ai-pipeline",
            token=admin_token,
            expect_status=200,
        )
        if get2["effective"]["ai_provider"] != "gpt_realtime":
            raise SmokeError("GET2 永続化失敗")
        _log(f"[SMOKE-PIPELINE] GET2 persist ok rev={get2['revision']}")

        # invalid enum → 400
        status, _ = _request(
            "PUT",
            "/api/admin/settings/ai-pipeline",
            token=admin_token,
            body={"ai_provider": "nope"},
        )
        if status != 400:
            raise SmokeError(f"不正 enum は 400 期待、got {status}")
        _log("[SMOKE-PIPELINE] invalid enum -> 400 ok")

        # non-admin → 403
        _, reg2 = _request(
            "POST",
            "/api/auth/register",
            body={
                "email": user_email,
                "password": PASSWORD,
                "display_name": "E2E User",
                "native_language": "ja",
            },
            expect_status=200,
        )
        user_token = reg2["access_token"]
        status, _ = _request(
            "PUT",
            "/api/admin/settings/ai-pipeline",
            token=user_token,
            body={"ai_provider": "gpt_realtime", "default_mode": "b"},
        )
        if status != 403:
            raise SmokeError(f"非 admin は 403 期待、got {status}")
        _log("[SMOKE-PIPELINE] non-admin -> 403 ok")

        # PUT quality_cascade（方式2）: hybrid + 品質パック
        _, put_quality = _request(
            "PUT",
            "/api/admin/settings/ai-pipeline",
            token=admin_token,
            body={
                "ai_provider": "gpt4o_transcribe",
                "asr_provider": "auto",
                "mt_provider": "auto",
                "tts_provider": "auto",
                "default_mode": "hybrid",
                "enable_partial_subtitles": True,
                "llm_correction_enabled": True,
            },
            expect_status=200,
        )
        if put_quality["effective"]["default_mode"] != "hybrid":
            raise SmokeError("PUT quality default_mode 不一致")
        if put_quality["effective"].get("enable_partial_subtitles") is not True:
            raise SmokeError("PUT quality enable_partial_subtitles 不一致")
        if put_quality["effective"].get("llm_correction_enabled") is not True:
            raise SmokeError("PUT quality llm_correction_enabled 不一致")
        _log(
            "[SMOKE-PIPELINE] PUT quality_cascade ok "
            f"partial=True correction=True rev={put_quality['revision']}"
        )

        # PUT local スロット（上級オプション・可用性警告を許容）
        _, put_local = _request(
            "PUT",
            "/api/admin/settings/ai-pipeline",
            token=admin_token,
            body={
                "ai_provider": "gpt4o_transcribe",
                "asr_provider": "local",
                "mt_provider": "local",
                "tts_provider": "local",
                "default_mode": "b",
                "enable_partial_subtitles": False,
                "llm_correction_enabled": False,
            },
            expect_status=200,
        )
        if put_local["effective"]["asr_provider"] != "local":
            raise SmokeError("PUT local asr_provider 不一致")
        if not isinstance(put_local.get("warnings"), list):
            raise SmokeError("local PUT に warnings が無い")
        if not any("local" in str(w).lower() or "用語" in str(w) for w in put_local["warnings"]):
            # 警告内容は環境依存だが、warnings 配列自体は必須
            _log(
                "[SMOKE-PIPELINE] PUT local warnings "
                f"(count={len(put_local['warnings'])}) ok"
            )
        _log(
            "[SMOKE-PIPELINE] PUT local advanced slots ok "
            f"warnings={len(put_local['warnings'])} rev={put_local['revision']}"
        )

        # restore
        _, put2 = _request(
            "PUT",
            "/api/admin/settings/ai-pipeline",
            token=admin_token,
            body={
                "ai_provider": "gpt4o_transcribe",
                "asr_provider": "auto",
                "mt_provider": "auto",
                "tts_provider": "auto",
                "default_mode": "a",
                "enable_partial_subtitles": False,
                "llm_correction_enabled": False,
            },
            expect_status=200,
        )
        if put2["effective"]["ai_provider"] != "gpt4o_transcribe":
            raise SmokeError("RESTORE ai_provider 不一致")
        _log(
            "[SMOKE-PIPELINE] RESTORE ok "
            f"ai_provider=gpt4o_transcribe default_mode={put2['effective']['default_mode']}"
        )

        _check_frontend()
        _log(f"[SMOKE-PIPELINE] frontend reachable ({FRONTEND})")
        _log("[SMOKE-PIPELINE] GREEN")
        return 0
    except SmokeError as e:
        _log(f"[SMOKE-PIPELINE] RED: {e}")
        return 1
    except Exception as e:  # noqa: BLE001 - 環境要因も赤として出す
        _log(f"[SMOKE-PIPELINE] RED（実行失敗）: {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
