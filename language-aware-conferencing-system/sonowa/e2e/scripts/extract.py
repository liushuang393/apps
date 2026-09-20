"""Sonowa MVP 既存コードから業務フロー候補抽出 CLI (testing-kit テンプレから生成)。

抽出対象（sonowa 範囲内のみ）:
    - React Router の Route
    - FastAPI router の decorator
    - Role 定義（backend/app/db/models.py のUserRoleから）
"""

from __future__ import annotations

import argparse
import ast
import logging
import os
import re
from pathlib import Path


APP_NAME = "sonowa"
logger = logging.getLogger(__name__)
APP_KIND = "ui"
APP_E2E_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = (
    Path(
        os.environ.get(
            "E2E_PROJECT_ROOT",
            str(APP_E2E_ROOT / ".."),
        )
    )
    .expanduser()
    .resolve()
)
if not REPO_ROOT.is_dir() or not APP_E2E_ROOT.is_relative_to(REPO_ROOT):
    raise RuntimeError("E2E project root is invalid or does not contain app E2E")
APP_ROOT_REL = "."
APP_ROOT = REPO_ROOT / APP_ROOT_REL

_ROUTE_PATTERN = re.compile(
    r'<Route\s+path=["\']([^"\']+)["\']\s+element=\{[^}]*<(\w+)\b'
)

# --- P-1 (2026-06-13): frontend 走査で生成物を除外（playwright-report 等を実画面と誤検出しない） ---
_GENERATED_DIRS = {
    "playwright-report",
    "node_modules",
    "dist",
    "build",
    "test-results",
    ".next",
    "coverage",
}


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
    for tsx in (REPO_ROOT / "frontend/src").rglob("App.tsx"):
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


def _string(node: ast.AST) -> str:
    """ソース上の文字列リテラルを取得し、動的な値を推測で補わない。"""
    if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
        raise ValueError("dynamic route expression requires explicit source support")
    return node.value


def _prefix(call: ast.Call) -> str:
    """router生成・登録のprefixを読み、未指定なら空文字を返す。"""
    return next((_string(k.value) for k in call.keywords if k.arg == "prefix"), "")


def _registered_routes(
    module: str, owner: str, prefix: str = "", stack: tuple[tuple[str, str], ...] = ()
) -> list[dict[str, str]]:
    """製品の登録グラフをASTで追跡し、実行せずに公開パスを合成する。"""
    marker = (module, owner)
    if marker in stack:
        raise ValueError("cyclic router registration")
    if not module.startswith("app."):
        raise ValueError("router source must belong to backend/app")
    path = REPO_ROOT / "backend" / Path(*module.split("."))
    path = (
        path.with_suffix(".py")
        if path.with_suffix(".py").is_file()
        else path / "__init__.py"
    )
    if not path.is_file():
        raise ValueError(f"registered router source is missing: {module}")
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imports: dict[str, tuple[str, str]] = {}
    constructors: dict[str, ast.Call] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            base = module.split(".")[: -node.level] if node.level else []
            imported_module = ".".join([*base, *(node.module or "").split(".")]).rstrip(
                "."
            )
            for name in node.names:
                imports[name.asname or name.name] = (imported_module, name.name)
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    constructors[target.id] = node.value
    next_stack = (*stack, marker)
    if owner not in constructors:
        if owner in imports:
            imported_module, imported_owner = imports[owner]
            return _registered_routes(
                imported_module, imported_owner, prefix, next_stack
            )
        raise ValueError(f"registered router declaration is missing: {module}.{owner}")
    full_prefix = prefix + _prefix(constructors[owner])
    results: list[dict[str, str]] = []
    methods = {
        "get",
        "post",
        "put",
        "patch",
        "delete",
        "options",
        "head",
        "trace",
        "websocket",
        "api_route",
    }
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if not isinstance(node.func.value, ast.Name) or node.func.value.id != owner:
            continue
        action = node.func.attr
        if action == "include_router":
            if not node.args or not isinstance(node.args[0], ast.Name):
                raise ValueError("dynamic include_router target is unsupported")
            child = node.args[0].id
            child_module, child_owner = imports.get(child, (module, child))
            results.extend(
                _registered_routes(
                    child_module, child_owner, full_prefix + _prefix(node), next_stack
                )
            )
        elif action in methods:
            route_node = (
                node.args[0]
                if node.args
                else next((k.value for k in node.keywords if k.arg == "path"), None)
            )
            if route_node is None:
                raise ValueError("registered route path is missing")
            route_path = _string(route_node)
            route_methods = [action.upper()]
            if action == "api_route":
                method_node = next(
                    (k.value for k in node.keywords if k.arg == "methods"),
                    ast.List(elts=[ast.Constant("GET")]),
                )
                if not isinstance(method_node, (ast.List, ast.Tuple, ast.Set)):
                    raise ValueError("dynamic route methods are unsupported")
                route_methods = [_string(item).upper() for item in method_node.elts]
            for method in route_methods:
                results.append(
                    {
                        "method": method,
                        "path": full_prefix + route_path,
                        "source": path.relative_to(REPO_ROOT).as_posix(),
                    }
                )
    return results


def _extract_routes() -> list[dict[str, str]]:
    """本アプリのエントリーポイントに登録されたルートだけを列挙する。"""
    routes = _registered_routes("app.main", "app")
    if not routes:
        raise ValueError("no registered product routes were extracted")
    if len({(r["method"], r["path"]) for r in routes}) != len(routes):
        raise ValueError("duplicate route registrations require review")
    return sorted(routes, key=lambda route: (route["path"], route["method"]))


def _extract_roles() -> list[str]:
    """UserRoleだけをASTで読み、欠損・空・動的定義は明示的に失敗する。"""
    auth = REPO_ROOT / "backend/app/db/models.py"
    if not auth.exists():
        raise ValueError("UserRole source is missing")
    try:
        tree = ast.parse(auth.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, SyntaxError) as exc:
        raise ValueError("UserRole source cannot be parsed") from exc
    definitions = [
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == "UserRole"
    ]
    if len(definitions) != 1:
        raise ValueError("UserRole declaration is missing or ambiguous")
    roles = [
        _string(node.value)
        for node in definitions[0].body
        if isinstance(node, ast.Assign)
    ]
    if not roles:
        raise ValueError("UserRole has no declared values")
    return list(dict.fromkeys(roles))


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
    logger.info(
        f"[{APP_NAME}/extract] 出力 {display} "
        f"(screens={len(screens)}, routes={len(routes)}, roles={len(roles)})"
    )

    if not screens and not routes:
        logger.error("[%s/extract] 何も抽出できなかった", APP_NAME)
        return 1
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(main())
