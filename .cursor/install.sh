#!/usr/bin/env bash
# =============================================================================
# install.sh - リポジトリ依存関係のセットアップ（ビルド時に一度だけ実行）
#   - 各 Node/Python プロジェクトの依存関係をインストールする
#   - 開発用 .env（ダミー資格情報のみ）を存在しなければ生成する
#   - PostgreSQL を起動し、DB マイグレーションを適用する
# 注意: 冪等かつ非対話的に動作し、必ず終了する。実行中のサーバーは起動しない。
# システムパッケージ（maven / postgresql / redis / build-essential）は
# ベーススナップショットに含まれる前提。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log() { printf '\n[install] === %s ===\n' "$*"; }

# 呼び出し元シェルから継承したアプリ固有の環境変数を解除する。
# 各プロジェクトは dotenv で自身の .env を読み込むが、dotenv は既存の
# 環境変数を上書きしないため、継承値が残ると誤った DB へ接続してしまう。
unset DATABASE_URL REDIS_URL JWT_SECRET AI_PROVIDER SONOWA_E2E_MOCK_AI \
      LIVEKIT_API_KEY LIVEKIT_API_SECRET || true

# ---------------------------------------------------------------------------
# 1) Node プロジェクトの依存関係
# ---------------------------------------------------------------------------
npm_install() {
  local dir="$1"
  if [ -f "$dir/package.json" ]; then
    log "npm install: ${dir#$ROOT/}"
    ( cd "$dir" && npm install --no-audit --no-fund )
  fi
}
npm_install "$ROOT/ForgePay"
npm_install "$ROOT/ForgePay/dashboard"
npm_install "$ROOT/TriPrize/api"
npm_install "$ROOT/simultaneous_interpretation"
npm_install "$ROOT/language-aware-conferencing-system/sonowa/frontend"

# ---------------------------------------------------------------------------
# 2) Python プロジェクトの仮想環境
# ---------------------------------------------------------------------------
# gcal_twilio_reminder
log "Python venv: gcal_twilio_reminder"
python3 -m venv "$ROOT/gcal_twilio_reminder/.venv"
"$ROOT/gcal_twilio_reminder/.venv/bin/pip" install -q --upgrade pip
"$ROOT/gcal_twilio_reminder/.venv/bin/pip" install -q -r "$ROOT/gcal_twilio_reminder/requirements.txt"

# aws-voc-cdk-python（Lambda バンドルの依存も含める）
log "Python venv: aws-voc-cdk-python"
python3 -m venv "$ROOT/aws-voc-cdk-python/.venv"
"$ROOT/aws-voc-cdk-python/.venv/bin/pip" install -q --upgrade pip
"$ROOT/aws-voc-cdk-python/.venv/bin/pip" install -q \
  -r "$ROOT/aws-voc-cdk-python/requirements.txt" \
  -r "$ROOT/aws-voc-cdk-python/requirements-dev.txt"
# Lambda ハンドラのユニットテストが必要とする依存
while IFS= read -r req; do
  "$ROOT/aws-voc-cdk-python/.venv/bin/pip" install -q -r "$req"
done < <(find "$ROOT/aws-voc-cdk-python/lambda" -name requirements.txt)

# sonowa backend（FastAPI）
log "Python venv: sonowa backend"
python3 -m venv "$ROOT/language-aware-conferencing-system/sonowa/backend/.venv"
SONOWA_PIP="$ROOT/language-aware-conferencing-system/sonowa/backend/.venv/bin/pip"
"$SONOWA_PIP" install -q --upgrade pip
( cd "$ROOT/language-aware-conferencing-system/sonowa/backend" && "$SONOWA_PIP" install -q -e ".[dev]" )
# pytest 一式と SQLite 非同期ドライバ（テストが利用）は明示的に導入
"$SONOWA_PIP" install -q pytest pytest-asyncio aiosqlite

# ---------------------------------------------------------------------------
# 3) 開発用 .env の生成（存在しない場合のみ・ダミー資格情報）
# ---------------------------------------------------------------------------
if [ ! -f "$ROOT/ForgePay/.env" ]; then
  log "ForgePay/.env を生成"
  cat > "$ROOT/ForgePay/.env" <<'EOF'
NODE_ENV=development
PORT=3000
API_BASE_URL=http://localhost:3000
STRIPE_MODE=test
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forgepaybridge
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
REDIS_URL=redis://localhost:6379
STRIPE_TEST_SECRET_KEY=sk_test_placeholder
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_placeholder
STRIPE_TEST_WEBHOOK_SECRET=whsec_placeholder
JWT_SECRET=dev-secret-key-change-me
JWT_EXPIRES_IN=5m
LOG_LEVEL=info
LOG_FORMAT=json
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
EOF
fi

if [ ! -f "$ROOT/TriPrize/api/.env" ]; then
  log "TriPrize/api/.env を生成"
  cat > "$ROOT/TriPrize/api/.env" <<'EOF'
NODE_ENV=development
PORT=3100
API_BASE_URL=http://localhost:3100
DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_SSL=false
REDIS_URL=redis://localhost:6379
REDIS_CACHE_TTL=3600
USE_MOCK_AUTH=true
USE_MOCK_PAYMENT=true
STRIPE_SECRET_KEY=sk_test_dummy
STRIPE_PUBLISHABLE_KEY=pk_test_dummy
STRIPE_WEBHOOK_SECRET=whsec_dummy
JWT_SECRET=dev_jwt_secret_at_least_32_characters_long_xxx
JWT_EXPIRES_IN=7d
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF
fi

# ---------------------------------------------------------------------------
# 4) DB を起動してマイグレーションを適用
# ---------------------------------------------------------------------------
log "PostgreSQL/Redis を起動しロール・DB を用意"
bash "$ROOT/.cursor/start.sh"

log "ForgePay DB マイグレーション"
( cd "$ROOT/ForgePay" \
  && npm run migrate:up \
  && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forgepaybridge_test npm run migrate:up )

log "TriPrize DB マイグレーション"
# TriPrize のテストは開発 DB を利用するとトラッキングテーブルを破壊し得るため、
# 冪等性を保証すべく triprize 開発 DB のスキーマをクリーンに初期化してから適用する。
sudo -u postgres psql -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='triprize' AND pid<>pg_backend_pid();" \
  >/dev/null 2>&1 || true
sudo -u postgres psql -d triprize -c \
  "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO triprize; GRANT ALL ON SCHEMA public TO public;" \
  >/dev/null
( cd "$ROOT/TriPrize/api" \
  && DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize npm run migrate )

log "sonowa DB マイグレーション"
( cd "$ROOT/language-aware-conferencing-system/sonowa/backend" \
  && DATABASE_URL='postgresql+asyncpg://sonowa:sonowa_secret_2024@localhost:5432/sonowa' \
     ./.venv/bin/alembic upgrade head )

log "インストール完了"
