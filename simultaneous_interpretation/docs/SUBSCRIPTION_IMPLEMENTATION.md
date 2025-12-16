# VoiceTranslate Pro - 月額3ドル サブスクリプション実装ガイド

## 📋 概要

このガイドでは、VoiceTranslate Pro を**月額3ドルの有料版のみ**として提供する方法を説明します。

**ビジネスモデル**:
- 💰 月額: $3.00/月
- 🎯 ターゲット: ビジネスユーザー、語学学習者
- 🚀 無料トライアル: 7日間（推奨）

---

## 🛠️ 技術スタック

### 推奨構成

1. **決済システム**: Stripe（推奨）
   - 手数料: 2.9% + $0.30/取引
   - 月額3ドルの場合: 実質収益 $2.61/月
   - サブスクリプション管理が簡単

2. **バックエンド**: Firebase Functions（推奨）
   - サーバーレス（サーバー管理不要）
   - 無料枠: 月125,000リクエスト
   - Stripe との統合が簡単

3. **データベース**: Firestore
   - ユーザー情報とサブスクリプション状態を保存
   - リアルタイム同期

4. **認証**: Firebase Authentication
   - Google、メールアドレスでログイン
   - セキュアな認証

---

## 📐 アーキテクチャ

```
ユーザー
  ↓
Chrome拡張機能
  ↓
Firebase Authentication（ログイン）
  ↓
Stripe Checkout（決済）
  ↓
Firebase Functions（Webhook処理）
  ↓
Firestore（サブスクリプション状態保存）
  ↓
Chrome拡張機能（ライセンス検証）
```

---

## 🚀 実装手順

### ステップ1: Stripe アカウントの作成

1. **Stripe に登録**
   - URL: https://stripe.com
   - アカウント作成（無料）

2. **API キーの取得**
   - Dashboard → Developers → API keys
   - **Publishable key**: `pk_live_...`（公開可能）
   - **Secret key**: `sk_live_...`（秘密、サーバー側のみ）

3. **商品の作成**
   - Dashboard → Products → Add product
   - 名前: `VoiceTranslate Pro Subscription`
   - 価格: $3.00/月
   - 課金タイプ: `Recurring`
   - 課金間隔: `Monthly`

4. **Price ID の取得**
   - 作成した商品の Price ID をコピー: `price_xxxxx`

---

### ステップ2: Firebase プロジェクトの作成

1. **Firebase Console にアクセス**
   - URL: https://console.firebase.google.com
   - 新しいプロジェクトを作成

2. **Firebase Authentication を有効化**
   - Authentication → Sign-in method
   - Google、Email/Password を有効化

3. **Firestore を有効化**
   - Firestore Database → Create database
   - モード: Production mode

4. **Firebase Functions を有効化**
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init functions
   ```

---

### ステップ3: バックエンドの実装

#### 1. Firebase Functions のセットアップ

```bash
# プロジェクトルートで実行
mkdir firebase-backend
cd firebase-backend
firebase init functions

