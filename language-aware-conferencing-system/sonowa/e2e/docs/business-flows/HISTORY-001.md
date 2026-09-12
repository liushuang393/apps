# [HISTORY-001] 利用履歴は参加記録のみ

## メタ情報

- アプリ: sonowa
- ドメイン: AUTH
- 優先度: P2
- 種別: regression
- 関連画面: `/history`
- 関連 API: `POST /api/rooms`, `GET /api/auth/history`
- 関連権限: 認証済み user
- 担当: `@e2e`
- 由来: user-story

## 正常系手順

1. 会議室を API 作成する（LiveKit 参加なし）
2. `/history` は空状態
3. `GET /api/auth/history` にもその部屋が無い

## 期待結果

- 作成だけでは participant が無いので履歴に出ない
