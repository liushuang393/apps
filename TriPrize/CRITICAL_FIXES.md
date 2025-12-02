# 緊急修正が必要な問題

## 🔴 即座に修正が必要

### 1. API_BASE_URLの不一致 ✅ 修正済み

**問題**: 
- モバイルアプリ: `http://localhost:3000/v1`（存在しないエンドポイント）
- バックエンド: `/api/campaigns`など（`/v1`ではない）

**修正**: `mobile/.env.example`を`http://localhost:3000`に変更

---

### 2. Firebase設定の確認が必要

**モバイルアプリ**: `product-triprizeweb-dev`
**バックエンド**: `.env`ファイルで設定が必要

**確認事項**:
1. `api/.env`ファイルに`FIREBASE_PROJECT_ID=product-triprizeweb-dev`が設定されているか
2. `FIREBASE_PRIVATE_KEY`が正しく設定されているか（`\n`が含まれているか）
3. `FIREBASE_CLIENT_EMAIL`が正しく設定されているか

**修正手順**:
```bash
# api/.envファイルを確認
cd api
cat .env | grep FIREBASE
```

---

### 3. モバイルアプリのAPI接続設定

**問題**: 
- デフォルト値が`http://localhost:3000`だが、実機/エミュレータからはアクセスできない

**修正**: 
- Androidエミュレータ: `http://10.0.2.2:3000`
- iOSシミュレータ: `http://localhost:3000`
- 実機: `http://<PCのIPアドレス>:3000`

**推奨**: 環境変数で設定可能にする

---

### 4. CORS設定の改善

**現在の設定**:
```typescript
if (origin.match(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
  return callback(null, true);
}
```

**問題**: 
- `https://`が許可されていない
- 本番環境で問題になる可能性

**修正**: 
```typescript
if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
  return callback(null, true);
}
```

---

### 5. 環境変数のドキュメント不足

**問題**: 
- `.env.example`の説明が不足
- 実際の設定値との対応が不明

**推奨**: 
- `docs/ENVIRONMENT_SETUP.md`を更新
- 各環境変数の説明を追加

---

## 📋 確認チェックリスト

### バックエンド
- [ ] `api/.env`ファイルが存在する
- [ ] `FIREBASE_PROJECT_ID`が`product-triprizeweb-dev`に設定されている
- [ ] `FIREBASE_PRIVATE_KEY`が正しく設定されている（`\n`が含まれている）
- [ ] `FIREBASE_CLIENT_EMAIL`が正しく設定されている
- [ ] `DATABASE_URL`が正しく設定されている
- [ ] `USE_MOCK_AUTH`が設定されている（開発環境の場合）

### モバイルアプリ
- [ ] `mobile/.env`ファイルが存在する
- [ ] `API_BASE_URL`が正しく設定されている
- [ ] Firebase設定が正しく読み込まれている
- [ ] Stripe設定が正しく読み込まれている（支払い機能を使用する場合）

### データベース
- [ ] PostgreSQLが起動している
- [ ] `auto_draw`カラムが`campaigns`テーブルに存在する
- [ ] マイグレーションが実行されている

---

## 🚀 次のステップ

1. **環境変数の確認**
   ```bash
   # バックエンド
   cd api
   cat .env
   
   # モバイルアプリ
   cd mobile
   cat .env
   ```

2. **Firebase設定の確認**
   ```bash
   # バックエンドのFirebase設定を確認
   cd api
   node -e "require('dotenv').config(); console.log('Project ID:', process.env.FIREBASE_PROJECT_ID)"
   ```

3. **API接続テスト**
   ```bash
   # バックエンドが起動しているか確認
   curl http://localhost:3000/health
   ```

4. **モバイルアプリの接続テスト**
   - エミュレータ/シミュレータで起動
   - ログでAPI接続エラーを確認
