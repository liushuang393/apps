# ⚠️ src/ は本番未使用（NON-PRODUCTION / reference only）

このディレクトリ（`src/**` の TypeScript コア: `core/`, `audio/`, `config/`, `adapters/` など）は
**実行中のアプリには読み込まれていません**。編集してもアプリの挙動は変わりません。

## 実際に動いているコード（単一の真実 / single source of truth）

ブラウザ・Chrome 拡張・**Electron デスクトップのレンダラ**は、いずれも
ルート直下の **`voicetranslate-*.js`** を `teams-realtime-translator.html` 経由で実行します。

- Electron も `electron/main.ts` が `teams-realtime-translator.html` を `loadFile` する（＝ルート JS が動く）
- `src/**` を import しているのは `src/` 自身と `tests/` だけ（アプリのエントリからは未参照）

```
実行時の挙動を直す     → ルートの voicetranslate-*.js を編集
システム音声/IPC/履歴  → electron/**（main プロセス、本番）
拡張のパッケージング   → browser-extension/src/**
決済(ForgePay)         → api/*.js（Vercel サーバレス）
```

## なぜこの注意書きがあるか

`src/**` は型付きの並行再実装（reference/experimental）で、過去の GA 移行時に
`modalities` → `output_modalities` の修正が `src/`・probe には入ったのにルート JS に
入らず、目標言語切替がエラーになる**重大バグ**を生みました（「一箇所直して三箇所漏れる」）。

**ランタイムの修正は必ずルートの `voicetranslate-*.js` に入れてください。**

`src/**` には単体テストと `npm run quality` ゲートが残っているため削除はしていません。
この参照ツリーを意図的に復活・保守する場合のみ編集してください。
