<!-- sr-local -->
# TypeScript / React（frontend/）

このリポジトリ固有のことだけ。言語一般のベストプラクティスは書かない。

- `strict: true`。`any` 禁止（`unknown`）。`@ts-ignore` / `@ts-expect-error` 禁止。
- 関数コンポーネント + カスタムフック。Props は `interface`。
- 状態: Zustand（`authStore`, `roomStore`）。ブラウザは frontend のみ。API は `/api` プロキシ。
- `console.log` 禁止。品質ゲート: `npm run lint` と `npm run type-check`（root からは
  `./scripts/check.sh --frontend`）。
- フロント単体テストスクリプトは `package.json` に無い。無いものを発明しない。
