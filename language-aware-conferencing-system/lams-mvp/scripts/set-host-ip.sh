#!/usr/bin/env bash
# 互換用: IP を永続化せず、検出結果と新しい起動方法を表示する。

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/start-common.sh
source "${SCRIPT_DIR}/start-common.sh"

load_project_env
HOST_IP="${1:-$(detect_lan_ip)}"
validate_ipv4 "$HOST_IP"
printf '検出した LAN IP: %s\n' "$HOST_IP"
printf 'Docker 起動: HOST_IP=%s ./scripts/start-docker.sh\n' "$HOST_IP"
printf 'ローカル起動: HOST_IP=%s ./scripts/start-local.sh\n' "$HOST_IP"
printf '注: この互換スクリプトは .env を変更しません。\n'
