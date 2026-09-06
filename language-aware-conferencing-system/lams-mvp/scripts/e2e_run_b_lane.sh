#!/usr/bin/env bash
# LAMS E2E B レーン: 実 AI / LiveKit 統合（明示オプトイン）
# ゲート: E2E_ALLOW_REAL_AI=1 が無い場合は実行せず exit 0（スキップ）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${E2E_ALLOW_REAL_AI:-}" != "1" ]]; then
  echo "[e2e_run_b_lane] SKIP: set E2E_ALLOW_REAL_AI=1 to run real AI / LiveKit tests"
  exit 0
fi

export LAMS_API_BASE="${LAMS_API_BASE:-http://127.0.0.1:8090}"
export E2E_API_BASE_URL="${E2E_API_BASE_URL:-$LAMS_API_BASE}"

REPORT_DIR="$ROOT/docs/testing/report"
mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SUMMARY="$REPORT_DIR/e2e-b-lane-${STAMP}.md"

# コスト・時間上限（秒）。必要に応じて上書き可
export PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-180}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-120}"

echo "[e2e_run_b_lane] LiveKit two-clients integration (timeout=${PYTEST_TIMEOUT}s)"
set +e
(
  cd "$ROOT/backend"
  # 単一ファイル・単一ケースに限定して実行時間を抑える
  python -m pytest tests/integration/test_livekit_two_clients.py \
    -k "test_livekit_two_clients_subtitle_and_audio" \
    --timeout="${PYTEST_TIMEOUT}" \
    -q
)
LIVEKIT_EXIT=$?
set -e

echo "[e2e_run_b_lane] smoke_ai_pipeline_settings (timeout=${SMOKE_TIMEOUT}s)"
set +e
timeout "${SMOKE_TIMEOUT}" python3 "$ROOT/scripts/smoke_ai_pipeline_settings.py"
SMOKE_EXIT=$?
set -e

OVERALL=0
if [[ "$LIVEKIT_EXIT" -ne 0 || "$SMOKE_EXIT" -ne 0 ]]; then
  OVERALL=1
fi

{
  echo "# LAMS E2E B-lane summary"
  echo
  echo "- timestamp: ${STAMP}"
  echo "- E2E_ALLOW_REAL_AI: 1"
  echo "- livekit pytest exit: ${LIVEKIT_EXIT}"
  echo "- smoke_ai_pipeline_settings exit: ${SMOKE_EXIT}"
  echo "- overall: ${OVERALL}"
  echo
  echo "## Limits"
  echo
  echo "- pytest timeout: ${PYTEST_TIMEOUT}s"
  echo "- smoke timeout: ${SMOKE_TIMEOUT}s"
} > "$SUMMARY"

echo "[e2e_run_b_lane] wrote ${SUMMARY}"
exit "$OVERALL"
