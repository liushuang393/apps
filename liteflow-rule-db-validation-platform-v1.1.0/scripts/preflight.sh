#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
command -v python3 >/dev/null 2>&1 || { echo "[ERROR] python3 is required for preflight." >&2; exit 1; }
python3 tools/preflight.py
