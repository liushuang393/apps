#!/usr/bin/env bash
# Sonowa E2E A レーン: existing-server 上の Playwright smoke + regression
# 前提: frontend:5273 / API:8090 が既に listen していること（Docker 可なら compose 起動済み）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export E2E_DEPLOYMENT_MODE="${E2E_DEPLOYMENT_MODE:-existing-server}"
export E2E_ALLOW_NO_DB="${E2E_ALLOW_NO_DB:-1}"
export E2E_JSON_REPORT="${E2E_JSON_REPORT:-1}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:5273}"
export E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://127.0.0.1:8090}"
export E2E_RUN_ID="${E2E_RUN_ID:-r$(date +%s | awk '{printf "%x",$1}')}"
export SONOWA_E2E_MOCK_AI="${SONOWA_E2E_MOCK_AI:-1}"

# グローバル ms-playwright が root 所有でも動くよう、プロジェクトローカルを優先
LOCAL_PW="$ROOT/.scratch/ms-playwright"
if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" && -d "$LOCAL_PW/chromium_headless_shell-1200" ]]; then
  export PLAYWRIGHT_BROWSERS_PATH="$LOCAL_PW"
fi

API_HEALTH="${E2E_API_BASE_URL%/}/health"
REPORT_DIR="$ROOT/docs/testing/report"
mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SUMMARY="$REPORT_DIR/e2e-a-lane-${STAMP}.md"

echo "[e2e_run_a_lane] waiting for ${API_HEALTH}"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS "$API_HEALTH" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
# Docker 無し環境向け: 自動でローカルスタックを起こす（明示オプトイン）
if [[ "$ok" -ne 1 && "${E2E_AUTO_LOCAL_STACK:-0}" == "1" ]]; then
  echo "[e2e_run_a_lane] API 未起動 → scripts/start-e2e-local-stack.sh"
  bash "$ROOT/scripts/start-e2e-local-stack.sh"
  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS "$API_HEALTH" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 2
  done
fi
if [[ "$ok" -ne 1 ]]; then
  echo "[e2e_run_a_lane] FAIL: API health not ready: ${API_HEALTH}" >&2
  echo "  hint: bash scripts/start-e2e-local-stack.sh または E2E_AUTO_LOCAL_STACK=1" >&2
  exit 2
fi

echo "[e2e_run_a_lane] auth_setup"
python3 "$ROOT/e2e/scripts/auth_setup.py"

set +e
npx --no-install playwright test \
  --config "$ROOT/e2e/playwright.config.ts" \
  --project=smoke \
  --project=regression
PW_EXIT=$?
set -e

{
  echo "# Sonowa E2E A-lane summary"
  echo
  echo "- timestamp: ${STAMP}"
  echo "- deployment: ${E2E_DEPLOYMENT_MODE}"
  echo "- E2E_ALLOW_NO_DB: ${E2E_ALLOW_NO_DB}"
  echo "- base: ${E2E_BASE_URL}"
  echo "- api: ${E2E_API_BASE_URL}"
  echo "- exit: ${PW_EXIT}"
  echo "- playwright JSON: e2e/playwright-report/results.json（E2E_JSON_REPORT=1）"
  echo
  echo "## Notes"
  echo
  echo "- Docker socket が使えない場合でも existing-server で実行可能"
  echo "- admin ケースは E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD 任意"
} > "$SUMMARY"

echo "[e2e_run_a_lane] wrote ${SUMMARY}"
exit "$PW_EXIT"
