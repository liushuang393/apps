#!/usr/bin/env bash
# 旧起動コマンドとの互換性を保つための転送スクリプト。

set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-local}" in
    local) shift || true; exec "${ROOT}/scripts/start-local.sh" "$@" ;;
    docker) shift; exec "${ROOT}/scripts/start-docker.sh" "$@" ;;
    "docker build") shift; exec "${ROOT}/scripts/start-docker.sh" --build "$@" ;;
    *)
        printf '[ERROR] 不明なモードです: %s\n' "$1" >&2
        printf '新コマンド: scripts/start-local.sh または scripts/start-docker.sh [--build]\n' >&2
        exit 2
        ;;
esac
