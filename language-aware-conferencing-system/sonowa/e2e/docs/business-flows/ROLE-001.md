# [ROLE-001] ログイン後の従業員権限表示

## メタ情報

- アプリ: sonowa
- ドメイン: AUTH
- 優先度: P1
- 種別: smoke
- 関連画面: `/menu`, `/admin`, `/admin/glossary`
- 関連 API: `GET /api/auth/me`, `GET /api/admin/users`
- 関連権限: `user`（従業員）
- 担当: `@e2e`
- 由来: user-story

## 前提

- seed: self（register は常に role=user）
- 認証: JWT を `sonowa-auth` へ注入。bypass 禁止

## 正常系手順

1. ユーザー登録して `/menu` を開く
2. `menu-user-role` が `data-role=user` かつ「従業員」である
3. 管理者メニュー項目が出ない
4. `/admin` と `/admin/glossary` は `/menu` へ戻る
5. `GET /api/auth/me` の role が `user`
6. `GET /api/admin/users` が 403

## 期待結果

- ログイン後に権限が従業員として見える
- 管理者画面・API は拒否される

## 異常系 / 境界 / 権限

- `ROLE-001-E1`: 未認証は AUTH-003
