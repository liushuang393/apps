# [GLOSSARY-001] 用語集の権限と作成

## メタ情報

- アプリ: sonowa
- ドメイン: ADMIN
- 優先度: P1
- 種別: regression
- 関連画面: `/admin/glossary`
- 関連 API: `GET/POST/DELETE /api/glossaries/terms`
- 関連権限: CRUD は admin。user は 403
- 担当: `@e2e`
- 由来: user-story

## 前提

- admin は env または Docker 昇格
- 訳語が空のときは保存ボタン disabled

## 正常系手順

1. 従業員 JWT で用語一覧 → 403
2. 管理者で画面から用語を作成する
3. API 一覧に同じ source_term がある
4. API で削除して後始末する

## 期待結果

- 従業員は作成も一覧もできない
- 管理者は UI と API の両方で作成を観測できる
