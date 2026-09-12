"""Sonowa MVP 既存コードから業務フロー候補抽出 CLI (testing-kit テンプレから生成)。

抽出対象（sonowa 範囲内のみ）:
    - React Router の Route
    - FastAPI router の decorator
    - Role 定義（apps/common_services/auth_service/models/authorization.py から）
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path


APP_NAME = "sonowa"
APP_KIND = "ui"
APP_E2E_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = Path(
    os.environ.get(
        "E2E_PROJECT_ROOT",
        str(APP_E2E_ROOT / ".."),
    )
).expanduser().resolve()
if not REPO_ROOT.is_dir() or not APP_E2E_ROOT.is_relative_to(REPO_ROOT):
    raise RuntimeError("E2E project root is invalid or does not contain app E2E")
APP_ROOT_REL = "."
APP_ROOT = REPO_ROOT / APP_ROOT_REL

_ROUTE_PATTERN = re.compile(
    r'<Route\s+path=["\']([^"\']+)["\']\s+element=\{[^}]*<(\w+)\b'
)
_FASTAPI_PATTERN = re.compile(
    r'@(router|app)\.(get|post|put|delete|patch)\(\s*["\']([^"\']+)["\']'
)
_FASTAPI_PREFIX = re.compile(
    r'APIRouter\([^)]*prefix\s*=\s*["\']([^"\']+)["\']'
)
_ROLE_ENUM = re.compile(r'^\s*(\w+)\s*=\s*["\'](\w+)["\']', re.MULTILINE)

# --- P-1 (2026-06-13): frontend 走査で生成物を除外（playwright-report 等を実画面と誤検出しない） ---
_GENERATED_DIRS = {"playwright-report", "node_modules", "dist", "build", "test-results", ".next", "coverage"}


def _is_generated_path(_p: Path) -> bool:
    return any(_part in _GENERATED_DIRS for _part in _p.parts)


def _is_nested_app_path(_p: Path) -> bool:
    try:
        rel = _p.relative_to(APP_ROOT)
    except ValueError:
        return False
    current = APP_ROOT
    for part in rel.parts[:-1]:
        current = current / part
        if (current / "app_config.json").is_file():
            return True
    return False


def _is_out_of_scope_path(_p: Path) -> bool:
    if _is_generated_path(_p):
        return True
    return APP_KIND == "api" and _is_nested_app_path(_p)


def _extract_screens() -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    if APP_KIND == "api":
        return results
    if not APP_ROOT.exists():
        return results
    for tsx in APP_ROOT.rglob("App.tsx"):
        if _is_out_of_scope_path(tsx):
            continue
        try:
            content = tsx.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for match in _ROUTE_PATTERN.finditer(content):
            results.append(
                {
                    "path": match.group(1),
                    "component": match.group(2),
                    "source": tsx.relative_to(REPO_ROOT).as_posix(),
                }
            )
        # react-router を使わない単一シェル SPA（state でパネル切替）は
        # <Route> が 0 件でも実画面 1 枚を持つ。screens=0 と数えると
        # 品質レポートの crit1（screens>=1）が偽 fail になるため "/" を 1 画面と数える。
        if not results and "data-testid" in content:
            results.append(
                {
                    "path": "/",
                    "component": "App",
                    "source": tsx.relative_to(REPO_ROOT).as_posix(),
                }
            )
    return results


def _extract_routes() -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    if not APP_ROOT.exists():
        return results
    for py_file in APP_ROOT.rglob("*.py"):
        if _is_out_of_scope_path(py_file):
            continue
        try:
            content = py_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        prefix_match = _FASTAPI_PREFIX.search(content)
        prefix = prefix_match.group(1) if prefix_match else ""
        for match in _FASTAPI_PATTERN.finditer(content):
            owner, method, path = match.groups()
            route_prefix = prefix if owner == "router" else ""
            results.append(
                {
                    "method": method.upper(),
                    "path": f"{route_prefix}{path}",
                    "source": py_file.relative_to(REPO_ROOT).as_posix(),
                }
            )
    return results


def _extract_roles() -> list[str]:
    auth = (
        REPO_ROOT
        / "apps"
        / "common_services"
        / "auth_service"
        / "models"
        / "authorization.py"
    )
    if not auth.exists():
        return []
    try:
        content = auth.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    return [m.group(2) for m in _ROLE_ENUM.finditer(content)]


def _dump_yaml(data: dict[str, object], indent: int = 0) -> str:
    lines: list[str] = []
    prefix = "  " * indent
    for key, value in data.items():
        if isinstance(value, list):
            if not value:
                lines.append(f"{prefix}{key}: []")
                continue
            lines.append(f"{prefix}{key}:")
            for item in value:
                if isinstance(item, dict):
                    first = True
                    for k, v in item.items():
                        marker = "- " if first else "  "
                        lines.append(f"{prefix}  {marker}{k}: {_yaml_value(v)}")
                        first = False
                else:
                    lines.append(f"{prefix}  - {_yaml_value(item)}")
        elif isinstance(value, dict):
            lines.append(f"{prefix}{key}:")
            lines.append(_dump_yaml(value, indent + 1))
        else:
            lines.append(f"{prefix}{key}: {_yaml_value(value)}")
    return "\n".join(lines)


def _yaml_value(value: object) -> str:
    if isinstance(value, str):
        if any(c in value for c in (":", "#", "{", "[", "'", '"', "*")):
            escaped = value.replace('"', '\\"')
            return f'"{escaped}"'
        return value
    return str(value)


def main() -> int:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} 業務フロー候補抽出")
    parser.add_argument(
        "--out",
        type=Path,
        default=APP_E2E_ROOT / "docs" / "business-flows" / "_extracted.yaml",
    )
    args = parser.parse_args()

    screens = _extract_screens()
    routes = _extract_routes()
    roles = _extract_roles()

    data: dict[str, object] = {
        "app": APP_NAME,
        "extracted_at": "AUTO",
        "summary": {
            "screens": len(screens),
            "routes": len(routes),
            "roles": len(roles),
        },
        "screens": screens,
        "routes": routes,
        "roles": roles,
        "notes": [
            "これは候補の種であってシナリオではない",
            "次: testing-kit/prompts/reverse-flow.md を Claude Code に渡す",
        ],
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(_dump_yaml(data) + "\n", encoding="utf-8")
    try:
        display = args.out.relative_to(APP_E2E_ROOT).as_posix()
    except ValueError:
        display = str(args.out)
    print(
        f"[{APP_NAME}/extract] 出力 {display} "
        f"(screens={len(screens)}, routes={len(routes)}, roles={len(roles)})"
    )

    if not screens and not routes:
        print(f"[{APP_NAME}/extract] 警告: 何も抽出できなかった", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
