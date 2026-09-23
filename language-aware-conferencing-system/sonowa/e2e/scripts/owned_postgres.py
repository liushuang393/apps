#!/usr/bin/env python3
"""専用Docker PostgreSQLの所有権を照合し、実際のsnapshot/restoreを行う。

入力: CLI操作とE2E_DB_URL。出力: 所有状態・DB指紋・snapshot。
共有DBや既存ボリュームには接続しない。秘密値は状態ファイルだけに保存する。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import secrets
import subprocess
import time
import uuid
from pathlib import Path
from typing import TypedDict
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "e2e/.runtime"
STATE = RUNTIME / "owned-postgres.json"
SNAPSHOT = RUNTIME / "owned-postgres.dump"
DATABASE = "sonowa_cert_e2e"
OWNER_LABEL = "sonowa.certification.owner"
DATA_DIRECTORY = "/var/lib/postgresql/data"
READY_TIMEOUT_SECONDS = 60
POLL_INTERVAL_SECONDS = 1


class OwnedState(TypedDict):
    """このCLIが作成した一意なDBコンテナと接続情報。"""

    container_id: str
    owner_id: str
    port: int
    postgres_image: str
    backend_image: str
    password: str


def jdbc_url(state: OwnedState) -> str:
    """資格情報を含まない、公式認証用の接続先を返す。"""
    return f"jdbc:postgresql://127.0.0.1:{state['port']}/{DATABASE}"


def validate_target(
    state: OwnedState, raw_url: str, inspection: dict[str, object]
) -> dict[str, str]:
    """接続先・Docker実体・専用tmpfsを検証し、不一致なら操作を拒否する。"""
    if not re.fullmatch(r"[a-f0-9]{64}", state["container_id"]):
        raise ValueError("invalid owned container identity")
    if not re.fullmatch(r"[a-f0-9]{32}", state["owner_id"]):
        raise ValueError("invalid owner identity")
    if raw_url != jdbc_url(state):
        raise ValueError("E2E_DB_URL does not match the owned loopback database")
    config = inspection.get("Config")
    network = inspection.get("NetworkSettings")
    if not isinstance(config, dict) or not isinstance(network, dict):
        raise ValueError("container inspection is incomplete")
    labels = config.get("Labels") or {}
    env = config.get("Env") or []
    ports = network.get("Ports") or {}
    if (
        inspection.get("Id") != state["container_id"]
        or inspection.get("Image") != state["postgres_image"]
        or labels.get(OWNER_LABEL) != state["owner_id"]
        or f"POSTGRES_DB={DATABASE}" not in env
        or f"POSTGRES_USER={DATABASE}" not in env
        or ports.get("5432/tcp")
        != [{"HostIp": "127.0.0.1", "HostPort": str(state["port"])}]
    ):
        raise ValueError("container ownership or database binding changed")
    mounts = inspection.get("Mounts")
    host_config = inspection.get("HostConfig") or {}
    # Dockerの --tmpfs はMountsに含まれず、HostConfig.Tmpfsに記録される。
    if host_config.get("Tmpfs") != {DATA_DIRECTORY: "rw"}:
        raise ValueError("owned database requires its dedicated temporary mount")
    if mounts != []:
        raise ValueError("persistent or shared database storage is forbidden")
    parsed = urlsplit(raw_url.removeprefix("jdbc:"))
    locator = f"postgresql://{parsed.hostname}:{parsed.port}/{DATABASE}"
    return {
        "kind": "jdbc",
        "environment": "e2e",
        "expected_name": DATABASE,
        "engine": "postgresql",
        "locator_sha256": hashlib.sha256(locator.encode()).hexdigest(),
    }


def docker(
    args: list[str], *, data: bytes | None = None, env: dict[str, str] | None = None
) -> bytes:
    """Dockerを実行し、エラーに資格情報やコマンド全文を含めず停止する。"""
    result = subprocess.run(
        ["docker", *args],
        input=data,
        capture_output=True,
        env=env,
        timeout=120,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"Docker {args[0]} failed (exit {result.returncode})")
    return result.stdout


def inspect_container(container_id: str) -> dict[str, object]:
    """名前ではなく固定IDでDockerの現在状態を取得する。"""
    return json.loads(docker(["inspect", container_id]))[0]


def write_private(path: Path, content: bytes) -> None:
    """証拠と秘密状態を所有者だけが読める一時ファイルから置き換える。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def load_state() -> OwnedState:
    """専用の状態ファイルを読み、外部パスへの置き換えを拒否する。"""
    if STATE.is_symlink():
        raise ValueError("owned database state must not be a symlink")
    return json.loads(STATE.read_text())


