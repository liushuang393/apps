# 実行計画

1. `.testing-kit/AI-INSTRUCTIONS.md` と既存 `e2e/regression/*.spec.ts`・`e2e/helpers/*` の規約を確認（シナリオ ID、`loginAs` / `registerPromotedAdmin` / `createRoom`、data-testid 方式）。
2. RED: NAV-004 の ai-pipeline ケースを先に書き、現行ビルドで固着（失敗）することを確認。
3. R1/R2 修正（全データ画面の失敗時表示・再試行）。R3 の i18n と warnings 翻訳・ずれ検出テスト拡張。
4. NAV-001〜005 を実装。ページ毎の期待 testid とデータ準備は helper を再利用。フレークを避けるため固定 sleep ではなく状態待ち。
5. `cd frontend && npm test && npm run type-check && npm run lint && npm run build`、`./scripts/check.sh`。
6. trellis-check による独立レビュー。
7. 本番構成へ発布（`INSTALL_LOCAL=1 ./scripts/start-docker.sh --build` → alembic）し、smoke + regression（NAV 含む）+ meeting を実行。英語 UI のスクショ確認。
8. コミット・push、報告。
