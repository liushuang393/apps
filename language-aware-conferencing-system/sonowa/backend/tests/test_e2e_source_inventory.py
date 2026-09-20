"""Sonowaのソース台帳が別リポジトリや仮想環境を混入させない契約。"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest


@pytest.fixture
def extractor() -> ModuleType:
    """副作用を起こさず、アプリ所有の抽出関数を読み込む。"""
    path = Path(__file__).resolve().parents[2] / "e2e/scripts/extract.py"
    spec = importlib.util.spec_from_file_location("sonowa_source_inventory", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_actual_user_roles_are_extracted(extractor: ModuleType) -> None:
    """本アプリの正規ロールを全件抽出する。"""
    assert extractor._extract_roles() == ["admin", "moderator", "user"]


def test_role_extraction_ignores_other_enums(
    extractor: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """同じモデルファイル内の会議モード等をロールへ混ぜない。"""
    path = tmp_path / "backend/app/db/models.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        'class Other(Enum):\n    MODE = "hybrid"\n'
        'class UserRole(str, Enum):\n    ADMIN = "admin"\n    USER = "user"\n'
    )
    monkeypatch.setattr(extractor, "REPO_ROOT", tmp_path)
    assert extractor._extract_roles() == ["admin", "user"]


def test_missing_roles_fail_closed(
    extractor: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """参照先欠損を空の有効な台帳として受理しない。"""
    monkeypatch.setattr(extractor, "REPO_ROOT", tmp_path)
    with pytest.raises(ValueError, match="UserRole"):
        extractor._extract_roles()


def test_routes_follow_registered_prefixes_and_exclude_other_sources(
    extractor: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """登録したrouterだけを追跡し、二段のprefixを正しい順序で合成する。"""
    app = tmp_path / "backend/app"
    app.mkdir(parents=True)
    (app / "main.py").write_text(
        "from app.auth import router as auth_router\n"
        'app = FastAPI()\napp.include_router(auth_router, prefix="/api")\n'
        '@app.get("/health")\ndef health(): pass\n'
    )
    (app / "auth.py").write_text(
        'router = APIRouter(prefix="/auth")\n'
        '@router.post("/login")\ndef login(): pass\n'
    )
    (app / "unregistered.py").write_text('@router.get("/unused")\ndef unused(): pass\n')
    (tmp_path / "test_server.py").write_text('@app.get("/fake")\ndef fake(): pass\n')
    monkeypatch.setattr(extractor, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(extractor, "APP_ROOT", tmp_path)
    routes = extractor._extract_routes()
    assert {(r["method"], r["path"]) for r in routes} == {
        ("GET", "/health"),
        ("POST", "/api/auth/login"),
    }


def test_actual_routes_include_public_prefixes(extractor: ModuleType) -> None:
    """実アプリの認証・管理・会議室の入口を正確に数える。"""
    routes = extractor._extract_routes()
    pairs = {(r["method"], r["path"]) for r in routes}
    assert ("POST", "/api/auth/login") in pairs
    assert ("GET", "/api/admin/settings/ai-pipeline") in pairs
    assert all(r["source"].startswith("backend/app/") for r in routes)


def test_inventory_matches_registered_application_routes(extractor: ModuleType) -> None:
    """ソース起点の結果を、起動処理なしのFastAPI登録結果でも照合する。"""
    from app.main import app

    registered = {
        (method, route.path)
        for route in app.routes
        if getattr(getattr(route, "endpoint", None), "__module__", "").startswith(
            "app."
        )
        for method in getattr(route, "methods", {"WEBSOCKET"})
    }
    source = {(route["method"], route["path"]) for route in extractor._extract_routes()}
    assert source == registered


def test_screen_inventory_names_the_page_inside_auth_wrapper(
    extractor: ModuleType,
) -> None:
    """認証ラッパーを実画面名として誤記しない。"""
    screens = {
        screen["path"]: screen["component"] for screen in extractor._extract_screens()
    }
    assert screens["/menu"] == "MenuPage"
    assert screens["/admin/ai-pipeline"] == "AiPipelineSettingsPage"
