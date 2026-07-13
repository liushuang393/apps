---
name: agent-ui-test
description: >-
  Electron / Chrome拡張 / HTML の同時通訳アプリを Playwright MCP で自動操作・検証する。
  バグ調査、UI回帰、画面操作、自己テスト、agent:electron、agent:extension のときに使う。
---

# エージェント UI 自動テスト

## Electron

```bash
npm run agent:electron
```

CDP `http://127.0.0.1:9222` → MCP `playwright-electron`

## Chrome 拡張

```bash
npm run agent:extension
```

CDP `http://127.0.0.1:9223` → MCP `playwright-extension`

## HTML

Playwright MCP で `file:///.../teams-realtime-translator.html`

## 原則

ユーザーに手動テストや現象説明を求めず、先に snapshot / console を取る。
