# 実行計画

1. `npm i -D vitest`（package-lock 更新）、`"test": "vitest run"` 追加。vite.config.ts の test 設定は必要最小限。
2. `src/api/__tests__/client.test.ts` に特性テスト（R2）。`import from '../client'` 経由でテストし、分割後も無変更で通るようにする。
3. `npm test` GREEN を確認（AC1）。
4. 分割（R3/R4）。循環 import を作らない（http.ts は他モジュールに依存しない）。
5. `npm test && npm run type-check && npm run lint && npm run build`（AC2/AC3）。
6. `wc -l src/api/*.ts`、`git diff --stat -- src ':!src/api'`（AC4/AC5）。

## ロールバック点

- 分割で失敗したら `git checkout -- src/api/client.ts` し新規モジュールを削除、テストのみ残す。
