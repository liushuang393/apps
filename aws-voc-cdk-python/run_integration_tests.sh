#!/bin/bash
# 目的: 統合テストを実行するスクリプト
# 使用方法: ./run_integration_tests.sh [options]

set -e

# 色の定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ロゴ表示
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                                                           ║"
echo "║        AWS VOC CDK - Integration Test Runner             ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# デフォルト設定
VERBOSE=false
REPORT=false
SPECIFIC_TEST=""
CLEANUP=true

# ヘルプメッセージ
show_help() {
    echo "使用方法: $0 [options]"
    echo ""
    echo "オプション:"
    echo "  -h, --help              このヘルプメッセージを表示"
    echo "  -v, --verbose           詳細ログを表示"
    echo "  -r, --report            HTMLレポートを生成"
    echo "  -t, --test TEST_NAME    特定のテストのみ実行"
    echo "  --no-cleanup            テスト後のクリーンアップをスキップ"
    echo ""
    echo "例:"
    echo "  $0                      # すべての統合テストを実行"
    echo "  $0 -v -r                # 詳細ログとHTMLレポート付きで実行"
    echo "  $0 -t test_s3_buckets_exist  # 特定のテストのみ実行"
}

# 引数解析
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -r|--report)
            REPORT=true
            shift
            ;;
        -t|--test)
            SPECIFIC_TEST="$2"
            shift 2
            ;;
        --no-cleanup)
            CLEANUP=false
            shift
            ;;
        *)
            echo -e "${RED}エラー: 不明なオプション: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# 前提条件チェック
echo -e "${YELLOW}[1/5] 前提条件をチェック中...${NC}"

# Python環境チェック
if ! command -v python &> /dev/null; then
    echo -e "${RED}エラー: Pythonがインストールされていません${NC}"
    exit 1
fi

# AWS CLIチェック
if ! command -v aws &> /dev/null; then
    echo -e "${RED}エラー: AWS CLIがインストールされていません${NC}"
    exit 1
fi

# AWS認証情報チェック
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}エラー: AWS認証情報が設定されていません${NC}"
    echo "以下のコマンドで設定してください:"
    echo "  aws configure"
    exit 1
fi

echo -e "${GREEN}✓ 前提条件OK${NC}"

# 依存関係インストール
echo -e "${YELLOW}[2/5] 依存関係をインストール中...${NC}"
pip install -q -r requirements-dev.txt
echo -e "${GREEN}✓ 依存関係インストール完了${NC}"

# AWS環境確認
echo -e "${YELLOW}[3/5] AWS環境を確認中...${NC}"

# 設定ファイル読み込み
if [ ! -f "config/config.yaml" ]; then
    echo -e "${RED}エラー: config/config.yaml が見つかりません${NC}"
    exit 1
fi

# プレフィックスとリージョンを取得
PREFIX=$(python -c "import yaml; print(yaml.safe_load(open('config/config.yaml'))['project']['prefix'])")
REGION=$(python -c "import yaml; print(yaml.safe_load(open('config/config.yaml'))['project']['region'])")

echo "  プレフィックス: $PREFIX"
echo "  リージョン: $REGION"

# S3バケット確認
BUCKET_COUNT=$(aws s3 ls | grep -c "$PREFIX" || true)
if [ "$BUCKET_COUNT" -eq 0 ]; then
    echo -e "${RED}エラー: S3バケットが見つかりません${NC}"
    echo "以下のコマンドでデプロイしてください:"
    echo "  cdk deploy --all"
    exit 1
fi

echo -e "${GREEN}✓ AWS環境OK (S3バケット: ${BUCKET_COUNT}個)${NC}"

# テスト実行前のクリーンアップ
if [ "$CLEANUP" = true ]; then
    echo -e "${YELLOW}[4/5] テスト前のクリーンアップ中...${NC}"
    
    # 古いテストファイルを削除
    aws s3 rm "s3://${PREFIX}-raw-apne1/inbox/" --recursive --exclude "*" --include "test_*" --quiet || true
    
    echo -e "${GREEN}✓ クリーンアップ完了${NC}"
else
    echo -e "${YELLOW}[4/5] クリーンアップをスキップ${NC}"
fi

# テスト実行
echo -e "${YELLOW}[5/5] 統合テストを実行中...${NC}"
echo ""

# pytestコマンド構築
PYTEST_CMD="pytest tests/integration/"

if [ -n "$SPECIFIC_TEST" ]; then
    PYTEST_CMD="$PYTEST_CMD::$SPECIFIC_TEST"
fi

PYTEST_CMD="$PYTEST_CMD -m integration"

if [ "$VERBOSE" = true ]; then
    PYTEST_CMD="$PYTEST_CMD -v -s"
else
    PYTEST_CMD="$PYTEST_CMD -v"
fi

if [ "$REPORT" = true ]; then
    PYTEST_CMD="$PYTEST_CMD --html=integration_report.html --self-contained-html"
fi

# テスト実行
echo "実行コマンド: $PYTEST_CMD"
echo ""

if $PYTEST_CMD; then
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                           ║${NC}"
    echo -e "${GREEN}║              ✓ すべてのテストが成功しました！              ║${NC}"
    echo -e "${GREEN}║                                                           ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    
    if [ "$REPORT" = true ]; then
        echo ""
        echo -e "${BLUE}HTMLレポートが生成されました: integration_report.html${NC}"
    fi
    
    exit 0
else
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                                                           ║${NC}"
    echo -e "${RED}║              ✗ テストが失敗しました                        ║${NC}"
    echo -e "${RED}║                                                           ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
    
    echo ""
    echo -e "${YELLOW}トラブルシューティング:${NC}"
    echo "  1. TROUBLESHOOTING.md を参照"
    echo "  2. CloudWatch Logsを確認"
    echo "  3. Step Functions実行履歴を確認"
    echo ""
    echo -e "${YELLOW}詳細ログを表示:${NC}"
    echo "  $0 -v"
    
    exit 1
fi

