#!/bin/bash
# ===========================================
# LAMS 静的解析・フォーマットスクリプト
# ===========================================
#
# 使用方法:
#   ./scripts/check.sh [オプション]
#
# オプション:
#   --fix       自動修正を実行
#   --format    フォーマットのみ実行
#   --backend   バックエンドのみチェック
#   --frontend  フロントエンドのみチェック
#   -h, --help  ヘルプを表示
#
# 例:
#   ./scripts/check.sh           # 全チェック（修正なし）
#   ./scripts/check.sh --fix     # 全チェック＋自動修正
#   ./scripts/check.sh --format  # フォーマットのみ
# ===========================================

set -e

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# デフォルト設定
FIX_MODE=false
FORMAT_ONLY=false
CHECK_BACKEND=true
CHECK_FRONTEND=true

# ヘルプ表示
show_help() {
    echo "LAMS 静的解析・フォーマットスクリプト"
    echo ""
    echo "使用方法: ./scripts/check.sh [オプション]"
    echo ""
    echo "オプション:"
    echo "  --fix       自動修正を実行"
    echo "  --format    フォーマットのみ実行"
    echo "  --backend   バックエンドのみチェック"
    echo "  --frontend  フロントエンドのみチェック"
    echo "  -h, --help  ヘルプを表示"
    exit 0
}

# 引数解析
while [[ $# -gt 0 ]]; do
    case $1 in
        --fix)
            FIX_MODE=true
            shift
            ;;
        --format)
            FORMAT_ONLY=true
            shift
            ;;
        --backend)
            CHECK_FRONTEND=false
            shift
            ;;
        --frontend)
            CHECK_BACKEND=false
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            echo -e "${RED}不明なオプション: $1${NC}"
            exit 1
            ;;
    esac
done

# ヘッダー表示
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  LAMS 静的解析・フォーマット${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# バックエンドチェック
if [ "$CHECK_BACKEND" = true ]; then
    echo -e "${YELLOW}📦 バックエンド (Python)${NC}"
    echo "----------------------------------------"
    cd "$PROJECT_ROOT/backend"

    # Ruffがインストールされているか確認
    if ! command -v ruff &> /dev/null; then
        echo -e "${YELLOW}⚠️ ruff がインストールされていません。インストール中...${NC}"
        pip install ruff
    fi

    if [ "$FORMAT_ONLY" = true ]; then
        echo -e "${BLUE}▶ フォーマット実行中...${NC}"
        ruff format app/
        echo -e "${GREEN}✅ フォーマット完了${NC}"
    elif [ "$FIX_MODE" = true ]; then
        echo -e "${BLUE}▶ Lint チェック＋自動修正中...${NC}"
        ruff check app/ --fix || true
        echo -e "${BLUE}▶ フォーマット実行中...${NC}"
        ruff format app/
        echo -e "${GREEN}✅ 自動修正完了${NC}"
    else
        echo -e "${BLUE}▶ Lint チェック中...${NC}"
        if ruff check app/; then
            echo -e "${GREEN}✅ Lint チェック OK${NC}"
        else
            echo -e "${RED}❌ Lint エラーあり（--fix で自動修正可能）${NC}"
        fi
        echo -e "${BLUE}▶ フォーマットチェック中...${NC}"
        if ruff format app/ --check; then
            echo -e "${GREEN}✅ フォーマット OK${NC}"
        else
            echo -e "${RED}❌ フォーマットが必要（--fix で自動修正可能）${NC}"
        fi
    fi

    echo -e "${BLUE}▶ Python 構文チェック中...${NC}"
    if python3 -m py_compile app/config.py app/ai_pipeline/providers.py app/ai_pipeline/pipeline.py app/websocket/handler.py 2>&1; then
        echo -e "${GREEN}✅ Python 構文 OK${NC}"
    else
        echo -e "${RED}❌ Python 構文エラー${NC}"
        exit 1
    fi
    echo ""
fi

# フロントエンドチェック
if [ "$CHECK_FRONTEND" = true ]; then
    echo -e "${YELLOW}📦 フロントエンド (TypeScript)${NC}"
    echo "----------------------------------------"
    cd "$PROJECT_ROOT/frontend"

    if [ "$FORMAT_ONLY" = true ]; then
        echo -e "${BLUE}▶ ESLint --fix 実行中...${NC}"
        npm run lint -- --fix || true
        echo -e "${GREEN}✅ フォーマット完了${NC}"
    elif [ "$FIX_MODE" = true ]; then
        echo -e "${BLUE}▶ ESLint --fix 実行中...${NC}"
        npm run lint -- --fix || true
        echo -e "${GREEN}✅ 自動修正完了${NC}"
    else
        echo -e "${BLUE}▶ ESLint チェック中...${NC}"
        if npm run lint; then
            echo -e "${GREEN}✅ ESLint OK${NC}"
        else
            echo -e "${RED}❌ ESLint エラーあり（--fix で自動修正可能）${NC}"
        fi
    fi

    echo -e "${BLUE}▶ TypeScript 型チェック中...${NC}"
    if npm run type-check; then
        echo -e "${GREEN}✅ TypeScript 型チェック OK${NC}"
    else
        echo -e "${RED}❌ TypeScript 型エラー${NC}"
        exit 1
    fi
    echo ""
fi

# 完了
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  チェック完了${NC}"
echo -e "${GREEN}========================================${NC}"

