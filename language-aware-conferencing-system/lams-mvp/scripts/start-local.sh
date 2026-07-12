#!/usr/bin/env bash
# 依存サービスを Docker、backend/frontend を WSL 上で起動する。

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/start-common.sh
source "${SCRIPT_DIR}/start-common.sh"

usage() {
    printf 'Usage: %s [--host-ip IPv4] [--skip-install]\n' "$0"
}

explicit_ip=""
skip_install=false
while (($#)); do
    case "$1" in
        --host-ip) shift; (($#)) || die "--host-ip の値が必要です。"; explicit_ip="$1" ;;
        --skip-install) skip_install=true ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; die "不明な引数です: $1" ;;
    esac
    shift
done

require_command docker
require_command node
require_command npm
require_command curl
command -v uvicorn >/dev/null 2>&1 || die "uvicorn がありません。backend の Python 依存を先に導入してください。"
docker info >/dev/null 2>&1 || die "Docker Engine が起動していません。"

load_project_env
validate_port BACKEND_PORT
validate_port FRONTEND_PORT
validate_provider_key
export HOST_IP="${explicit_ip:-$(detect_lan_ip)}"
validate_ipv4 "$HOST_IP"
export DATABASE_URL="${DATABASE_URL:-postgresql://lams:${DB_PASSWORD:-lams_secret_2024}@localhost:${DB_PORT:-5433}/lams}"
export REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT:-6380}/0}"
export LIVEKIT_URL="${LIVEKIT_URL:-ws://localhost:${LIVEKIT_PORT:-7880}}"
export LIVEKIT_WS_URL="${LIVEKIT_WS_URL:-ws://${HOST_IP}:${LIVEKIT_PORT:-7880}}"

cd "$PROJECT_ROOT"
info "PostgreSQL、Redis、LiveKit、coturn を Docker で起動します。"
docker compose up -d postgres redis livekit coturn

if [[ ! -d frontend/node_modules ]]; then
    $skip_install && die "frontend/node_modules がありません。--skip-install を外してください。"
    info "frontend の依存パッケージを導入します。"
    npm --prefix frontend ci
fi

pids=()
cleanup() {
    trap - EXIT INT TERM
    info "ローカル開発サーバーを停止します。"
    ((${#pids[@]})) && kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

info "backend と frontend を起動します。終了は Ctrl+C です。"
(cd backend && uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload) &
pids+=("$!")
(cd frontend && VITE_PORT="$FRONTEND_PORT" VITE_BACKEND_PORT="$BACKEND_PORT" npm run dev -- --host 0.0.0.0) &
pids+=("$!")

for _ in {1..30}; do
    if curl -fsS "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1; then
        show_access_urls "$HOST_IP"
        wait -n "${pids[@]}"
        exit $?
    fi
    sleep 1
done
die "backend が 30 秒以内に準備完了になりませんでした。直前のログを確認してください。"
