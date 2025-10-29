# VoiceTranslate Pro - Firebase + Stripe セットアップガイド

## 📋 概要

このガイドでは、VoiceTranslate Pro の月額3ドルのサブスクリプション機能を実装するための手順を説明します。

**実装内容**:
- Firebase Authentication（Googleログイン）
- Firebase Firestore（サブスクリプション情報の保存）
- Firebase Functions（バックエンド処理）
- Stripe（決済処理）

**実装期間**: 1〜2時間

---

## ステップ1: Firebase プロジェクトの作成

### 1.1 Firebase Console にアクセス

https://console.firebase.google.com

### 1.2 新しいプロジェクトを作成

1. **「プロジェクトを追加」**をクリック
2. **プロジェクト名**: `voicetranslate-pro`
3. **Google Analytics**: 無効でOK
4. **「プロジェクトを作成」**をクリック

### 1.3 Firebase Authentication を有効化

1. **Authentication** → **Get started**
2. **Sign-in method** → **Google** → **有効化**
3. **プロジェクトのサポートメール**を入力
4. **保存**

### 1.4 Firestore を有効化

1. **Firestore Database** → **Create database**
2. **Start in test mode**（練習用）
3. **Location**: `asia-northeast1`（東京）
4. **有効化**

### 1.5 Firebase Functions を有効化

1. **Functions** → **Get started**
2. **Upgrade to Blaze plan**
   - **無料枠あり**（月間125,000回の呼び出しまで無料）
   - クレジットカード登録が必要（使用量が少なければ無料）

### 1.6 Firebase Web アプリを追加

1. **プロジェクトの設定** → **全般**
2. **アプリを追加** → **Web**（`</>`アイコン）
3. **アプリのニックネーム**: `VoiceTranslate Pro`
4. **Firebase Hosting**: チェックしない
5. **アプリを登録**

**Firebase 設定をコピー**:
```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "voicetranslate-pro.firebaseapp.com",
  projectId: "voicetranslate-pro",
  storageBucket: "voicetranslate-pro.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:xxxxx"
};
```

この設定を `subscription.html` の 242行目に貼り付けてください。

---

## ステップ2: Stripe アカウントの作成

### 2.1 Stripe にアクセス

https://stripe.com

### 2.2 アカウント作成

1. **Sign up** をクリック
2. メールアドレス、パスワードを入力
3. **Create account**

### 2.3 テストモードに切り替え

1. 右上の **「テストモード」**トグルを**ON**にする
2. **テストモード**では実際の決済は発生しません

### 2.4 商品を作成

1. **Products** → **Add product**
2. **Name**: `VoiceTranslate Pro Subscription`
3. **Description**: `月額3ドルのサブスクリプション`
4. **Pricing**:
   - **Price**: `$3.00`
   - **Billing period**: `Monthly`
   - **Recurring**: チェック
5. **Save product**

**Price ID をコピー**:
- 例: `price_xxxxxxxxxxxxx`
- この ID を後で使用します

### 2.5 API キーを取得

1. **Developers** → **API keys**
2. **Publishable key**: `pk_test_xxxxx`（テストモード）
3. **Secret key**: `sk_test_xxxxx`（テストモード）

**これらのキーをコピー**して、安全な場所に保存してください。

### 2.6 Webhook を設定

1. **Developers** → **Webhooks** → **Add endpoint**
2. **Endpoint URL**: `https://asia-northeast1-voicetranslate-pro.cloudfunctions.net/stripeWebhook`
   - **注意**: Firebase Functions をデプロイした後に、正しいURLに更新してください
3. **Events to send**:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. **Add endpoint**

**Webhook Signing Secret をコピー**:
- 例: `whsec_xxxxxxxxxxxxx`
- この Secret を後で使用します

---

## ステップ3: Firebase Functions の設定

### 3.1 Firebase にログイン

```powershell
cd d:\apps\simultaneous_interpretation\firebase-backend
firebase login
```

ブラウザが開くので、Googleアカウントでログインしてください。

### 3.2 Firebase プロジェクトを選択

```powershell
firebase use voicetranslate-pro
```

### 3.3 Stripe API キーを設定

```powershell
# Secret Key を設定
firebase functions:config:set stripe.secret_key="sk_test_xxxxx"

# Price ID を設定
firebase functions:config:set stripe.price_id="price_xxxxx"

# Webhook Secret を設定
firebase functions:config:set stripe.webhook_secret="whsec_xxxxx"
```

**注意**: `sk_test_xxxxx`、`price_xxxxx`、`whsec_xxxxx` を実際の値に置き換えてください。

