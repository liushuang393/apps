"""認証用Dockerランタイムの外部通信遮断・所有権契約。"""

import copy
import importlib.util
import threading
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest


@pytest.mark.parametrize("cancel_after_compose", [False, True])
def test_start_cancellation_does_not_wait_for_models(
    runtime_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    cancel_after_compose: bool,
) -> None:
    """起動前・Compose直後の終了要求で、モデル待機を中断する。"""
    stopped = threading.Event()
    if not cancel_after_compose:
        stopped.set()
    docker = Mock(side_effect=lambda *_args, **_kwargs: stopped.set())
    monkeypatch.setattr(
        runtime_module, "postgres", lambda: SimpleNamespace(docker=docker)
    )
    monkeypatch.setattr(runtime_module, "resources", lambda _state: ({}, []))
    monkeypatch.setattr(runtime_module, "environment", lambda _state: {})
    probe = Mock(
        side_effect=AssertionError("readiness must not run after cancellation")
    )
    monkeypatch.setattr(runtime_module.urllib.request, "urlopen", probe)
    state = {"owner_id": "owned", "ingress_network_id": "ingress", "images": {}}
    with pytest.raises(InterruptedError, match="cancelled"):
        runtime_module.start(state, stop_event=stopped)
    assert docker.call_count == int(cancel_after_compose)
    probe.assert_not_called()


def test_serve_cancellation_cleans_owned_services(
    runtime_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    """起動途中のキャンセルでもfinallyから専用サービスを片付ける。"""
    state = {"owner_id": "owned"}
    monkeypatch.setattr("sys.argv", ["owned_runtime.py", "serve"])
    monkeypatch.setattr(runtime_module, "load_state", lambda: state)
    monkeypatch.setattr(runtime_module.signal, "signal", lambda *_args: None)
    monkeypatch.setattr(
        runtime_module, "start", Mock(side_effect=InterruptedError("cancelled"))
    )
    stop = Mock()
    monkeypatch.setattr(runtime_module, "stop", stop)
    assert runtime_module.main() == 0
    stop.assert_called_once_with(state)


@pytest.fixture
def runtime_module() -> ModuleType:
    """製品アプリを起動せず、検証用ランタイムのガードを読み込む。"""
    path = Path(__file__).resolve().parents[2] / "e2e/scripts/owned_runtime.py"
    spec = importlib.util.spec_from_file_location("owned_runtime", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def resources() -> tuple[dict, dict, list[dict]]:
    """通信遮断ネットワークと読み取り専用モデルを持つ実体情報を返す。"""
    state = {
        "owner_id": "a" * 32,
        "network_id": "b" * 64,
        "images": {"backend": "sha256:" + "c" * 64},
    }
    network = {
        "Id": state["network_id"],
        "Internal": True,
        "Labels": {"sonowa.certification.owner": state["owner_id"]},
    }
    container = {
        "Id": "d" * 64,
        "Image": state["images"]["backend"],
        "Config": {
            "Labels": {
                "sonowa.certification.owner": state["owner_id"],
                "sonowa.certification.role": "backend",
            }
        },
        "NetworkSettings": {"Networks": {"owned": {"NetworkID": state["network_id"]}}},
        "Mounts": [{"Destination": "/models", "Name": "sonowa_models", "RW": False}],
    }
    return state, network, [container]


def test_owned_isolated_resources_are_accepted(
    runtime_module: ModuleType, resources: tuple[dict, dict, list[dict]]
) -> None:
    """実体が所有状態と一致する場合のみ後続処理を許す。"""
    runtime_module.validate_resources(*resources)


@pytest.mark.parametrize(
    "status,network_name,accepted",
    [
        ("created", "owned", True),
        ("created", "foreign", False),
        ("running", "owned", False),
    ],
)
def test_only_created_services_may_have_unattached_owned_networks(
    runtime_module: ModuleType,
    resources: tuple[dict, dict, list[dict]],
    status: str,
    network_name: str,
    accepted: bool,
) -> None:
    """Compose作成途中では、所有確認済みネットワーク名のみを許す。"""
    state, network, containers = copy.deepcopy(resources)
    network["Name"] = "owned"
    containers[0]["State"] = {"Status": status}
    containers[0]["NetworkSettings"]["Networks"] = {network_name: {"NetworkID": ""}}
    if accepted:
        runtime_module.validate_resources(state, network, containers)
    else:
        with pytest.raises(ValueError):
            runtime_module.validate_resources(state, network, containers)


@pytest.mark.parametrize(
    "mismatch",
    ["owner", "network_owner", "external", "image", "network", "model_write"],
)
def test_changed_resources_are_rejected(
    runtime_module: ModuleType, resources: tuple[dict, dict, list[dict]], mismatch: str
) -> None:
    """外部通信・別所有者・別イメージ・モデル書込みを拒否する。"""
    state, network, containers = copy.deepcopy(resources)
    if mismatch == "owner":
        containers[0]["Config"]["Labels"]["sonowa.certification.owner"] = "foreign"
    elif mismatch == "network_owner":
        network["Labels"]["sonowa.certification.owner"] = "foreign"
    elif mismatch == "external":
        network["Internal"] = False
    elif mismatch == "image":
        containers[0]["Image"] = "sha256:" + "f" * 64
    elif mismatch == "network":
        containers[0]["NetworkSettings"]["Networks"]["external"] = {
            "NetworkID": "f" * 64
        }
    else:
        containers[0]["Mounts"][0]["RW"] = True
    with pytest.raises(ValueError):
        runtime_module.validate_resources(state, network, containers)


def test_only_gateway_may_join_the_owned_ingress(
    runtime_module: ModuleType, resources: tuple[dict, dict, list[dict]]
) -> None:
    """入口だけに2つ目のネットワークを許し、推論サービスには許さない。"""
    state, network, containers = copy.deepcopy(resources)
    state["ingress_network_id"] = "e" * 64
    state["images"]["gateway"] = "sha256:" + "f" * 64
    ingress = {
        "Id": state["ingress_network_id"],
        "Internal": False,
        "Labels": {"sonowa.certification.owner": state["owner_id"]},
    }
    gateway = copy.deepcopy(containers[0])
    gateway["Config"]["Labels"]["sonowa.certification.role"] = "gateway"
    gateway["Image"] = state["images"]["gateway"]
    gateway["NetworkSettings"]["Networks"]["ingress"] = {
        "NetworkID": state["ingress_network_id"]
    }
    runtime_module.validate_resources(state, network, [*containers, gateway], ingress)
    containers[0]["NetworkSettings"]["Networks"]["ingress"] = {
        "NetworkID": state["ingress_network_id"]
    }
    with pytest.raises(ValueError):
        runtime_module.validate_resources(state, network, containers, ingress)
