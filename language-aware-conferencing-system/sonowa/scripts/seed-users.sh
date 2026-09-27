#!/usr/bin/env bash
# ===========================================
# 初期ユーザー投入（管理者 1 名 + 一般ユーザー 1 名）
# ===========================================
# 使い方（Docker スタック起動・alembic upgrade head の後）:
#   ./scripts/seed-users.sh                   # 無ければ作成（パスワード未指定なら生成して表示）
#   ./scripts/seed-users.sh --reset-password  # 既存ユーザーのパスワードも設定し直す
# パスワード / メールを指定する場合（シェルで export するか、コマンドの前に付ける）:
#   SEED_ADMIN_PASSWORD=... SEED_USER_PASSWORD=... ./scripts/seed-users.sh
# 注意: .env は編集しない。指定した値はコンテナ内の DB にのみ保存される（ハッシュ化）。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose exec -T \
    -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD \
    -e SEED_USER_EMAIL -e SEED_USER_PASSWORD \
    backend python -m app.auth.seed_users "$@"