# 必要なパッケージをインストール
cd functions
npm install stripe firebase-admin
```

#### 2. Stripe Checkout セッション作成

`functions/index.js`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret_key);

admin.initializeApp();

/**
 * Stripe Checkout セッションを作成
 * 
 * 目的: ユーザーがサブスクリプションを開始するためのCheckoutページを作成
 */
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
  // 認証チェック
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'ユーザーがログインしていません');
  }

  const userId = context.auth.uid;
  const userEmail = context.auth.token.email;

  try {
    // Stripe Checkout セッションを作成
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: userEmail,
      line_items: [
        {
          price: 'price_xxxxx', // ← あなたのPrice IDに置き換え
          quantity: 1,
        },
      ],
      metadata: {
        userId: userId,
      },
      success_url: `https://your-extension-id.chromiumapp.org/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://your-extension-id.chromiumapp.org/cancel.html`,
    });

    return { sessionId: session.id };
  } catch (error) {
    console.error('Checkout session creation failed:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Stripe Webhook ハンドラー
 * 
 * 目的: Stripeからのイベント（決済成功、キャンセルなど）を処理
 */
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = functions.config().stripe.webhook_secret;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // イベントタイプに応じて処理
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

/**
 * Checkout完了時の処理
 */
async function handleCheckoutSessionCompleted(session) {
  const userId = session.metadata.userId;
  const subscriptionId = session.subscription;

  // Firestoreにサブスクリプション情報を保存
  await admin.firestore().collection('users').doc(userId).set({
    subscriptionId: subscriptionId,
    subscriptionStatus: 'active',
    subscriptionStartDate: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`Subscription activated for user: ${userId}`);
}

/**
 * サブスクリプション更新時の処理
 */
async function handleSubscriptionUpdated(subscription) {
  const userId = subscription.metadata.userId;

  await admin.firestore().collection('users').doc(userId).update({
    subscriptionStatus: subscription.status,
  });

  console.log(`Subscription updated for user: ${userId}, status: ${subscription.status}`);
}

/**
 * サブスクリプションキャンセル時の処理
 */
async function handleSubscriptionDeleted(subscription) {
  const userId = subscription.metadata.userId;

  await admin.firestore().collection('users').doc(userId).update({
    subscriptionStatus: 'canceled',
    subscriptionEndDate: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Subscription canceled for user: ${userId}`);
}

/**
 * サブスクリプション状態を確認
 */
exports.checkSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'ユーザーがログインしていません');
  }

  const userId = context.auth.uid;

  try {
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return { isActive: false };
    }

    const userData = userDoc.data();
    return {
      isActive: userData.subscriptionStatus === 'active',
      status: userData.subscriptionStatus,
    };
  } catch (error) {
    console.error('Subscription check failed:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});
```

#### 3. 環境変数の設定

```bash
# Stripe API キーを設定
firebase functions:config:set stripe.secret_key="sk_live_xxxxx"
firebase functions:config:set stripe.webhook_secret="whsec_xxxxx"

# デプロイ
firebase deploy --only functions
```

---

### ステップ4: Chrome拡張機能の修正

#### 1. Firebase SDK の追加

`teams-realtime-translator.html` に追加:

```html
<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-functions-compat.js"></script>

<script>
  // Firebase 設定
  const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:xxxxx"
  };

  firebase.initializeApp(firebaseConfig);
</script>
```

#### 2. サブスクリプション管理機能の追加

新しいファイル `voicetranslate-subscription.js` を作成:

```javascript
/**
 * VoiceTranslate Pro - サブスクリプション管理
 * 
 * 目的: ユーザーのサブスクリプション状態を管理
 */

class SubscriptionManager {
  constructor() {
    this.auth = firebase.auth();
    this.functions = firebase.functions();
    this.isSubscriptionActive = false;
  }

  /**
   * ログイン
   */
  async login() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await this.auth.signInWithPopup(provider);
      console.log('ログイン成功:', result.user.email);
      return result.user;
    } catch (error) {
      console.error('ログインエラー:', error);
      throw error;
    }
  }

  /**
   * サブスクリプション状態を確認
   */
  async checkSubscription() {
    try {
      const checkSubscription = this.functions.httpsCallable('checkSubscription');
      const result = await checkSubscription();
      this.isSubscriptionActive = result.data.isActive;
      return result.data;
    } catch (error) {
      console.error('サブスクリプション確認エラー:', error);
      return { isActive: false };
    }
  }

  /**
   * Stripe Checkout を開始
   */
  async startCheckout() {
    try {
      const createCheckoutSession = this.functions.httpsCallable('createCheckoutSession');
      const result = await createCheckoutSession();
      
      // Stripe Checkout にリダイレクト
      const stripe = Stripe('pk_live_xxxxx'); // ← あなたのPublishable Keyに置き換え
      await stripe.redirectToCheckout({ sessionId: result.data.sessionId });
    } catch (error) {
      console.error('Checkout開始エラー:', error);
      throw error;
    }
  }

  /**
   * 機能が使用可能かチェック
   */
  canUseFeature() {
    if (!this.isSubscriptionActive) {
      alert('この機能を使用するには、月額3ドルのサブスクリプションが必要です。');
      this.startCheckout();
      return false;
    }
    return true;
  }
}

// グローバルインスタンス
const subscriptionManager = new SubscriptionManager();
```

#### 3. メインアプリに統合

`voicetranslate-pro.js` に追加:

```javascript
// 初期化時にサブスクリプション状態を確認
async init() {
  // ... 既存のコード ...

  // Firebase認証状態を監視
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      // ログイン済み: サブスクリプション状態を確認
      const subscription = await subscriptionManager.checkSubscription();
      
      if (!subscription.isActive) {
        // サブスクリプションが無効: Checkoutページを表示
        this.showSubscriptionPrompt();
      }
    } else {
      // 未ログイン: ログインを促す
      this.showLoginPrompt();
    }
  });
}

// 録音開始時にサブスクリプションをチェック
async startRecording() {
  // サブスクリプションチェック
  if (!subscriptionManager.canUseFeature()) {
    return;
  }

  // ... 既存の録音開始コード ...
}
```

---

### ステップ5: manifest.json の更新

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self' https://www.gstatic.com https://js.stripe.com; object-src 'self'; connect-src 'self' wss://api.openai.com https://api.openai.com https://*.firebaseio.com https://firestore.googleapis.com https://api.stripe.com;"
  }
}
```

---

## 💡 ユーザーフロー

1. **拡張機能をインストール**
   - Chrome Web Store から無料でインストール

2. **初回起動**
   - ログインプロンプトが表示される
   - Googleアカウントでログイン

3. **サブスクリプション登録**
   - 「月額3ドルでサブスクリプションを開始」ボタンをクリック
   - Stripe Checkout ページにリダイレクト
   - クレジットカード情報を入力
   - 決済完了

4. **機能の使用**
   - サブスクリプションが有効化される
   - すべての機能が使用可能になる

---

## 📊 収益計算

| ユーザー数 | 月額収益（総額） | Stripe手数料 | 実質収益 |
|-----------|----------------|-------------|---------|
| 100 | $300 | $38.70 | $261.30 |
| 500 | $1,500 | $193.50 | $1,306.50 |
| 1,000 | $3,000 | $387.00 | $2,613.00 |
| 5,000 | $15,000 | $1,935.00 | $13,065.00 |

**Stripe手数料**: 2.9% + $0.30/取引

---

## 🎯 マーケティング戦略

1. **7日間無料トライアル**（推奨）
   - ユーザーが試しやすい
   - コンバージョン率が向上

2. **年間プラン**（オプション）
   - $30/年（2ヶ月分お得）
   - 長期ユーザーの獲得

3. **Chrome Web Store での説明**
   ```
   💰 月額3ドルのサブスクリプションが必要です
   🎁 7日間無料トライアル
   ✅ いつでもキャンセル可能
   ```

---

## ⚠️ 重要な注意点

1. **Chrome Web Store のポリシー**
   - 拡張機能自体は無料でインストール可能
   - サブスクリプションが必要であることを明記

2. **プライバシーポリシーの更新**
   - Firebase、Stripeの使用を明記
   - ユーザーデータの取り扱いを説明

3. **税金**
   - 各国の税法に従う
   - Stripeは自動的に税金を計算（Stripe Tax使用時）

---

**VoiceTranslate Pro Team**  
**最終更新日**: 2024年12月

