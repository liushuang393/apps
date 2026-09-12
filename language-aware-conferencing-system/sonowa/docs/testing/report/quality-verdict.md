# 品質判定書

> 記入日: `2026-09-06`  
> 実行者: `Auto (Composer)`  
> 対象リビジョン: `2ca891a`（作業ツリー含む）  
> レーン: `A` + `B`（B の LiveKit フローは外部 BLOCKED）

## 1. 判定サマリ

| 項目 | 結果 | メモ |
|------|------|------|
| 総合判定 | `PASS`（管理可能失敗 0） | LiveKit 2-client と kit strict certify は外部/kit 側 BLOCKED（計画の停止条件） |
| Aレーン（モック AI E2E） | `PASS` | smoke+regression 8 passed / 1 skipped（admin env 任意）×2 連続 |
| Bレーン（実 AI 品質） | `PASS`（部分） | smoke_ai_pipeline GREEN。LiveKit 統合は外部 BLOCKED |
| testing-kit doctor / certify | `BLOCKED`（kit） | doctor: kit ratchet。certify: Spec C AI manifest パッケージ境界 |

## 2. 環境

| キー | 値 |
|------|-----|
| Frontend URL | `http://127.0.0.1:5273` |
| Backend URL | `http://127.0.0.1:8090` |
| `AI_PROVIDER`（effective） | `mock`（A）／設定スモークで一時切替後 restore |
| `SONOWA_E2E_MOCK_AI` | `1` |
| ブラウザ / Playwright | プロジェクトローカル `.scratch/ms-playwright`（chromium_headless_shell-1200 alias + ffmpeg-1011） |
| DB | SQLite `.scratch/sonowa_e2e.sqlite3`（wipe 無し運用・起動時のみ再作成） |
| Redis | `.scratch/bin/redis-server` `:6380` |

## 3. Aレーン結果（決定論・Mock AI）

| チェック | 結果 | 証跡 |
|----------|------|------|
| ログイン〜会議室入退室 | `PASS` | `a-lane-rerun-20260906T100709Z.log` / flaky-check |
| data-testid セレクタ安定 | `PASS` | AUTH/ROOM/PREF/SUBTITLE/ADMIN |
| Mock ASR/MT/TTS 単体 | `PASS` | `pytest tests/test_mock_provider.py` 7 passed |
| 失敗一覧 | なし（最終） | 初期失敗は下記分類参照 |
| flaky | `0` | 連続 2 回とも 8 passed / 1 skipped |

## 4. Bレーン結果（実 AI）

| 指標 | 目標 | 実測 | 判定 |
|------|------|------|------|
| Flow1 LiveKit 2-client | 安定合格 | Docker sock Permission denied + `:7880` 未到達 | `BLOCKED`（外部） |
| Flow2 AI pipeline smoke | GET/PUT/403/400/restore | GREEN | `PASS` |
| 端到端遅延（字幕） | ≤1200ms | 未計測（LiveKit BLOCKED） | `N/A` |
| 端到端遅延（翻訳音声） | ≤1200ms | 未計測 | `N/A` |
| 重大不具合 | 0 | 0（管理可能） | `PASS` |

証跡: `e2e-b-lane-20260906T101254Z.md`

## 5. 静的ゲート

| ゲート | 結果 |
|--------|------|
| `./scripts/check.sh --backend` | Lint OK（format は `__init__.py` / `database.py` を修正済み） |
| `./scripts/check.sh --frontend` | ESLint + tsc OK |
| Ruff `auth/routes.py` | OK |

## 6. ブロッカー / フォローアップ

- **外部 BLOCKED**: Cursor/WSL から Docker Desktop `docker.proxy.sock` へ write 不可 → LiveKit/Postgres compose 不可。PowerShell 側で `docker compose up` 後に Flow1 再実行。
- **環境**: グローバル `ms-playwright` が root 所有のため、プロジェクトローカル `PLAYWRIGHT_BROWSERS_PATH` を使用。
- **kit doctor**: kit 本体の `project root contract` ratchet が `legacy=41 > baseline=40`（`check_frontend_auth_contract.py` 追加）。Sonowa 外の kit ソース不整合。
- **kit certify-project**: `portable_preflight` が `spec_c_ai_manifest_missing`（installed-kit とソース kit の AI guidance パッケージ境界）。`ai-install` は実施済み。kit 側パッケージ修正が必要（Sonowa アプリ欠陥ではない）。
- **kit 還元**: AuthMode jwt-localstorage / doctor Docker 権限診断 / Playwright browsers path（`docs/testing/kit-improvement-backlog.md`）。

## 7. 署名

- 判定者: Auto（計画 scope 内の管理可能失敗 0 で完了）
- 承認日: 2026-09-06
