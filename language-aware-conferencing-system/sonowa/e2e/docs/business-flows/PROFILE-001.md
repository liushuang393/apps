# [PROFILE-001] プロフィール自己更新

## メタ情報

- アプリ: sonowa
- ドメイン: AUTH
- 優先度: P1
- 種別: regression
- 関連画面: `/profile`, `/menu`
- 関連 API: `PATCH /api/auth/me`, `GET /api/auth/me`
- 関連権限: 認証済み user
- 担当: `@e2e`
- 由来: user-story

## 正常系手順

1. `/profile` で権限が「従業員」と読める
2. 表示名を保存する
3. `/menu` の名前が変わる
4. `GET /api/auth/me` の display_name が一致する

## 期待結果

- 画面と API の両方で更新が確認できる
