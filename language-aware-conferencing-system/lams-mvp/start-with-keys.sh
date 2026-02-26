#!/bin/bash
# ===========================================
# LAMS 起動スクリプト（環境変数優先）
# ===========================================
# 使用方法:
#   export OPENAI_API_KEY=sk-xxx
#   ./start-with-keys.sh              # ローカル起動
#   ./start-with-keys.sh docker       # Docker起動
#   ./start-with-keys.sh "docker build" # Docker再ビルド
#
# APIキーは .env に書き戻さず、現在シェルの環境変数を優先して使用
# ===========================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE=".env"

# .env読み込み前に、既存の環境変数を退避（~/.bashrc等の設定を保護）
# 非空値が設定済みの変数は .env の空値で上書きされないようにする
_OPENAI_SET="${OPENAI_API_KEY+x}";   _OPENAI_VAL="${OPENAI_API_KEY:-}"
_GEMINI_SET="${GEMINI_API_KEY+x}";   _GEMINI_VAL="${GEMINI_API_KEY:-}"
_DEEPGRAM_SET="${DEEPGRAM_API_KEY+x}"; _DEEPGRAM_VAL="${DEEPGRAM_API_KEY:-}"
_HOST_IP_SET="${HOST_IP+x}";         _HOST_IP_VAL="${HOST_IP:-}"

# .envを先読みしてポート変数を取得（BACKEND_PORT, FRONTEND_PORTなど）
# これにより echo メッセージや uvicorn 起動コマンドで環境変数を使用できる
if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck source=.env
    source "$ENV_FILE" 2>/dev/null || true
    set +a
fi

# .env読み込みで上書きされた場合、元の非空値を復元する
# （.envに空値が書かれていても ~/.bashrc 等の設定が優先される）
if [ "$_OPENAI_SET" = "x" ]   && [ -n "$_OPENAI_VAL" ];   then export OPENAI_API_KEY="$_OPENAI_VAL"; fi
if [ "$_GEMINI_SET" = "x" ]   && [ -n "$_GEMINI_VAL" ];   then export GEMINI_API_KEY="$_GEMINI_VAL"; fi
if [ "$_DEEPGRAM_SET" = "x" ] && [ -n "$_DEEPGRAM_VAL" ]; then export DEEPGRAM_API_KEY="$_DEEPGRAM_VAL"; fi
if [ "$_HOST_IP_SET" = "x" ]  && [ -n "$_HOST_IP_VAL" ];  then export HOST_IP="$_HOST_IP_VAL"; fi

# .envファイルの値を更新する関数（非シークレットのみ）
update_env_if_set() {
    local key="$1"
    local value="${!key}"  # 間接参照で環境変数の値を取得

    if [ -n "$value" ]; then
        # sedで該当行を置換（キー=任意の値 → キー=新しい値）
        if grep -q "^${key}=" "$ENV_FILE"; then
            sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
            echo -e "  ${key}: ${GREEN}更新${NC} (${value:0:15}...)"
        fi
    else
        # 現在の.envの値を表示
        local current=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
        if [ -n "$current" ] && [ "$current" != "" ]; then
            echo -e "  ${key}: ${YELLOW}.env値使用${NC} (${current:0:15}...)"
        else
            echo -e "  ${key}: ${RED}未設定${NC}"
        fi
    fi
}

# シークレット系は .env に書かず、環境変数があるかだけ表示
show_secret_env_status() {
    local key="$1"
    local value="${!key}"

    if [ -n "$value" ]; then
        echo -e "  ${key}: ${GREEN}環境変数使用（.envへ保存しない）${NC} (${value:0:15}...)"
    else
        local current=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
        if [ -n "$current" ] && [ "$current" != "" ]; then
            echo -e "  ${key}: ${YELLOW}.env値使用${NC} (${current:0:15}...)"
        else
            echo -e "  ${key}: ${RED}未設定${NC}"
        fi
    fi
}

echo -e "${YELLOW}=== .env 更新チェック ===${NC}"
show_secret_env_status "OPENAI_API_KEY"
show_secret_env_status "GEMINI_API_KEY"
show_secret_env_status "DEEPGRAM_API_KEY"
update_env_if_set "AI_PROVIDER"
update_env_if_set "HOST_IP"
echo ""

MODE="${1:-local}"

case "$MODE" in
    docker)
        echo -e "${GREEN}[Docker]${NC} 起動中..."
        docker compose up -d backend frontend
        # FRONTEND_PORT は .env から先読み済み（未設定時は 5273 を使用）
        echo -e "${GREEN}[OK]${NC} http://localhost:${FRONTEND_PORT:-5273}"
        ;;
    "docker build")
        echo -e "${GREEN}[Docker Build]${NC} 再ビルド起動中..."
        docker compose up -d --build backend frontend
        echo -e "${GREEN}[OK]${NC} http://localhost:${FRONTEND_PORT:-5273}"
        ;;
    local|*)
        echo -e "${GREEN}[Local]${NC} バックエンド起動中..."
        cd backend
        # source時に上書きされないよう、シェル側で明示設定済みの値を保持
        OPENAI_WAS_SET=0
        GEMINI_WAS_SET=0
        DEEPGRAM_WAS_SET=0
        AI_PROVIDER_WAS_SET=0
        HOST_IP_WAS_SET=0

        if [ "${OPENAI_API_KEY+x}" = "x" ]; then OPENAI_WAS_SET=1; OPENAI_VAL="$OPENAI_API_KEY"; fi
        if [ "${GEMINI_API_KEY+x}" = "x" ]; then GEMINI_WAS_SET=1; GEMINI_VAL="$GEMINI_API_KEY"; fi
        if [ "${DEEPGRAM_API_KEY+x}" = "x" ]; then DEEPGRAM_WAS_SET=1; DEEPGRAM_VAL="$DEEPGRAM_API_KEY"; fi
        if [ "${AI_PROVIDER+x}" = "x" ]; then AI_PROVIDER_WAS_SET=1; AI_PROVIDER_VAL="$AI_PROVIDER"; fi
        if [ "${HOST_IP+x}" = "x" ]; then HOST_IP_WAS_SET=1; HOST_IP_VAL="$HOST_IP"; fi

        source ../.env 2>/dev/null || true

        if [ "$OPENAI_WAS_SET" -eq 1 ]; then export OPENAI_API_KEY="$OPENAI_VAL"; fi
        if [ "$GEMINI_WAS_SET" -eq 1 ]; then export GEMINI_API_KEY="$GEMINI_VAL"; fi
        if [ "$DEEPGRAM_WAS_SET" -eq 1 ]; then export DEEPGRAM_API_KEY="$DEEPGRAM_VAL"; fi
        if [ "$AI_PROVIDER_WAS_SET" -eq 1 ]; then export AI_PROVIDER="$AI_PROVIDER_VAL"; fi
        if [ "$HOST_IP_WAS_SET" -eq 1 ]; then export HOST_IP="$HOST_IP_VAL"; fi

        export DATABASE_URL="${DATABASE_URL:-postgresql://lams:lams_secret_2024@localhost:5433/lams}"
        export REDIS_URL="${REDIS_URL:-redis://localhost:6380/0}"
        # BACKEND_PORT は .env から先読み済み（未設定時は 8090 を使用）
        uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT:-8090}" --reload
        ;;
esac
