#!/usr/bin/env python3
"""専用DB・通信遮断ネットワークを使うDocker認証ランタイムの所有管理。

入力: CLI操作と検証済みE2E_DB_URL。出力: 非秘密の実行証拠と専用状態。
既存サービスを停止しない。GPUの同時使用可否は呼び出し側で管理する。
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import logging
import os
import secrets
import signal
import threading
import time
import urllib.error
import urllib.request
from functools import lru_cache
from pathlib import Path
from types import ModuleType

logger = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / "e2e/.runtime/owned-runtime.json"
LIVEKIT_CONFIG = ROOT / "e2e/.runtime/certification-livekit.json"
OWNER = "sonowa.certification.owner"
ROLE = "sonowa.certification.role"
FRONTEND = "http://127.0.0.1:15273"
API = "http://127.0.0.1:18090"
READY_TIMEOUT_SECONDS = 120


@lru_cache
def postgres() -> ModuleType:
    """同じ作業コピー内のDB所有管理だけを読み込む。"""
    spec = importlib.util.spec_from_file_location(
        "owned_postgres_runtime", Path(__file__).with_name("owned_postgres.py")
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_resources(
    state: dict, network: dict, containers: list[dict], ingress: dict | None = None
) -> None:
    """外部接続・別所有者・別イメージ・モデル書込みを実体情報から拒否する。"""
    if (
        network.get("Id") != state["network_id"]
        or network.get("Internal") is not True
        or (network.get("Labels") or {}).get(OWNER) != state["owner_id"]
    ):
        raise ValueError("runtime network ownership or isolation changed")
    if state.get("ingress_network_id") and (
        not ingress
        or ingress.get("Id") != state["ingress_network_id"]
        or ingress.get("Internal") is not False
        or (ingress.get("Labels") or {}).get(OWNER) != state["owner_id"]
    ):
        raise ValueError("runtime ingress ownership changed")
    network_ids = {
        name: item["Id"]
        for item in (network, ingress)
        if item
        for name in (item["Id"], item.get("Name"))
        if name
    }
    seen = set()
    for container in containers:
        labels = container.get("Config", {}).get("Labels") or {}
        role = labels.get(ROLE)
        networks = container.get("NetworkSettings", {}).get("Networks") or {}
        allowed_networks = {state["network_id"]}
        if role == "gateway" and state.get("ingress_network_id"):
            allowed_networks.add(state["ingress_network_id"])
        # Compose作成途中ではNetworkIDが未割当のため、検証済みの名前を照合する。
        created = container.get("State", {}).get("Status") == "created"
        observed_networks = {
            entry.get("NetworkID") or (network_ids.get(name) if created else None)
            for name, entry in networks.items()
        }
        if (
            labels.get(OWNER) != state["owner_id"]
            or role not in state["images"]
            or role in seen
            or container.get("Image") != state["images"][role]
            or observed_networks != allowed_networks
        ):
            raise ValueError("runtime container ownership or image binding changed")
        seen.add(role)
        if role == "backend":
            model_mounts = [
                m
                for m in container.get("Mounts", [])
                if m.get("Destination") == "/models"
            ]
            if (
                len(model_mounts) != 1
                or model_mounts[0].get("Name") != "sonowa_models"
                or model_mounts[0].get("RW") is not False
            ):
                raise ValueError("runtime model volume must be read-only")


def load_state() -> dict:
    """専用DBの所有者と一致する状態だけを読み込む。"""
    state = json.loads(STATE.read_text())
    db_state = postgres().load_state()
    postgres().check_target(db_state)
    if state["owner_id"] != db_state["owner_id"]:
        raise ValueError("runtime and database owners differ")
    return state


def resources(state: dict) -> tuple[dict, list[dict]]:
    """Dockerから現在の実体を取り直し、操作前に毎回照合する。"""
    db = postgres()
    network = json.loads(db.docker(["network", "inspect", state["network_id"]]))[0]
    ids = (
        db.docker(
            [
                "ps",
                "-aq",
                "--filter",
                f"label={OWNER}={state['owner_id']}",
                "--filter",
                "label=sonowa.certification.runtime=true",
            ]
        )
        .decode()
        .split()
    )
    containers = json.loads(db.docker(["inspect", *ids])) if ids else []
    ingress = (
        json.loads(db.docker(["network", "inspect", state["ingress_network_id"]]))[0]
        if state.get("ingress_network_id")
        else None
    )
    validate_resources(state, network, containers, ingress)
    return network, containers


def environment(state: dict) -> dict[str, str]:
    """生成済み秘密をプロセス環境だけでComposeへ渡す。"""
    db_state = postgres().load_state()
    postgres().check_target(db_state)
    result = {
        **os.environ,
        "SONOWA_CERT_OWNER": state["owner_id"],
        "SONOWA_CERT_NETWORK": state["network_id"],
        "SONOWA_CERT_INGRESS_NETWORK": state["ingress_network_id"],
        "SONOWA_CERT_DATABASE_URL": f"postgresql+asyncpg://sonowa_cert_e2e:{db_state['password']}@database:5432/sonowa_cert_e2e",
        "SONOWA_CERT_JWT_SECRET": state["jwt_secret"],
        "SONOWA_CERT_LIVEKIT_KEY": state["livekit_key"],
        "SONOWA_CERT_LIVEKIT_SECRET": state["livekit_secret"],
        "SONOWA_CERT_LIVEKIT_CONFIG": str(LIVEKIT_CONFIG),
        "SONOWA_CERT_SCRIPTS": str(ROOT / "e2e/scripts"),
    }
    for role, image in state["images"].items():
        result[f"SONOWA_CERT_{role.upper()}_IMAGE"] = image
    return result


def reset(state: dict) -> None:
    """アプリ停止中の専用DBにマイグレーションと正規ユーザーを準備する。"""
    _, containers = resources(state)
    if containers:
        raise ValueError("stop the owned runtime before resetting its database")
    db = postgres()
    db_state = db.load_state()
    db.reset(db_state)
    env = {
        **os.environ,
        "ENV": "production",
        "DATABASE_URL": f"postgresql+asyncpg://sonowa_cert_e2e:{db_state['password']}@127.0.0.1:5432/sonowa_cert_e2e",
        "SONOWA_CERT_OWNER": state["owner_id"],
        "SONOWA_CERT_USER_PASSWORD": state["user_password"],
        "PYTHONPATH": "/app",
    }
    db.docker(
        [
            "run",
            "--rm",
            "--network",
            f"container:{db_state['container_id']}",
            "-e",
            "ENV",
            "-e",
            "DATABASE_URL",
            "-e",
            "SONOWA_CERT_OWNER",
            "-e",
            "SONOWA_CERT_USER_PASSWORD",
            "-e",
            "PYTHONPATH",
            "-v",
            f"{ROOT / 'e2e/scripts/certification_seed.py'}:/seed.py:ro",
            "--entrypoint",
            "python",
            state["images"]["backend"],
            "/seed.py",
        ],
        env=env,
    )


def prepare() -> dict:
    """専用DBを作成し、固定イメージと通信遮断ネットワークを束縛する。"""
    if STATE.exists():
        raise ValueError("owned runtime already exists")
    db = postgres()
    db_state = db.create("postgres:16-alpine", "sonowa-backend:local-small")
    os.environ["E2E_DB_URL"] = db.jdbc_url(db_state)
    owner = db_state["owner_id"]
    images = {"backend": db_state["backend_image"]}
    for role, tag in {
        "frontend": "sonowa-frontend:latest",
        "redis": "redis:7-alpine",
        "livekit": "livekit/livekit-server:v1.13.1",
    }.items():
        images[role] = (
            db.docker(["image", "inspect", "--format", "{{.Id}}", tag]).decode().strip()
        )
    network_id = (
        db.docker(
            [
                "network",
                "create",
                "--internal",
                "--label",
                f"{OWNER}={owner}",
                f"sonowa-cert-{owner}",
            ]
        )
        .decode()
        .strip()
    )
    state = {
        "owner_id": owner,
        "network_id": network_id,
        "images": images,
        "jwt_secret": secrets.token_urlsafe(40),
        "livekit_key": secrets.token_hex(12),
        "livekit_secret": secrets.token_urlsafe(40),
        "user_password": secrets.token_urlsafe(32),
    }
    db.write_private(STATE, json.dumps(state).encode())
    db.docker(
        [
            "network",
            "connect",
            "--alias",
            "database",
            network_id,
            db_state["container_id"],
        ]
    )
    db.write_private(
        LIVEKIT_CONFIG,
        json.dumps(
            {
                "port": 7880,
                "bind_addresses": ["0.0.0.0"],
                "rtc": {
                    "tcp_port": 17881,
                    "udp_port": 17882,
                    "node_ip": "127.0.0.1",
                    "use_external_ip": False,
                },
                "keys": {state["livekit_key"]: state["livekit_secret"]},
            }
        ).encode(),
    )
    reset(state)
    db.snapshot(db_state)
    logger.info("専用ランタイム準備済み: E2E_DB_URL=%s", db.jdbc_url(db_state))
    return state


def start(state: dict, *, stop_event: threading.Event | None = None) -> None:
    """固定イメージを起動し、終了要求を監視しながらDB実体を照合する。"""
    stopped = stop_event if stop_event is not None else threading.Event()
    if stopped.is_set():
        raise InterruptedError("owned runtime startup cancelled")
    resources(state)
    db = postgres()
    if not state.get("ingress_network_id"):
        state["images"]["gateway"] = (
            db.docker(["image", "inspect", "--format", "{{.Id}}", "nginx:alpine"])
            .decode()
            .strip()
        )
        state["ingress_network_id"] = (
            db.docker(
                [
                    "network",
                    "create",
                    "--label",
                    f"{OWNER}={state['owner_id']}",
                    f"sonowa-cert-ingress-{state['owner_id']}",
                ]
            )
            .decode()
            .strip()
        )
        db.write_private(STATE, json.dumps(state).encode())
    db.docker(
        [
            "compose",
            "-p",
            f"sonowa-cert-{state['owner_id']}",
            "-f",
            str(ROOT / "docker-compose.certification.yml"),
            "up",
            "-d",
            "--no-build",
        ],
        env=environment(state),
    )
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if stopped.is_set():
            raise InterruptedError("owned runtime startup cancelled")
        _, containers = resources(state)
        if len(containers) != len(state["images"]) or any(
            c["State"]["Status"] == "exited" for c in containers
        ):
            raise RuntimeError("owned runtime failed during startup")
        try:
            with urllib.request.urlopen(
                FRONTEND + "/api/__testing_kit_identity", timeout=2
            ) as response:
                observed = json.load(response)
            if observed != {
                "owner_id": state["owner_id"],
                "app": "sonowa",
                "environment": "e2e",
                "seed_marker": "certification",
            }:
                raise ValueError(
                    "owned runtime identity differs from its seeded database"
                )
            evidence = {
                "identity": observed,
                "images": state["images"],
                "network_internal": True,
                "containers": {
                    c["Config"]["Labels"][ROLE]: c["Id"] for c in containers
                },
                "source_sha256": {
                    name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                    for name in [
                        "docker-compose.certification.yml",
                        "e2e/scripts/certification_app.py",
                        "e2e/scripts/certification_seed.py",
                    ]
                },
                "frontend": FRONTEND,
                "api": API,
            }
            db.write_private(
                ROOT / "e2e/.runtime/owned-runtime-evidence.json",
                json.dumps(evidence).encode(),
            )
            logger.info("専用Dockerランタイム起動確認: %s", FRONTEND)
            return
        except (OSError, urllib.error.URLError):
            if stopped.wait(1):
                raise InterruptedError("owned runtime startup cancelled") from None
    raise RuntimeError("owned runtime readiness timeout")


def stop(state: dict) -> None:
    """所有権を再確認し、この実行が作成したサービスだけを削除する。"""
    _, containers = resources(state)
    if containers:
        postgres().docker(["rm", "-f", *(c["Id"] for c in containers)])


def destroy(state: dict) -> None:
    """専用サービス・ネットワーク・DBを片付け、モデルボリュームは保持する。"""
    stop(state)
    db = postgres()
    db_state = db.load_state()
    resources(state)
    db.docker(["network", "disconnect", state["network_id"], db_state["container_id"]])
    db.docker(["network", "rm", state["network_id"]])
    if state.get("ingress_network_id"):
        db.docker(["network", "rm", state["ingress_network_id"]])
    db.check_target(db_state)
    db.docker(["rm", "-f", db_state["container_id"]])
    db.STATE.unlink()
    STATE.unlink()
    LIVEKIT_CONFIG.unlink(missing_ok=True)


def main() -> int:
    """認証カーネル用の前景serveと、診断用の起動・停止を提供する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action", choices=["prepare", "reset", "start", "serve", "stop", "destroy"]
    )
    args = parser.parse_args()
    if args.action == "prepare":
        prepare()
        return 0
    state = load_state()
    if args.action == "serve":
        stopped = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda _signum, _frame: stopped.set())
        try:
            start(state, stop_event=stopped)
            while not stopped.wait(1):
                _, containers = resources(state)
                if any(c["State"]["Status"] != "running" for c in containers):
                    raise RuntimeError("owned runtime service stopped unexpectedly")
        except InterruptedError:
            logger.info("専用ランタイムの起動を終了要求で中断しました")
        finally:
            stop(state)
    else:
        {"reset": reset, "start": start, "stop": stop, "destroy": destroy}[args.action](
            state
        )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(main())
