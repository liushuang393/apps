# [ADMIN-002] 管理者権限表示と管理画面

## メタ情報

- アプリ: sonowa
- ドメイン: ADMIN
- 優先度: P1
- 種別: regression
- 関連画面: `/menu`, `/admin`, `/admin/languages`, `/admin/ai-pipeline`, `/admin/experiments`, `/admin/glossary`
- 関連 API: `/api/admin/users`, `/api/admin/settings/languages`, `/api/admin/settings/ai-pipeline`, `/api/glossaries/terms`
- 関連権限: `admin`（管理者）
- 担当: `@e2e`
- 由来: user-story

## 前提

- seed: self。admin は `E2E_ADMIN_*` または Docker postgres で昇格して再ログイン
- 認証: JWT Bearer。昇格後は再ログイン必須（JWT に古い role が残る）

## 正常系手順

1. 従業員ユーザーを 1 人登録する
2. 管理者で `/menu` を開き「管理者」バッジと管理メニューを確認する
3. `/admin` で母語セレクト付きユーザー編集モーダルを開く
4. 言語 / AI pipeline / 実験 / 用語集の各画面を開く
5. 対応 API が 200 であることを二次観測する

## 期待結果

- ログイン後に権限が管理者として見える
- 管理画面が開ける。従業員は ROLE-001 で拒否済み

## 異常系 / 境界 / 権限

- `ADMIN-002-E1`: 自己編集ボタンは disabled（既存 UI）
