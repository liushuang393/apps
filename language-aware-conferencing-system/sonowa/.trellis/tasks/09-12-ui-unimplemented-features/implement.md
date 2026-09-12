# 画面未実装機能 — 実行計画

## チェックリスト

1. `PATCH /api/auth/me` と `GET /api/auth/history` を `backend/app/auth/routes.py` に追加
2. `backend/tests/test_auth_profile.py` / `test_auth_history.py`（未認証は Depends 前提なので関数直呼び。履歴は他ユーザー非混入、プロフィールは JWT 再発行）
3. `authApi.updateMe` / `authApi.getHistory` / `roomApi.getMinutes` / `glossaryApi` / `adminApi.rerunSession`
4. ProfilePage / HistoryPage / ルート / メニュー準備中解除 / i18n 4 言語
5. Transcript 議事録パネル、Admin 母語セレクト
6. GlossaryPage、メニューと方式2からの導線
7. Transcript 管理者 rerun（503 表示）
8. `./scripts/check.sh` とブラウザ確認

## 検証

```bash
cd backend && pytest tests/test_auth_profile.py tests/test_auth_history.py
./scripts/check.sh
```

ブラウザ: メニュー→プロフィール保存→履歴→記録の議事録、管理者の母語／用語集 CRUD、rerun の 503 または集計。

## ロールバック点

- 認証ルート追加後: テスト失敗なら当該エンドポイントのみ戻す
- フロント接続後: 新規ページとルートを外し、メニュー badge を戻せば Coming Soon に戻る
