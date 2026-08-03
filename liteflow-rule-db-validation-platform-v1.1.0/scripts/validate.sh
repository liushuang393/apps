#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
mkdir -p reports
rm -f reports/validation-failure.txt
rm -f reports/validation-report.md reports/validation-report.json reports/validation-state.json
LOG_FILE="reports/validation-run.log"
: > "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

on_error() {
  local code=$?
  printf 'status=FAIL\nexitCode=%s\nfailedAt=%s\nlog=reports/validation-run.log\nreport=reports/validation-report.md\n' "$code" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" > reports/validation-failure.txt
  echo "[ERROR] Validation failed. See reports/validation-run.log, reports/validation-failure.txt, and reports/validation-report.md" >&2
  exit "$code"
}
trap on_error ERR

fail() { echo "[ERROR] $*" >&2; return 1; }
command -v docker >/dev/null 2>&1 || fail "Docker が見つかりません。"
command -v curl >/dev/null 2>&1 || fail "curl が見つかりません。"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2が利用できません。"
docker info >/dev/null 2>&1 || fail "Docker daemon に接続できません。Docker Desktop / Docker Engine を起動してから再実行してください。"
docker compose config >/dev/null || fail "docker-compose.ymlが不正です。"
docker image inspect liteflow-rule-db-validation-app:1.0.0 >/dev/null 2>&1 || fail "アプリイメージがありません。先に scripts/install.sh を実行してください。"
test -f reports/build-evidence.json || fail "ビルド証跡がありません。先に scripts/install.sh を実行してください。"

wait_http() {
  local url="$1" name="$2" attempts="${3:-90}"
  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "  - $name: READY"
      return 0
    fi
    sleep 2
  done
  docker compose ps
  docker compose logs --tail=200 executor-a executor-b mariadb || true
  fail "$name が起動しませんでした: $url"
}

echo "[1/6] MariaDB、Executor、監視基盤起動"
docker compose up -d mariadb executor-a executor-b prometheus grafana

echo "[2/6] ヘルスチェック"
wait_http "http://localhost:8081/actuator/health" "Executor A"
wait_http "http://localhost:8082/actuator/health" "Executor B"
wait_http "http://localhost:9090/-/ready" "Prometheus"
wait_http "http://localhost:3000/api/health" "Grafana"

echo "[3/6] Rule-DB E2E検証"
docker compose run --rm validator --phase main

echo "[4/6] Executor B再起動"
docker compose restart executor-b
wait_http "http://localhost:8082/actuator/health" "Executor B（再起動後）"

echo "[5/6] 永続化・再ロード検証"
docker compose run --rm validator --phase persistence

rm -f reports/validation-failure.txt
echo "[6/6] 完了"
echo "検証レポート: $ROOT_DIR/reports/validation-report.md"
echo "JSON証跡:       $ROOT_DIR/reports/validation-report.json"
echo "JUnit証跡:      $ROOT_DIR/reports/junit"
echo "Executor A:    http://localhost:8081"
echo "Executor B:    http://localhost:8082"
echo "Prometheus:    http://localhost:9090"
echo "Grafana:       http://localhost:3000  (admin / admin)"
