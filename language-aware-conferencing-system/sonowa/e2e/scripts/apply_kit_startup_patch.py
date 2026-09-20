#!/usr/bin/env python3
"""復旧済みTesting Kitの既知バージョンへ、起動待ち契約の互換修正を適用する。

入力: この作業コピー内のKitのみ。出力: 検証済み状態をログへ記録する。
内容ハッシュが異なる版へ推測で適用しない。業務シナリオ・判定値は変更しない。
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KERNEL = ROOT / ".venv-testing-kit/testing_kit/scripts/certify_project.py"
ORIGINAL_SHA256 = "135c14a11432132ea793028d4be6d82380f9db8da3b2671dbd52fb433fe6d879"
PATCHED_SHA256 = "979809de8bc779da6d98ea6a5b8c37e30d0a484ca6af2c57c0178171cbf20b6a"
BEFORE = b"        deadline = time.monotonic() + 30\n"
AFTER = b'        deadline = time.monotonic() + self._command("server_start").timeout_seconds\n'
logger = logging.getLogger(__name__)


def patched_bytes(source: bytes) -> bytes:
    """既知の元ファイルまたは適用済みファイルだけを受理する。"""
    digest = hashlib.sha256(source).hexdigest()
    if digest == PATCHED_SHA256:
        return source
    if digest != ORIGINAL_SHA256 or source.count(BEFORE) != 1:
        raise ValueError(
            "unknown Testing Kit kernel; review the installed version first"
        )
    patched = source.replace(BEFORE, AFTER, 1)
    if hashlib.sha256(patched).hexdigest() != PATCHED_SHA256:
        raise ValueError("Testing Kit patch digest differs from the reviewed change")
    return patched


def main() -> int:
    """他リポジトリを変更せず、専用venvの内容を照合して適用する。"""
    path = KERNEL.resolve()
    if not path.is_relative_to(ROOT / ".venv-testing-kit"):
        raise ValueError("Testing Kit kernel is outside the project-owned environment")
    original = path.read_bytes()
    changed = patched_bytes(original)
    if original != changed:
        path.write_bytes(changed)
    logger.info("Testing Kit startup contract verified: %s", PATCHED_SHA256)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(main())
