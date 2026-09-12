# [AUTH-003] 未認証の新規画面ガード

## メタ情報

- アプリ: sonowa
- ドメイン: AUTH
- 優先度: P1
- 種別: smoke
- 関連画面: `/profile`, `/history`, `/admin/glossary`
- 関連 API: なし（PrivateRoute）
- 関連権限: 未認証
- 担当: `@e2e`
- 由来: user-story

## 前提

- localStorage の `sonowa-auth` を消す

## 正常系手順

1. `/profile` `/history` `/admin/glossary` を順に開く
2. いずれも `/login` へ戻り、メール入力が見える

## 期待結果

- 未認証では新規画面に入れない
