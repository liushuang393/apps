# 実行計画

1. RED: `src/api/__tests__/apiErrorText.test.ts` — 完全一致・補間・未知・非文字列、英語切替で英訳、backend detail 網羅（R3）。失敗を確認。
2. `apiErrorText.ts` 実装、`http.ts` 接続。locale 4 言語に `apiError.*` 追加。GREEN。
3. hooks 3 ファイルを `i18n.t` に置換、`errors.*` 4 言語追加。locales.test.ts が通ること。
4. `npm test && npm run type-check && npm run lint && npm run build`、`./scripts/check.sh`。
5. trellis-check による独立レビュー。
6. Docker 発布: `docker compose up -d --build` → `docker compose exec backend alembic upgrade head` → `docker compose ps` / `curl /health`。
7. 実スタック E2E: `npx playwright test --config e2e/playwright.config.ts --project=smoke --project=regression`。
8. 英語 UI 実確認: Playwright スクリプトで `i18nextLng=en`、誤パスワードログイン（401）・存在しない会議室（404）・会議記録等を開きスクショ、エラー文言が英語であることとコントラストを確認。
9. コミット、アーカイブ。

## ロールバック点

- 手順 2 後に既存テストが崩れたら http.ts 接続を外す。
- Docker 発布で失敗したら `docker compose logs <svc>` で原因を特定。コード起因なら修正、環境起因なら記録して報告。
