#!/usr/bin/env bash
# LAMS の統一起動入口。

set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/start-common.sh
source "${ROOT}/scripts/start-common.sh"

sync_host_ip() {
    # --host-ip、シェル環境変数、自動検出の順で公開 IP を決定する。
    local explicit_ip="" previous_ip="" detected_ip="" tmp_file=""
    local args=("$@")
    local index

    for ((index = 0; index < ${#args[@]}; index++)); do
        if [[ "${args[$index]}" == "--host-ip" && -n "${args[$((index + 1))]:-}" ]]; then
            explicit_ip="${args[$((index + 1))]}"
            break
        fi
    done

    if [[ -n "$explicit_ip" ]]; then
        detected_ip="$explicit_ip"
    else
        # .env / シェルの古い HOST_IP は使わず、毎回再検出する。
        unset HOST_IP
        detected_ip="$(detect_lan_ip)"
    fi
    validate_ipv4 "$detected_ip"
    export HOST_IP="$detected_ip"

    [[ -f "${ROOT}/.env" ]] || return 0
    previous_ip="$(sed -n 's/^HOST_IP=//p' "${ROOT}/.env" | head -n1)"
    [[ "$previous_ip" == "$detected_ip" ]] && return 0

    tmp_file="$(mktemp)"
    awk -v value="$detected_ip" '
        /^HOST_IP=/ { print "HOST_IP=" value; updated = 1; next }
        { print }
        END { if (!updated) print "HOST_IP=" value }
    ' "${ROOT}/.env" >"$tmp_file"
    mv "$tmp_file" "${ROOT}/.env"
    printf '[INFO] .env の HOST_IP を更新しました: %s → %s\n' \
        "${previous_ip:-未設定}" "$detected_ip"
}

sync_host_ip "$@"
exec "${ROOT}/scripts/start-docker.sh" "$@"
