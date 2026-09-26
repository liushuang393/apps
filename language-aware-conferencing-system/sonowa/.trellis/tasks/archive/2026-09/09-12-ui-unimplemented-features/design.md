# 画面未実装機能 — 技術設計

## 境界

変更するのは認証自己更新・参加履歴 API と、既存 minutes / glossary / rerun / admin user のフロント接続のみ。新規テーブル・新規プロバイダは作らない。

## 契約

### PATCH /api/auth/me

- 入力: `display_name` / `native_language`（いずれも任意。少なくとも一方必須）
- `native_language` は `ALL_SUPPORTED_LANGUAGES` に属する
- 出力: login と同じ `AuthResponse`（トークン再発行）。JWT の `native_language` を更新後の値にする

### GET /api/auth/history

- `participant` を `user_id` で絞り `Room` を join
- 返却: `room_id`, `room_name`, `is_private`, `joined_at`, `updated_at`
- `(room_id, user_id)` 一意のため 1 部屋 1 行。`updated_at` 降順

### 既存 API（フロントのみ）

- `GET /api/rooms/{id}/minutes?lang=&session_id=`
- `/api/glossaries/terms` CRUD（admin）
- `POST /api/admin/sessions/{session_id}/rerun`（admin、本地モデル無しは 503）
- `PATCH /api/admin/users/{id}` の `native_language`（クライアントは既に送信可能）

## フロント画面

| ルート | 権限 | 備考 |
|---|---|---|
| `/profile` | 認証 | 表示名・母語。言語は有効言語一覧 |
| `/history` | 認証 | 行クリックで `/room/:id/transcript` |
| `/admin/glossary` | admin | 表＋作成/編集モーダル。`tenant_id` 非表示 |
| Transcript 追記 | 認証 / admin | 議事録パネル。rerun は admin かつ session 選択時 |

メニューからプロフィール・履歴の `badgeKey` を外す。用語集項目を管理者カテゴリに追加。方式2説明から `/admin/glossary` へリンク。

## 互換

- JWT 再発行後は `authStore.setAuth` で token と user を同時置換する
- `apiFetch` は glossary DELETE の 204 を空成功として扱う
- 議事録・rerun の 503 は機能未接続ではなく、依存未設定の明示エラー

## ロールバック

追加エンドポイントと新規ページを戻せばよい。既存 minutes / glossary / rerun 実装は変更しない。
