<!-- sr-local -->
# Python（backend/）

このリポジトリ固有のことだけ。言語一般のベストプラクティスは書かない。

- 作業ディレクトリは `backend/`。テストは `pytest` / `pytest tests/test_….py`。
- 型ヒント必須。ログは `logging`。`print` 禁止。
- 設定の正本は `app/config.py`。秘密は環境変数 / `.env`（エージェントは `.env` を編集しない）。
- DB 変更は Alembic。コンテナ内: `docker compose exec backend alembic upgrade head`。
- 品質ゲートの人間向け入口はリポジトリルートの `./scripts/check.sh --backend`。
- Ruff 対象は `app/`（`E,W,F,I,B,C4,UP,ARG,SIM`）。行長 88。
