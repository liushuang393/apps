#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
mkdir -p reports
rm -f reports/install-failure.txt
rm -f reports/build-evidence.json reports/build-metadata.json
rm -rf reports/junit
LOG_FILE="reports/install.log"
: > "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

on_error() {
  local code=$?
  printf 'status=FAIL\nexitCode=%s\nfailedAt=%s\nlog=reports/install.log\n' "$code" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" > reports/install-failure.txt
  echo "[ERROR] Install failed. See reports/install.log and reports/install-failure.txt" >&2
  exit "$code"
}
trap on_error ERR

fail() { echo "[ERROR] $*" >&2; return 1; }
command -v docker >/dev/null 2>&1 || fail "Docker が見つかりません。Docker Desktop または Docker Engineをインストールしてください。"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2が利用できません。"
# 上の2つの確認は daemon が停止していても通る。エンジンを実際に必要とする最初のコマンドが
# `docker info` である。
docker info >/dev/null 2>&1 || fail "Docker daemon に接続できません。Docker Desktop / Docker Engine を起動してから再実行してください。"
docker compose config >/dev/null || fail "docker-compose.ymlが不正です。"

echo "[1/4] 固定バージョンの実行イメージ取得"
# ローカルに無いものだけを取得する。INSTALL_FORCE=1 で全件を取り直す。
to_pull=""
for pair in "mariadb=mariadb:11.4.12" "prometheus=prom/prometheus:v3.13.1" \
            "grafana=grafana/grafana:13.1.1" "validator=python:3.13-slim"; do
  service="${pair%%=*}"
  image="${pair#*=}"
  if [ "${INSTALL_FORCE:-0}" != "1" ] && docker image inspect "$image" >/dev/null 2>&1; then
    echo "  - $image はローカルに存在（取得スキップ）"
  else
    to_pull="$to_pull $service"
  fi
done
if [ -n "$to_pull" ]; then
  # shellcheck disable=SC2086
  docker compose pull $to_pull
else
  echo "  - すべてローカルに存在。取得不要。"
fi

echo "[2/4] アプリケーションイメージ構築（mvn clean verifyを実行）"
if [ "${INSTALL_FORCE:-0}" = "1" ]; then
  docker compose build --pull executor-a
else
  docker compose build executor-a
fi

echo "[3/4] JUnit XML証跡の抽出"
rm -rf reports/junit
mkdir -p reports/junit
container_id="$(docker create liteflow-rule-db-validation-app:1.0.0)"
cleanup() { docker rm -f "$container_id" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker cp "$container_id:/app/test-reports/." reports/junit/
docker cp "$container_id:/app/build-metadata.json" reports/build-metadata.json
find reports/junit -maxdepth 1 -type f -name 'TEST-*.xml' -print -quit | grep -q . || fail "JUnit XML was not extracted."
test -s reports/build-metadata.json || fail "build-metadata.json is empty."
cleanup
trap - EXIT

echo "[4/4] ビルド証跡作成"
image_id="$(docker image inspect liteflow-rule-db-validation-app:1.0.0 --format '{{.Id}}')"
built_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
cat > reports/build-evidence.json <<JSON
{
  "status": "PASS",
  "builtAt": "$built_at",
  "image": "liteflow-rule-db-validation-app:1.0.0",
  "imageId": "$image_id",
  "buildCommand": "docker compose build --pull executor-a",
  "mavenCommand": "mvn -B -ntp clean verify",
  "junitDirectory": "reports/junit",
  "liteflowResolutionMetadata": "reports/build-metadata.json"
}
JSON

rm -f reports/install-failure.txt
echo "インストール完了: $image_id"
echo "次の操作: scripts/validate.sh"