def check_target(state: OwnedState) -> dict[str, str]:
    """実体と宣言URLを毎回再照合する。共有DBへ既定値で接続しない。"""
    return validate_target(
        state,
        os.environ.get("E2E_DB_URL", ""),
        inspect_container(state["container_id"]),
    )


def sql(state: OwnedState, statement: str) -> str:
    """照合済みコンテナ内の専用DBへSQLを送り、実行失敗を伝える。"""
    check_target(state)
    return (
        docker(
            [
                "exec",
                "-i",
                state["container_id"],
                "psql",
                "-X",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                DATABASE,
                "-d",
                DATABASE,
                "-At",
            ],
            data=statement.encode(),
        )
        .decode()
        .strip()
    )


def create(postgres_image: str, backend_image: str) -> OwnedState:
    """既存状態を上書きせず、専用tmpfsと空きloopbackポートでDBを作る。"""
    RUNTIME.mkdir(parents=True, exist_ok=True)
    # 起動の競合を防ぎ、先行実行の状態を上書きしない。
    descriptor = os.open(STATE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    owner = uuid.uuid4().hex
    container_id = ""
    try:
        pg_image = (
            docker(["image", "inspect", "--format", "{{.Id}}", postgres_image])
            .decode()
            .strip()
        )
        app_image = (
            docker(["image", "inspect", "--format", "{{.Id}}", backend_image])
            .decode()
            .strip()
        )
        password = secrets.token_urlsafe(32)
        environment = {**os.environ, "POSTGRES_PASSWORD": password}
        container_id = (
            docker(
                [
                    "run",
                    "-d",
                    "--name",
                    f"sonowa-cert-db-{owner}",
                    "--label",
                    f"{OWNER_LABEL}={owner}",
                    "--tmpfs",
                    f"{DATA_DIRECTORY}:rw",
                    "-p",
                    "127.0.0.1::5432",
                    "-e",
                    f"POSTGRES_DB={DATABASE}",
                    "-e",
                    f"POSTGRES_USER={DATABASE}",
                    "-e",
                    "POSTGRES_PASSWORD",
                    pg_image,
                ],
                env=environment,
            )
            .decode()
            .strip()
        )
        inspection = inspect_container(container_id)
        port = int(inspection["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"])
        state: OwnedState = {
            "container_id": container_id,
            "owner_id": owner,
            "port": port,
            "postgres_image": pg_image,
            "backend_image": app_image,
            "password": password,
        }
        validate_target(state, jdbc_url(state), inspection)
        write_private(STATE, json.dumps(state).encode())
        deadline = time.monotonic() + READY_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            try:
                docker(
                    ["exec", container_id, "pg_isready", "-U", DATABASE, "-d", DATABASE]
                )
                return state
            except RuntimeError:
                time.sleep(POLL_INTERVAL_SECONDS)
        raise RuntimeError("owned database readiness timeout")
    except Exception:
        if container_id:
            # createが取得したIDと一意ラベルを照合してから、自身だけを片付ける。
            current = inspect_container(container_id)
            if current["Config"]["Labels"].get(OWNER_LABEL) == owner:
                docker(["rm", "-f", container_id])
        STATE.unlink(missing_ok=True)
        raise


def reset(state: OwnedState) -> None:
    """専用DBだけを空にし、固定した製品イメージの全マイグレーションを実行する。"""
    identity = sql(state, "SELECT current_database() || ':' || current_user;")
    if identity != f"{DATABASE}:{DATABASE}":
        raise ValueError("database connection identity changed")
    sql(state, "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    environment = {
        **os.environ,
        "DATABASE_URL": f"postgresql+asyncpg://{DATABASE}:{state['password']}@127.0.0.1:5432/{DATABASE}",
    }
    docker(
        [
            "run",
            "--rm",
            "--network",
            f"container:{state['container_id']}",
            "-e",
            "DATABASE_URL",
            "--entrypoint",
            "alembic",
            state["backend_image"],
            "upgrade",
            "head",
        ],
        env=environment,
    )


def snapshot(state: OwnedState) -> None:
    """専用DB全体の実ダンプを保存し、所有者とSHAを結び付ける。"""
    check_target(state)
    content = docker(
        [
            "exec",
            state["container_id"],
            "pg_dump",
            "-U",
            DATABASE,
            "-d",
            DATABASE,
            "--format=custom",
            "--no-owner",
            "--no-acl",
        ]
    )
    if not content.startswith(b"PGDMP"):
        raise ValueError("PostgreSQL snapshot is empty or invalid")
    write_private(SNAPSHOT, content)
    write_private(
        SNAPSHOT.with_suffix(".metadata.json"),
        json.dumps(
            {
                "owner_id": state["owner_id"],
                "container_id": state["container_id"],
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        ).encode(),
    )


def restore(state: OwnedState) -> None:
    """同じ所有者の未改変ダンプだけをトランザクション内で復元する。"""
    check_target(state)
    content = SNAPSHOT.read_bytes()
    metadata = json.loads(SNAPSHOT.with_suffix(".metadata.json").read_text())
    if metadata != {
        "owner_id": state["owner_id"],
        "container_id": state["container_id"],
        "sha256": hashlib.sha256(content).hexdigest(),
    }:
        raise ValueError("snapshot ownership or checksum mismatch")
    restore_sql = docker(
        [
            "exec",
            "-i",
            state["container_id"],
            "pg_restore",
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-acl",
            "--file",
            "-",
        ],
        data=content,
    )
    # --cleanだけではsnapshotに存在しなかったテーブルが残る。
    # システム以外のスキーマ削除とダンプ復元を同一トランザクションにする。
    prelude = b"""
DO $owned_restore$
DECLARE item record;
BEGIN
  FOR item IN SELECT nspname FROM pg_namespace
    WHERE left(nspname, 3) <> 'pg_' AND nspname <> 'information_schema'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', item.nspname);
  END LOOP;
END $owned_restore$;
CREATE SCHEMA public;
"""
    check_target(state)
    docker(
        [
            "exec",
            "-i",
            state["container_id"],
            "psql",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "--single-transaction",
            "-U",
            DATABASE,
            "-d",
            DATABASE,
            "--file",
            "-",
        ],
        data=prelude + restore_sql,
    )


def main() -> int:
    """公式認証のDB lifecycleコマンドを、専用所有状態に限定して提供する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=["create", "identity", "reset", "snapshot", "restore", "destroy"],
    )
    parser.add_argument("--postgres-image", default="postgres:16-alpine")
    parser.add_argument("--backend-image", default="sonowa-backend:latest")
    args = parser.parse_args()
    try:
        if args.action == "create":
            state = create(args.postgres_image, args.backend_image)
            logger.info("専用DBを作成: %s", jdbc_url(state))
            return 0
        state = load_state()
        identity = check_target(state)
        if args.action == "identity":
            path = Path(os.environ["E2E_DATA_IDENTITY_FILE"]).resolve()
            if not path.is_relative_to(ROOT):
                raise ValueError("identity evidence must remain inside the project")
            write_private(path, json.dumps(identity).encode())
        elif args.action == "reset":
            reset(state)
        elif args.action == "snapshot":
            snapshot(state)
        elif args.action == "restore":
            restore(state)
        else:
            docker(["rm", "-f", state["container_id"]])
            STATE.unlink()
        return 0
    except (
        OSError,
        ValueError,
        RuntimeError,
        KeyError,
        subprocess.TimeoutExpired,
    ) as exc:
        logger.error("専用DB操作を停止: %s: %s", type(exc).__name__, exc)
        return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(main())
