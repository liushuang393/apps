# [ADMIN-001] AI パイプライン設定の権限境界

## メタ情報

- アプリ: sonowa
- ドメイン: ADMIN
- 優先度: P1
- 種別: regression
- 関連画面: `/admin/ai-pipeline`（本シナリオは API 中心）
- 関連 API: `GET/PUT /api/admin/settings/ai-pipeline`
- 関連権限: PUT は `admin` のみ / GET は認証ユーザー可
- 担当: `@e2e`
- 由来: reverse-engineering

## 前提

- seed: self（通常ユーザーは register）
- admin: `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`、または Docker postgres で昇格して再ログイン
- 認証: JWT Bearer（bypass 禁止）
- register は常に `role=user`（admin 昇格は DB 手動 or 既存アカウント）

## 正常系手順

1. 通常ユーザーで JWT 取得
2. `PUT /api/admin/settings/ai-pipeline`（例: `{ "default_mode": "hybrid" }`）
3. 応答が 403 であることを確認
4. （任意）admin 資格があれば `GET /api/admin/settings/ai-pipeline` → 200

## 期待結果

- 非 admin PUT → 403
- admin GET → 200 かつ JSON ボディあり

## 期待 DB / API 観測

- DB: 非 admin PUT では `system_config`（ai_pipeline）が変わらない
- API: 403 / 200 のステータス観測（秘密フィールドはログ禁止）

## 異常系 / 境界 / 権限

- `ADMIN-001-E1`: 未認証 PUT → 401
- `ADMIN-001-E2`: 昇格後は再ログインしないと JWT の role が古いまま

## 確認事項

- [ ] 非 admin の更新が拒否されること
- [ ] トークンをレポートに載せていないこと
