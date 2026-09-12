#!/usr/bin/env bash
# Docker 無しの Aレーン用ローカルスタック起動（Redis 自前ビルド + SQLite + uvicorn/Vite）
# 目的: Cursor/WSL から Docker Desktop に届かない環境でも E2E A レーンを回す。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="$ROOT/.scratch"
PID_DIR="$SCRATCH/pids"
LOG_DIR="$SCRATCH/logs"
DB_PATH="$SCRATCH/lams_e2e.sqlite3"
mkdir -p "$SCRATCH/bin" "$SCRATCH/redis" "$PID_DIR" "$LOG_DIR"

REDIS_BIN="$SCRATCH/bin/redis-server"
REDIS_CLI="$SCRATCH/bin/redis-cli"
REDIS_PORT="${REDIS_PORT:-6380}"
API_PORT="${BACKEND_PORT:-8090}"
FE_PORT="${FRONTEND_PORT:-5273}"

if [[ ! -x "$REDIS_BIN" ]]; then
  echo "[e2e-local] FAIL: $REDIS_BIN がありません。先に redis をビルドしてください。" >&2
  exit 2
fi

# Redis
if ! "$REDIS_CLI" -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
  echo "[e2e-local] starting redis :$REDIS_PORT"
  "$REDIS_BIN" \
    --port "$REDIS_PORT" \
    --daemonize yes \
    --dir "$SCRATCH/redis" \
    --dbfilename dump.rdb \
    --bind 127.0.0.1 \
    --protected-mode no
fi
"$REDIS_CLI" -p "$REDIS_PORT" ping >/dev/null

# Settings は backend の pydantic が .env を読む。bash source すると
# CORS_ORIGINS=[http://...] が非 JSON になり ValidationError になるため source しない。
export DATABASE_URL="sqlite+aiosqlite:///${DB_PATH}"
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}/0"
export LAMS_E2E_MOCK_AI="${LAMS_E2E_MOCK_AI:-1}"
export AI_PROVIDER="${AI_PROVIDER:-mock}"
export ENV="${ENV:-development}"
# LiveKit 未起動でも API/認証/ルーム作成は検証可能。トークン発行系は 503 になり得る。
export LIVEKIT_AGENT_AUTOSTART="${LIVEKIT_AGENT_AUTOSTART:-false}"
# cwd=backend だと .env 相対解決がずれることがあるため明示
export DOTENV_PATH="${DOTENV_PATH:-$ROOT/.env}"

BACKEND_PY="$ROOT/backend/.venv/bin/python"
BACKEND_UVICORN="$ROOT/backend/.venv/bin/uvicorn"
if [[ ! -x "$BACKEND_UVICORN" ]]; then
  echo "[e2e-local] FAIL: backend venv uvicorn がありません" >&2
  exit 2
fi

# 旧 sqlite を捨てて干净に
rm -f "$DB_PATH"

echo "[e2e-local] starting backend :$API_PORT (sqlite + mock AI)"
(
  cd "$ROOT"
  # config.py の env_file=".env" は cwd 相対 → リポジトリルートの .env を読む
  export PYTHONPATH="$ROOT/backend${PYTHONPATH:+:$PYTHONPATH}"
  exec "$BACKEND_UVICORN" app.main:app --host 127.0.0.1 --port "$API_PORT"
) >"$LOG_DIR/backend.log" 2>&1 &
echo $! >"$PID_DIR/backend.pid"

echo "[e2e-local] starting frontend :$FE_PORT"
(
  cd "$ROOT/frontend"
  exec npm run dev -- --host 127.0.0.1 --port "$FE_PORT"
) >"$LOG_DIR/frontend.log" 2>&1 &
echo $! >"$PID_DIR/frontend.pid"

echo "[e2e-local] waiting for health"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" != "1" ]]; then
  echo "[e2e-local] FAIL: backend health timeout. See $LOG_DIR/backend.log" >&2
  tail -50 "$LOG_DIR/backend.log" >&2 || true
  exit 3
fi

echo "[e2e-local] ready"
echo "  health: http://127.0.0.1:${API_PORT}/health"
echo "  front:  http://127.0.0.1:${FE_PORT}/"
echo "  pids:   $PID_DIR"
echo "  logs:   $LOG_DIR"
