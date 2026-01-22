#!/bin/bash
# ===========================================
# LAMS 起動スクリプト（環境変数から.envを自動更新）
# ===========================================
# 使用方法:
#   export OPENAI_API_KEY=sk-xxx
#   ./start-with-keys.sh              # ローカル起動
#   ./start-with-keys.sh docker       # Docker起動
#   ./start-with-keys.sh "docker build" # Docker再ビルド
#
# 環境変数があれば.envを自動更新、なければそのまま
# ===========================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE=".env"

# .envファイルの値を更新する関数（環境変数があれば置換）
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

echo -e "${YELLOW}=== .env 更新チェック ===${NC}"
update_env_if_set "OPENAI_API_KEY"
update_env_if_set "GEMINI_API_KEY"
update_env_if_set "AI_PROVIDER"
update_env_if_set "HOST_IP"
echo ""

MODE="${1:-local}"

case "$MODE" in
    docker)
        echo -e "${GREEN}[Docker]${NC} 起動中..."
        docker compose up -d backend frontend
        echo -e "${GREEN}[OK]${NC} http://localhost:5173"
        ;;
    "docker build")
        echo -e "${GREEN}[Docker Build]${NC} 再ビルド起動中..."
        docker compose up -d --build backend frontend
        echo -e "${GREEN}[OK]${NC} http://localhost:5173"
        ;;
    local|*)
        echo -e "${GREEN}[Local]${NC} バックエンド起動中..."
        cd backend
        source ../.env 2>/dev/null || true
        export DATABASE_URL="${DATABASE_URL:-postgresql://lams:lams_secret_2024@localhost:5433/lams}"
        export REDIS_URL="${REDIS_URL:-redis://localhost:6380/0}"
        uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
        ;;
esac

