# [TRANSCRIPT-001] 議事録と離線再処理の権限

## メタ情報

- アプリ: sonowa
- ドメイン: TRANSCRIPT
- 優先度: P1
- 種別: regression
- 関連画面: `/room/:id/transcript`
- 関連 API: `GET /api/rooms/{id}/minutes`, `POST /api/admin/sessions/{id}/rerun`
- 関連権限: 議事録は認証ユーザー。再処理ボタンは admin のみ
- 担当: `@e2e`
- 由来: user-story

## 正常系手順

1. 空の会議室の会議記録を開く
2. 従業員は「議事録を生成」だけ見え、空記録の理由が出る
3. 離線再処理 API は 403 系
4. 管理者は再処理ボタンが見える（セッション無しなら disabled）

## 期待結果

- ボタン制限がロールで分かれる
- 空記録は例外メッセージになる
