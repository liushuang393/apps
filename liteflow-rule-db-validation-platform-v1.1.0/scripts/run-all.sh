#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
mkdir -p reports
on_error() {
  local code=$?
  {
    echo "status=FAIL"
    echo "exitCode=$code"
    echo "failedAt=$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    echo "line=${BASH_LINENO[0]:-unknown}"
    echo "command=${BASH_COMMAND:-unknown}"
    echo "installLog=reports/install.log"
    echo "validationLog=reports/validation-run.log"
  } > reports/run-all-failure.txt
  echo "[ERROR] Run failed. Evidence: $ROOT_DIR/reports/run-all-failure.txt" >&2
  exit "$code"
}
trap on_error ERR
if command -v python3 >/dev/null 2>&1; then
  # cd したのは $ROOT_DIR であってスクリプトの場所ではない。
  # ./preflight.sh では見つからず、set -Eeuo pipefail の下で最初の手順で死ぬ。
  "$ROOT_DIR/scripts/preflight.sh"
else
  echo "[WARN] python3 not found; host preflight skipped. Docker build/JUnit will still run."
fi
"$ROOT_DIR/scripts/install.sh"
"$ROOT_DIR/scripts/validate.sh"
rm -f reports/run-all-failure.txt
