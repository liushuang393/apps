#!/usr/bin/env bash
# =============================================================================
# start.sh - Cloud Agent 起動時にランタイムサービスを立ち上げる（毎回実行）
#   - PostgreSQL と Redis を冪等に起動する
#   - 各プロジェクトが必要とするロール／データベースを冪等に作成する
# 注意: 本スクリプトは再起動に耐え、重複起動を避け、成功したら必ず終了する。
# =============================================================================
set -euo pipefail

log() { printf '[start] %s\n' "$*"; }

# --- PostgreSQL 起動 --------------------------------------------------------
# 既に online の場合 pg_ctlcluster は非ゼロを返すため、エラーは握りつぶす。
log "PostgreSQL を起動しています..."
sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || true

# 起動完了を待機（最大 30 秒）
for _ in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p 5432 -q; then break; fi
  sleep 1
done
if ! pg_isready -h 127.0.0.1 -p 5432 -q; then
  log "ERROR: PostgreSQL が起動しませんでした"
  exit 1
fi
log "PostgreSQL は稼働中です"

# --- Redis 起動 -------------------------------------------------------------
# ping が通れば既に起動済み。通らなければデーモンとして起動する。
if redis-cli ping >/dev/null 2>&1; then
  log "Redis は既に稼働中です"
else
  log "Redis を起動しています..."
  sudo redis-server --daemonize yes --save "" >/dev/null 2>&1 || true
  for _ in $(seq 1 15); do
    if redis-cli ping >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
if ! redis-cli ping >/dev/null 2>&1; then
  log "ERROR: Redis が起動しませんでした"
  exit 1
fi
log "Redis は稼働中です"

# --- ロール・データベースの冪等作成 ----------------------------------------
# スナップショットに含まれていない場合に備え、存在しなければ作成する。
ensure_role() {
  local role="$1" password="$2"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${role}'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE ROLE ${role} WITH LOGIN PASSWORD '${password}';" >/dev/null
}
ensure_db() {
  local db="$1" owner="$2"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE DATABASE ${db} OWNER ${owner};" >/dev/null
}

log "ロール／データベースを確認しています..."
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" >/dev/null

ensure_db   forgepaybridge      postgres
ensure_db   forgepaybridge_test postgres

ensure_role triprize triprize_password
ensure_db   triprize      triprize
ensure_db   triprize_test triprize

ensure_role sonowa sonowa_secret_2024
ensure_db   sonowa sonowa

log "サービス起動完了"
