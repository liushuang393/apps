#!/usr/bin/env bash
# Sonowa E2E B レーン: 実 AI / LiveKit 統合（明示オプトイン）
# ゲート: E2E_ALLOW_REAL_AI=1 が無い場合は実行せず exit 0（スキップ）
#
# フロー:
#   1) LiveKit 2 クライアント統合（Docker LiveKit + OPENAI + API 鍵が必要）
#   2) smoke_ai_pipeline_settings（admin GET/PUT。SQLite 昇格可）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${E2E_ALLOW_REAL_AI:-}" != "1" ]]; then
  echo "[e2e_run_b_lane] SKIP: set E2E_ALLOW_REAL_AI=1 to run real AI / LiveKit tests"
  exit 0
fi

export SONOWA_API_BASE="${SONOWA_API_BASE:-http://127.0.0.1:8090}"
export E2E_API_BASE_URL="${E2E_API_BASE_URL:-$SONOWA_API_BASE}"
export SONOWA_FRONTEND="${SONOWA_FRONTEND:-http://127.0.0.1:5273}"

REPORT_DIR="$ROOT/docs/testing/report"
mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SUMMARY="$REPORT_DIR/e2e-b-lane-${STAMP}.md"

export PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-180}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-120}"

BACKEND_PY="${BACKEND_PY:-$ROOT/backend/.venv/bin/python}"
if [[ ! -x "$BACKEND_PY" ]]; then
  BACKEND_PY="$(command -v python3)"
fi

# --- preflight（値は出さない） ---
has_openai=0
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  has_openai=1
elif [[ -f "$ROOT/.env" ]] && grep -Eq '^[[:space:]]*OPENAI_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]#]+' "$ROOT/.env"; then
  has_openai=1
fi

docker_ok=0
docker_err=""
if docker info >/dev/null 2>&1; then
  docker_ok=1
else
  docker_err="$(docker info 2>&1 | head -n 3 | tr '\n' ' ' || true)"
fi

livekit_url_ok=0
if curl -fsS --max-time 3 "http://127.0.0.1:7880/" >/dev/null 2>&1 \
  || curl -fsS --max-time 3 "http://127.0.0.1:7880" >/dev/null 2>&1; then
  livekit_url_ok=1
fi

api_ok=0
if curl -fsS --max-time 5 "${SONOWA_API_BASE}/health" >/dev/null 2>&1; then
  api_ok=1
fi

# SQLite E2E DB（ローカルスタック）があれば admin 昇格に使う
SQLITE_DEFAULT="$ROOT/.scratch/sonowa_e2e.sqlite3"
if [[ -z "${SONOWA_E2E_SQLITE_PATH:-}" && -f "$SQLITE_DEFAULT" ]]; then
  export SONOWA_E2E_SQLITE_PATH="$SQLITE_DEFAULT"
fi

LIVEKIT_BLOCKERS=()
[[ "$has_openai" -eq 1 ]] || LIVEKIT_BLOCKERS+=("OPENAI_API_KEY missing")
[[ "$api_ok" -eq 1 ]] || LIVEKIT_BLOCKERS+=("API /health unreachable at ${SONOWA_API_BASE}")
[[ "$docker_ok" -eq 1 ]] || LIVEKIT_BLOCKERS+=("Docker unavailable: ${docker_err:-unknown}")
[[ "$livekit_url_ok" -eq 1 ]] || LIVEKIT_BLOCKERS+=("LiveKit :7880 unreachable")

LIVEKIT_EXIT=0
LIVEKIT_STATUS="PASS"
if [[ ${#LIVEKIT_BLOCKERS[@]} -gt 0 ]]; then
  LIVEKIT_EXIT=2
  LIVEKIT_STATUS="BLOCKED"
  echo "[e2e_run_b_lane] LiveKit two-clients BLOCKED: ${LIVEKIT_BLOCKERS[*]}"
else
  echo "[e2e_run_b_lane] LiveKit two-clients integration (timeout=${PYTEST_TIMEOUT}s)"
  set +e
  (
    cd "$ROOT/backend"
    "$BACKEND_PY" -m pytest tests/integration/test_livekit_two_clients.py \
      -k "test_livekit_two_clients_subtitle_and_audio" \
      --timeout="${PYTEST_TIMEOUT}" \
      -q
  )
  LIVEKIT_EXIT=$?
  set -e
  if [[ "$LIVEKIT_EXIT" -ne 0 ]]; then
    LIVEKIT_STATUS="FAIL"
  fi
fi

SMOKE_EXIT=0
SMOKE_STATUS="PASS"
echo "[e2e_run_b_lane] smoke_ai_pipeline_settings (timeout=${SMOKE_TIMEOUT}s)"
if [[ "$api_ok" -ne 1 ]]; then
  SMOKE_EXIT=2
  SMOKE_STATUS="BLOCKED"
  echo "[e2e_run_b_lane] smoke BLOCKED: API /health unreachable"
else
  set +e
  timeout "${SMOKE_TIMEOUT}" "$BACKEND_PY" "$ROOT/scripts/smoke_ai_pipeline_settings.py"
  SMOKE_EXIT=$?
  set -e
  if [[ "$SMOKE_EXIT" -ne 0 ]]; then
    SMOKE_STATUS="FAIL"
  fi
fi

OVERALL=0
# BLOCKED(2) は外部要因。総合は管理可能失敗のみ FAIL にする。
if [[ "$LIVEKIT_STATUS" == "FAIL" || "$SMOKE_STATUS" == "FAIL" ]]; then
  OVERALL=1
fi

{
  echo "# Sonowa E2E B-lane summary"
  echo
  echo "- timestamp: ${STAMP}"
  echo "- E2E_ALLOW_REAL_AI: 1"
  echo "- livekit status: ${LIVEKIT_STATUS} (exit ${LIVEKIT_EXIT})"
  echo "- smoke_ai_pipeline_settings status: ${SMOKE_STATUS} (exit ${SMOKE_EXIT})"
  echo "- overall_manageable_failures: ${OVERALL}"
  echo "- SONOWA_E2E_SQLITE_PATH set: $([[ -n "${SONOWA_E2E_SQLITE_PATH:-}" ]] && echo yes || echo no)"
  echo "- docker_ok: ${docker_ok}"
  echo "- livekit_url_ok: ${livekit_url_ok}"
  echo "- has_openai_key: ${has_openai}"
  echo
  if [[ ${#LIVEKIT_BLOCKERS[@]} -gt 0 ]]; then
    echo "## LiveKit blockers"
    echo
    for b in "${LIVEKIT_BLOCKERS[@]}"; do
      echo "- ${b}"
    done
    echo
  fi
  echo "## Limits"
  echo
  echo "- pytest timeout: ${PYTEST_TIMEOUT}s"
  echo "- smoke timeout: ${SMOKE_TIMEOUT}s"
} > "$SUMMARY"

echo "[e2e_run_b_lane] wrote ${SUMMARY}"
exit "$OVERALL"
