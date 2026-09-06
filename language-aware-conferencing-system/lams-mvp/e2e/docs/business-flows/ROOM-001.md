# [ROOM-001] ログイン後の会議室作成と一覧反映

## メタ情報

- アプリ: lams
- ドメイン: ROOM
- 優先度: P1
- 種別: smoke
- 関連画面: `/rooms`
- 関連 API: `POST /api/rooms`, `GET /api/rooms`
- 関連権限: 認証済み `user`
- 担当: `@e2e`
- 由来: reverse-engineering

## 前提

- seed: self（register → JWT 注入）
- 認証: `loginAsRole(page, "user")`
- サーバ: existing-server

## 正常系手順

1. ユーザーを register + JWT 注入する
2. `/rooms` を開き `room-list-page` を確認する
3. `room-create-open` → 名前入力 → `room-create-submit`
4. 作成成功後 `/room/:id` へ遷移し、会議室名が表示されることを確認する
5. `/rooms` に戻り、一覧に同名が表示されることを確認する
6. `GET /api/rooms` で同名 room が含まれることを二次観測する

## 期待結果

- UI 一覧に新規会議室名が出る
- API `rooms[]` に同名が存在する

## 期待 DB / API 観測

- DB: `rooms` に作成者 = 当該 user の行（直接クエリはしない）
- API: create 後の list に `name` 一致

## 異常系 / 境界 / 権限

- `ROOM-001-E1`: 未認証 create → 401（AUTH-002 でガード確認）

## 確認事項

- [ ] UI と API の二重観測があること
- [ ] 会議室名が実行ごとに一意であること
