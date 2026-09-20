"""検証用DBの所有権が崩れた場合に、破壊的操作を拒否する契約。"""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest


@pytest.fixture
def owned_module() -> ModuleType:
    """本番アプリへ依存しない検証用CLIを読み込む。"""
    path = Path(__file__).resolve().parents[2] / "e2e/scripts/owned_postgres.py"
    spec = importlib.util.spec_from_file_location("owned_postgres", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def owned_target() -> tuple[dict, dict]:
    """専用ラベル・tmpfs・loopback公開を持つ仮想コンテナを返す。"""
    state = {
        "container_id": "a" * 64,
        "owner_id": "b" * 32,
        "port": 55439,
        "postgres_image": "sha256:" + "c" * 64,
    }
    inspection = {
        "Id": state["container_id"],
        "Image": state["postgres_image"],
        "Config": {
            "Labels": {"sonowa.certification.owner": state["owner_id"]},
            "Env": ["POSTGRES_DB=sonowa_cert_e2e", "POSTGRES_USER=sonowa_cert_e2e"],
        },
        "Mounts": [],
        "HostConfig": {"Tmpfs": {"/var/lib/postgresql/data": "rw"}},
        "NetworkSettings": {
            "Ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55439"}]}
        },
    }
    return state, inspection


def test_owned_identity_matches_testing_kit_contract(
    owned_module: ModuleType, owned_target: tuple[dict, dict]
) -> None:
    """検証済み接続先の資格情報を含まない指紋を返す。"""
    state, inspection = owned_target
    result = owned_module.validate_target(
        state, "jdbc:postgresql://127.0.0.1:55439/sonowa_cert_e2e", inspection
    )
    assert result["engine"] == "postgresql"
    assert result["expected_name"] == "sonowa_cert_e2e"
    assert len(result["locator_sha256"]) == 64


@pytest.mark.parametrize(
    "url",
    [
        "jdbc:postgresql://127.0.0.1:5432/sonowa_cert_e2e",
        "jdbc:postgresql://127.0.0.1:55439/sonowa",
        "jdbc:postgresql://example.com:55439/sonowa_cert_e2e",
        "jdbc:postgresql://127.0.0.1:55439/sonowa_cert_e2e/other",
        "jdbc:postgresql://127.0.0.1:55439/sonowa_cert_e2e?options=unsafe",
        "jdbc:postgresql://user:secret@127.0.0.1:55439/sonowa_cert_e2e",
        "",
    ],
)
def test_different_connection_is_rejected(
    owned_module: ModuleType, owned_target: tuple[dict, dict], url: str
) -> None:
    """ポート・DB名・ホスト・追加パラメータの差を許容しない。"""
    state, inspection = owned_target
    with pytest.raises(ValueError):
        owned_module.validate_target(state, url, inspection)


@pytest.mark.parametrize(
    "mismatch", ["label", "id", "image", "volume", "tmpfs", "port", "db"]
)
def test_shared_or_replaced_container_is_rejected(
    owned_module: ModuleType, owned_target: tuple[dict, dict], mismatch: str
) -> None:
    """同名コンテナへの差し替えや既存ボリュームの使用を拒否する。"""
    state, original = owned_target
    inspection = copy.deepcopy(original)
    if mismatch == "label":
        inspection["Config"]["Labels"] = {}
    elif mismatch == "id":
        inspection["Id"] = "d" * 64
    elif mismatch == "image":
        inspection["Image"] = "sha256:" + "d" * 64
    elif mismatch == "volume":
        inspection["Mounts"] = [
            {"Type": "volume", "Destination": "/var/lib/postgresql/data"}
        ]
    elif mismatch == "tmpfs":
        inspection["HostConfig"]["Tmpfs"] = {}
    elif mismatch == "port":
        inspection["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"] = "5432"
    else:
        inspection["Config"]["Env"] = ["POSTGRES_DB=sonowa"]
    with pytest.raises(ValueError):
        owned_module.validate_target(
            state, "jdbc:postgresql://127.0.0.1:55439/sonowa_cert_e2e", inspection
        )


@pytest.mark.parametrize("mismatch", ["owner", "container", "content"])
def test_foreign_or_changed_snapshot_never_reaches_postgres(
    owned_module: ModuleType,
    owned_target: tuple[dict, dict],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mismatch: str,
) -> None:
    """古い実行や改変ダンプをDB操作の前に拒否する。"""
    state, _ = owned_target
    snapshot = tmp_path / "baseline.dump"
    content = b"PGDMP test fixture"
    snapshot.write_bytes(content)
    metadata = {
        "owner_id": state["owner_id"],
        "container_id": state["container_id"],
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    if mismatch == "owner":
        metadata["owner_id"] = "f" * 32
    elif mismatch == "container":
        metadata["container_id"] = "f" * 64
    else:
        snapshot.write_bytes(content + b"changed")
    snapshot.with_suffix(".metadata.json").write_text(json.dumps(metadata))
    monkeypatch.setattr(owned_module, "SNAPSHOT", snapshot)
    monkeypatch.setattr(owned_module, "check_target", lambda _state: {})

    def reject_docker(*_args: object, **_kwargs: object) -> bytes:
        """拒否ケースで実際のSQL処理へ到達したら失敗する。"""
        raise AssertionError("invalid snapshot reached Docker")

    monkeypatch.setattr(owned_module, "docker", reject_docker)
    with pytest.raises(ValueError, match="snapshot ownership or checksum"):
        owned_module.restore(state)


def test_snapshot_preserves_state_for_the_next_command(
    owned_module: ModuleType,
    owned_target: tuple[dict, dict],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """snapshot後の別コマンドが、接続先と所有状態を再読込できる。"""
    state, _ = owned_target
    state_path = tmp_path / "owned-postgres.json"
    state_path.write_text(json.dumps(state))
    monkeypatch.setattr(owned_module, "STATE", state_path)
    monkeypatch.setattr(owned_module, "SNAPSHOT", tmp_path / "owned-postgres.dump")
    monkeypatch.setattr(owned_module, "check_target", lambda _state: {})
    monkeypatch.setattr(owned_module, "docker", lambda _args: b"PGDMP fixture")
    owned_module.snapshot(state)
    assert owned_module.load_state() == state
