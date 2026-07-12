#!/usr/bin/env bash
# LAMS 起動スクリプトで共有する検証・環境読込処理。

set -Eeuo pipefail

readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEFAULT_BACKEND_PORT=8090
readonly DEFAULT_FRONTEND_PORT=5273

info() { printf '[INFO] %s\n' "$*"; }
ok() { printf '[OK] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "必要なコマンドが見つかりません: $1"
}

load_project_env() {
    local key value
    local -A original=()

    if [[ -f "${PROJECT_ROOT}/.env" ]]; then
        # 呼出元の環境変数を .env より優先する。
        while IFS='=' read -r key _; do
            [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
            if [[ -v "$key" ]]; then
                original["$key"]="${!key}"
            fi
        done < <(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1=/p' "${PROJECT_ROOT}/.env")

        set -a
        # shellcheck disable=SC1091
        source "${PROJECT_ROOT}/.env"
        set +a

        for key in "${!original[@]}"; do
            printf -v "$key" '%s' "${original[$key]}"
            export "$key"
        done
    else
        warn ".env がありません。API キーをシェル環境変数で指定してください。"
    fi

    export BACKEND_PORT="${BACKEND_PORT:-$DEFAULT_BACKEND_PORT}"
    export FRONTEND_PORT="${FRONTEND_PORT:-$DEFAULT_FRONTEND_PORT}"
}

validate_port() {
    local name="$1" value="${!1}"
    [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1 && value <= 65535 )) || \
        die "${name} は 1～65535 の整数で指定してください: ${value}"
}

validate_ipv4() {
    local value="$1"
    awk -F. 'NF == 4 { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i > 255) exit 1; exit 0 } { exit 1 }' \
        <<<"$value" || die "有効な IPv4 アドレスを指定してください: ${value}"
}

validate_provider_key() {
    local provider="${AI_PROVIDER:-gpt4o_transcribe}"
    case "$provider" in
        deepgram)
            [[ -n "${DEEPGRAM_API_KEY:-}" ]] || die "AI_PROVIDER=deepgram には DEEPGRAM_API_KEY が必要です。"
            ;;
        google)
            [[ -n "${GOOGLE_PROJECT_ID:-}" ]] || warn "GOOGLE_PROJECT_ID がないため、起動後にフォールバックする可能性があります。"
            ;;
        gemini_live)
            [[ -n "${GEMINI_API_KEY:-}" ]] || die "AI_PROVIDER=gemini_live には GEMINI_API_KEY が必要です。"
            ;;
        gpt4o_transcribe|gpt_realtime)
            [[ -n "${OPENAI_API_KEY:-}" ]] || die "AI_PROVIDER=${provider} には OPENAI_API_KEY が必要です。"
            ;;
        *) die "未対応の AI_PROVIDER です: ${provider}" ;;
    esac
}

detect_lan_ip() {
    local candidate=""

    if [[ -n "${HOST_IP:-}" && "${HOST_IP}" != "127.0.0.1" && "${HOST_IP}" != "localhost" ]]; then
        candidate="$HOST_IP"
    elif grep -qi microsoft /proc/version 2>/dev/null && command -v powershell.exe >/dev/null 2>&1; then
        candidate="$(powershell.exe -NoProfile -Command \
            "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -notlike '127.*' -and \$_.IPAddress -notlike '169.254.*' -and \$_.InterfaceAlias -notmatch 'vEthernet|Loopback|VPN' } | Sort-Object SkipAsSource | Select-Object -First 1 -ExpandProperty IPAddress" \
            2>/dev/null | tr -d '\r' | head -n1)"
    fi

    if [[ -z "$candidate" ]]; then
        candidate="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
    fi

    [[ -n "$candidate" ]] || die "LAN IP を検出できません。HOST_IP=192.168.x.x を指定してください。"
    validate_ipv4 "$candidate"
    printf '%s\n' "$candidate"
}

show_access_urls() {
    local ip="$1"
    ok "このマシン: http://localhost:${FRONTEND_PORT}"
    ok "LAN 内の他マシン: http://${ip}:${FRONTEND_PORT}"
    info "API: http://${ip}:${BACKEND_PORT}/docs"
}
