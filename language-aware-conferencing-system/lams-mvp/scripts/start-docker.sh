#!/usr/bin/env bash
# WSL2 上の Docker Desktop へ LAMS 全サービスを起動する。

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/start-common.sh
source "${SCRIPT_DIR}/start-common.sh"

usage() {
    printf 'Usage: %s [--build] [--foreground] [--host-ip IPv4]\n' "$0"
}

build=false
detach=true
explicit_ip=""
while (($#)); do
    case "$1" in
        --build) build=true ;;
        --foreground) detach=false ;;
        --host-ip) shift; (($#)) || die "--host-ip の値が必要です。"; explicit_ip="$1" ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; die "不明な引数です: $1" ;;
    esac
    shift
done

require_command docker
docker info >/dev/null 2>&1 || die "Docker Engine が起動していません。Docker Desktop を起動してください。"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 が必要です。"

load_project_env
validate_port BACKEND_PORT
validate_port FRONTEND_PORT
validate_provider_key
export HOST_IP="${explicit_ip:-$(detect_lan_ip)}"
validate_ipv4 "$HOST_IP"

args=(compose up)
$detach && args+=(-d)
$build && args+=(--build)

info "Docker スタックを起動します（公開 IP: ${HOST_IP}）。"
cd "$PROJECT_ROOT"
docker "${args[@]}"

if $detach; then
    info "サービスの準備完了を確認しています。"
    for _ in {1..30}; do
        if curl -fsS "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1; then
            show_access_urls "$HOST_IP"
            exit 0
        fi
        sleep 2
    done
    docker compose ps
    die "60 秒以内に backend が準備完了になりませんでした。docker compose logs backend を確認してください。"
fi