### 3.4 設定を確認

```powershell
firebase functions:config:get
```

出力例:
```json
{
  "stripe": {
    "secret_key": "sk_test_xxxxx",
    "price_id": "price_xxxxx",
    "webhook_secret": "whsec_xxxxx"
  }
}
```

---

## ステップ4: Firebase Functions をデプロイ

### 4.1 デプロイ

```powershell
cd d:\apps\simultaneous_interpretation\firebase-backend
firebase deploy --only functions,firestore
```

デプロイには5〜10分かかります。

### 4.2 デプロイ完了後、Function URL を確認

出力例:
```
✔  functions[createCheckoutSession(asia-northeast1)] Successful create operation.
Function URL (createCheckoutSession(asia-northeast1)): https://asia-northeast1-voicetranslate-pro.cloudfunctions.net/createCheckoutSession

✔  functions[checkSubscription(asia-northeast1)] Successful create operation.
Function URL (checkSubscription(asia-northeast1)): https://asia-northeast1-voicetranslate-pro.cloudfunctions.net/checkSubscription

✔  functions[stripeWebhook(asia-northeast1)] Successful create operation.
Function URL (stripeWebhook(asia-northeast1)): https://asia-northeast1-voicetranslate-pro.cloudfunctions.net/stripeWebhook
```

**`stripeWebhook` の URL をコピー**して、Stripe の Webhook 設定を更新してください。

---

## ステップ5: subscription.html を更新

### 5.1 Firebase 設定を更新

`subscription.html` の 242〜249行目を更新：

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",  // ← 実際の値に置き換え
    authDomain: "voicetranslate-pro.firebaseapp.com",  // ← 実際の値に置き換え
    projectId: "voicetranslate-pro",  // ← 実際の値に置き換え
    storageBucket: "voicetranslate-pro.appspot.com",  // ← 実際の値に置き換え
    messagingSenderId: "123456789",  // ← 実際の値に置き換え
    appId: "1:123456789:web:xxxxx"  // ← 実際の値に置き換え
};
```

### 5.2 Stripe Publishable Key を更新

`subscription.html` の 253行目を更新：

```javascript
const stripe = Stripe('pk_test_xxxxx'); // ← 実際の Publishable Key に置き換え
```

---

## ステップ6: テスト

### 6.1 Chrome拡張機能をリロード

1. `chrome://extensions/` を開く
2. **デベロッパーモード**を有効化
3. **パッケージ化されていない拡張機能を読み込む**
4. `d:\apps\simultaneous_interpretation` を選択

### 6.2 サブスクリプション登録をテスト

1. 拡張機能アイコンをクリック
2. `subscription.html` が表示される
3. **「サブスクリプションを開始」**をクリック
4. Googleアカウントでログイン
5. Stripe Checkout にリダイレクト
6. **テストカード**で決済:
   - カード番号: `4242 4242 4242 4242`
   - 有効期限: `12/34`
   - CVC: `123`
   - 郵便番号: `12345`
7. **Subscribe** をクリック
8. `success.html` にリダイレクト

### 6.3 サブスクリプション状態を確認

1. Firebase Console → **Firestore Database**
2. `subscriptions` コレクションを確認
3. ユーザーIDのドキュメントが作成されているか確認

---

## ステップ7: 本番モードに切り替え（オプション）

### 7.1 Stripe を本番モードに切り替え

1. Stripe Dashboard → **テストモード**トグルを**OFF**
2. **本番モード**に切り替え
3. 商品を再作成（本番モード用）
4. API キーを取得（`pk_live_xxxxx`、`sk_live_xxxxx`）

### 7.2 Firebase Functions の設定を更新

```powershell
firebase functions:config:set stripe.secret_key="sk_live_xxxxx"
firebase functions:config:set stripe.price_id="price_xxxxx"
firebase functions:config:set stripe.webhook_secret="whsec_xxxxx"
```

### 7.3 再デプロイ

```powershell
firebase deploy --only functions
```

### 7.4 subscription.html を更新

`subscription.html` の 253行目を更新：

```javascript
const stripe = Stripe('pk_live_xxxxx'); // ← 本番用 Publishable Key
```

---

## 🎯 完了！

これで、月額3ドルのサブスクリプション機能が実装されました！

### 次のステップ

1. **Chrome Web Store に公開**（オプション）
2. **ユーザーを獲得**
3. **フィードバックを収集**
4. **機能を改善**

---

## 📞 サポート

質問があれば、お気軽にお聞きください！🚀

