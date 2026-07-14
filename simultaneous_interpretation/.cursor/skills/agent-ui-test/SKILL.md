---
name: agent-ui-test
description: >-
  Electron / Chrome拡張 / HTML の同時通訳アプリを Playwright MCP で自動操作・検証する。
  バグ調査、UI回帰、画面操作、自己テスト、agent:electron、agent:extension のときに使う。
---

# エージェント UI 自動テスト

## 起動の使い分け（重要）

| 目的 | 起動方法 | 備考 |
|------|----------|------|
| **通常のローカルアプリ起動**（人が使う／実機確認の既定） | ルートの [`start-local.bat`](../../start-local.bat) | ダブルクリック可。`build:electron` → `electron:run` |
| **エージェントが画面を自動操作するときだけ** | `npm run agent:electron` | CDP `9222` 付き。Playwright MCP 用 |

ユーザーが「アプリを起動して」「ローカルで動かして」と言ったら、まず **`start-local.bat`**。  
CDP／snapshot／click が必要なときだけ `agent:electron` に切り替える。

## Electron（CDP 自動操作）

```bash
npm run agent:electron
```

CDP `http://127.0.0.1:9222` → MCP `playwright-electron`  
（MCP は Electron より後に接続すること。先に MCP だけ起動すると about:blank になる）

## Chrome 拡張

```bash
npm run agent:extension
```

CDP `http://127.0.0.1:9223` → MCP `playwright-extension`

## HTML

Playwright MCP で `file:///.../teams-realtime-translator.html`

## 原則

ユーザーに手動テストや現象説明を求めず、先に snapshot / console を取る。
