# 🚀 TriPrize 本番環境リリースガイド

**最終更新**: 2024-12-24
**バージョン**: 1.0.0
**対象読者**: 技術者・非技術者

---

## 📋 目次

1. [機能検証結果](#-機能検証結果)
2. [上線前に準備するもの](#-上線前に準備するもの)
3. [Step 1: Firebase の設定](#step-1-firebase-の設定)
4. [Step 2: Stripe の設定](#step-2-stripe-の設定)
5. [Step 3: サーバー環境変数の設定](#step-3-サーバー環境変数の設定)
6. [Step 4: フロントエンドの設定](#step-4-フロントエンドの設定)
7. [Step 5: デプロイ実行](#step-5-デプロイ実行)
8. [Step 6: 動作確認](#step-6-動作確認)
9. [トラブルシューティング](#-トラブルシューティング)
10. [緊急時のロールバック](#-緊急時のロールバック)

---

## ✅ 機能検証結果

| テスト項目 | 状態 | 説明 |
|---------|------|------|
| 基盤インフラ | ✅ | API・DB・Redis 正常 |
| 管理者機能 | ✅ | 登録・ログイン・キャンペーン作成 |
| 顧客機能 | ✅ | 登録・ログイン・閲覧・購入 |
| 決済処理 | ✅ | クレジットカード・コンビニ対応 |
| 抽選システム | ✅ | ランダム抽選・当選通知 |
| 配送先住所 | ✅ | 住所登録・編集機能 |

**結論**: ✅ システム全機能正常動作確認済み

---

## 📦 上線前に準備するもの

上線作業を始める前に、以下のものを準備してください：

### 必要なアカウント・情報

| 項目 | 説明 | 入手先 |
|------|------|--------|
| **Firebase プロジェクト** | ユーザー認証用 | [Firebase Console](https://console.firebase.google.com/) |
| **Stripe アカウント** | 決済処理用 | [Stripe Dashboard](https://dashboard.stripe.com/) |
| **本番サーバー** | API ホスティング用 | AWS / GCP / Heroku など |
| **PostgreSQL データベース** | データ保存用 | サーバー環境で用意 |
| **Redis サーバー** | キャッシュ用 | サーバー環境で用意 |
| **ドメイン名** | 公開URL用 | お名前.com など |
| **SSL証明書** | HTTPS通信用 | Let's Encrypt など |

### 準備するファイル

```
準備するファイル:
├── Firebase サービスアカウントキー (JSON ファイル)
├── Stripe 本番APIキー (sk_live_xxx, pk_live_xxx)
├── Stripe Webhook シークレット (whsec_xxx)
└── 32文字以上のランダム文字列 (JWT用)
```

---

## Step 1: Firebase の設定

### 1.1 Firebase Console にアクセス

1. ブラウザで https://console.firebase.google.com/ を開く
2. Google アカウントでログイン
3. 「プロジェクトを追加」または既存プロジェクトを選択

### 1.2 サービスアカウントキーをダウンロード

```
操作手順:
1. 左メニュー「⚙️ 設定」→「プロジェクトの設定」をクリック
2. 「サービスアカウント」タブをクリック
3. 「新しい秘密鍵の生成」ボタンをクリック
4. 「キーを生成」をクリック
5. JSONファイルがダウンロードされる

⚠️ 重要: このファイルは絶対に他人に見せないでください！
```

### 1.3 ダウンロードしたファイルの配置

```
ダウンロードしたJSONファイルを:
  → api/ フォルダの中に配置
  → ファイル名を「firebase-service-account.json」に変更
```

---

## Step 2: Stripe の設定

### 2.1 Stripe Dashboard にアクセス

1. ブラウザで https://dashboard.stripe.com/ を開く
2. Stripe アカウントでログイン

### 2.2 本番モードに切り替え

```
⚠️ 重要: 必ず「本番モード」に切り替えてください！

操作手順:
1. 画面右上の「テスト」スイッチを確認
2. スイッチをクリックして「本番」に切り替え
3. 画面上部が緑色からオレンジ色に変わる
```

### 2.3 API キーを取得

```
操作手順:
1. 左メニュー「開発者」→「APIキー」をクリック
2. 以下の2つのキーをメモ:
   - 公開可能キー: pk_live_xxxx...（「公開」と書いてある）
   - シークレットキー: sk_live_xxxx...（「表示」をクリック）

⚠️ 重要:
- sk_live_ で始まるキーは絶対に他人に見せないでください！
- sk_test_ で始まるキーは本番では使えません！
```

### 2.4 Webhook を設定

```
操作手順:
1. 左メニュー「開発者」→「Webhook」をクリック
2. 「エンドポイントを追加」ボタンをクリック
3. 以下を入力:
   - エンドポイント URL: https://あなたのドメイン/api/payments/webhook
   - イベントを選択:
     ✅ payment_intent.succeeded
     ✅ payment_intent.payment_failed
     ✅ payment_intent.canceled
     ✅ charge.refunded
4. 「エンドポイントを追加」をクリック
5. 作成されたエンドポイントをクリック
6. 「署名シークレット」の「表示」をクリック
7. whsec_xxx... をメモ

⚠️ この署名シークレットも絶対に他人に見せないでください！
```

---

## Step 3: サーバー環境変数の設定

### 3.1 設定ファイルを開く

サーバーの `api/.env` ファイルを開いて、以下のように編集します。

### 3.2 環境変数一覧（コピー＆編集用）

```env
# ============================================
# TriPrize 本番環境設定
# ============================================

# ----- 基本設定 -----
NODE_ENV=production
PORT=3000

# ----- データベース設定 -----
# 形式: postgresql://ユーザー名:パスワード@ホスト名:ポート/データベース名
DATABASE_URL=postgresql://triprize:あなたのパスワード@localhost:5432/triprize_prod
DATABASE_SSL=true

# ----- Redis設定 -----
REDIS_URL=redis://localhost:6379

# ----- Firebase認証設定 -----
USE_MOCK_AUTH=false
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./firebase-service-account.json

# ----- Stripe決済設定 -----
USE_MOCK_PAYMENT=false
STRIPE_SECRET_KEY=sk_live_ここにあなたのシークレットキー
STRIPE_PUBLISHABLE_KEY=pk_live_ここにあなたの公開キー
STRIPE_WEBHOOK_SECRET=whsec_ここにあなたの署名シークレット

# ----- セキュリティ設定 -----
# 32文字以上のランダムな文字列を設定してください
# 例: openssl rand -base64 48 で生成可能
JWT_SECRET=ここに32文字以上のランダムな文字列を入力

# ----- CORS設定 -----
# 本番ドメインをカンマ区切りで指定
CORS_ORIGIN=https://あなたのドメイン.com

# ----- ログ設定 -----
LOG_LEVEL=info

# ----- 初期管理者 -----
INITIAL_ADMIN_EMAIL=admin@あなたのドメイン.com
```

### 3.3 設定値の説明

| 項目 | 説明 | 例 |
|------|------|-----|
| `DATABASE_URL` | PostgreSQLの接続先 | `postgresql://user:pass@db.example.com:5432/triprize` |
| `REDIS_URL` | Redisの接続先 | `redis://cache.example.com:6379` |
| `STRIPE_SECRET_KEY` | Stripeのシークレットキー | `sk_live_51Hxxx...` |
| `STRIPE_PUBLISHABLE_KEY` | Stripeの公開キー | `pk_live_51Hxxx...` |
| `STRIPE_WEBHOOK_SECRET` | Webhookの署名シークレット | `whsec_xxx...` |
| `JWT_SECRET` | トークン暗号化用 | `aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3` |
| `CORS_ORIGIN` | 許可するドメイン | `https://triprize.example.com` |

---

## Step 4: フロントエンドの設定

### 4.1 API接続先を変更

ファイル: `mobile/lib/core/constants/app_config.dart`

```dart
// 変更前（テスト用）
static const String apiBaseUrl = 'http://localhost:3000/api';

// 変更後（本番用）
static const String apiBaseUrl = 'https://あなたのドメイン.com/api';
```

### 4.2 Firebase設定を確認

ファイル: `mobile/lib/firebase_options.dart`

Firebase Console から取得した設定値が正しいことを確認してください。

---

## Step 5: デプロイ実行

### 5.1 サーバー側（API）のデプロイ

技術担当者に以下のコマンドを実行してもらいます：

```bash
# 1. ソースコードを最新化
git pull origin main

# 2. 依存パッケージをインストール
cd api
npm install --production

# 3. ビルド
npm run build

# 4. データベースマイグレーション
npm run migrate

# 5. サーバー起動（PM2使用の場合）
pm2 start dist/server.js --name triprize-api

# または
NODE_ENV=production npm start
```

### 5.2 フロントエンド（Flutter Web）のデプロイ

```bash
# 1. ビルド
cd mobile
flutter build web --release

# 2. 生成されたファイルをWebサーバーに配置
# build/web/ フォルダの中身をWebサーバーにアップロード
```

---

## Step 6: 動作確認

### 6.1 ヘルスチェック

ブラウザで以下のURLにアクセス：
```
https://あなたのドメイン.com/health
```

正常な場合の表示：
```json
{"status":"ok","timestamp":"2024-12-24T..."}
```

### 6.2 機能確認チェックリスト

```
□ トップページが表示される
□ 新規ユーザー登録ができる
□ ログインができる
□ キャンペーン一覧が表示される
□ キャンペーン詳細が表示される
□ 購入画面に進める
□ 決済が完了する（テスト購入）
□ 管理者でログインできる
□ 管理画面が表示される
□ 抽選が実行できる
□ 当選通知が届く
```

---

## ❓ トラブルシューティング

### よくある問題と解決方法

#### 問題1: ログインできない

```
考えられる原因:
- Firebase の設定が間違っている
- サービスアカウントキーのパスが間違っている

解決方法:
1. firebase-service-account.json が api/ フォルダにあるか確認
2. FIREBASE_SERVICE_ACCOUNT_KEY_PATH の値を確認
3. Firebase Console でプロジェクトIDが一致しているか確認
```

#### 問題2: 決済ができない

```
考えられる原因:
- Stripe のキーがテスト用のまま
- Webhook が設定されていない

解決方法:
1. STRIPE_SECRET_KEY が sk_live_ で始まっているか確認
2. Stripe Dashboard で Webhook が正しく設定されているか確認
3. Webhook のエンドポイントURLが正しいか確認
```

#### 問題3: 「アクセス権限がありません」エラー

```
考えられる原因:
- CORS の設定が間違っている
- ドメインが許可リストにない

解決方法:
1. CORS_ORIGIN にフロントエンドのドメインを追加
2. https:// を含めた正確なURLを指定
```

#### 問題4: データベース接続エラー

```
考えられる原因:
- DATABASE_URL が間違っている
- データベースサーバーに接続できない

解決方法:
1. DATABASE_URL の形式を確認
2. データベースサーバーが起動しているか確認
3. ファイアウォールでポートが開いているか確認
```

---

## 🔄 緊急時のロールバック

問題が発生した場合、以下の手順で前のバージョンに戻せます：

### ロールバック手順

```bash
# 1. サーバーを停止
pm2 stop triprize-api

# 2. 前のバージョンに戻す
git checkout 前のバージョンのタグ
npm run build

# 3. サーバーを再起動
pm2 restart triprize-api
```

### データベースのロールバック（必要な場合のみ）

```bash
# バックアップから復元
psql -U triprize -d triprize_prod < backup_YYYYMMDD.sql
```

---

## ⚠️ 絶対にやってはいけないこと

```
❌ USE_MOCK_AUTH=true のまま本番公開
   → 誰でもログインできてしまいます

❌ USE_MOCK_PAYMENT=true のまま本番公開
   → 決済せずに購入できてしまいます

❌ sk_test_ で始まるキーを本番で使用
   → 実際の決済ができません

❌ JWT_SECRET を短い文字列に設定
   → セキュリティリスクがあります

❌ CORS_ORIGIN=* に設定
   → どこからでもアクセス可能になります

❌ サービスアカウントキーを公開
   → システムが乗っ取られる可能性があります
```

---

## 📞 サポート連絡先

問題が解決しない場合は、開発チームに連絡してください。

連絡時に以下の情報を添えてください：
- エラーメッセージ（スクリーンショット）
- 発生した操作の手順
- 発生日時

---

**🚀 上線成功をお祈りします！**

