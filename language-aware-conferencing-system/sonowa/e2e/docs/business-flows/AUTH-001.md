# [AUTH-001] ユーザー登録 → メニュー表示

## メタ情報

- アプリ: sonowa
- ドメイン: AUTH
- 優先度: P1
- 種別: smoke
- 関連画面: `/register`, `/menu`
- 関連 API: `POST /api/auth/register`
- 関連権限: `user`（register 既定）
- 担当: `@e2e`
- 由来: reverse-engineering

## 前提

- seed: self（API で自己登録、共有 DB wipe なし）
- 認証: JWT を `localStorage['sonowa-auth']`（zustand persist）へ注入。bypass 禁止
- サーバ: existing-server（`http://127.0.0.1:5273` / `8090`）

## 正常系手順

1. `POST /api/auth/register` で一意 email（`E2E_RUN_ID` サフィックス）を登録する
2. 応答の `access_token` と user（snake_case → camelCase）を zustand 形で localStorage に書く
3. `/menu` を開く
4. `data-testid=menu-page`（または `.menu-page`）と rooms リンク・ログアウトが見えることを確認する

## 期待結果

- register が 200 系で token を返す
- `user.role === "user"`
- メニュー UI が表示される

## 期待 DB / API 観測

- DB: `users` に新規行（email 一意）。E2E からは直接 SELECT しない（self seed）
- API: register 応答に `access_token` / `user.display_name` 等

## 異常系 / 境界 / 権限

- `AUTH-001-E1`: 同一 email 再登録 → 4xx（本シナリオでは一意 email で回避）

## 確認事項

- [ ] auth bypass が無いこと
- [ ] 秘密（password / token）をログに出していないこと
