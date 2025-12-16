# VoiceTranslate Pro - 収益化の実装場所と料金説明

## 📍 収益化の実装場所

### 1. **サブスクリプション登録画面**

**ファイル**: `subscription.html`

**目的**: ユーザーがサブスクリプションを登録する画面

**機能**:
- Googleアカウントでログイン
- Stripe Checkout にリダイレクト
- 月額3ドルのサブスクリプション登録
- 7日間無料トライアル

**アクセス方法**:
- Chrome拡張機能をインストール後、初回起動時に表示
- または、拡張機能アイコンをクリック → `subscription.html` にリダイレクト

---

### 2. **Firebase Functions（バックエンド）**

**ファイル**: `firebase-backend/functions/index.js`

**目的**: サブスクリプション管理のバックエンド処理

**機能**:
- Stripe Checkout セッションの作成
- Stripe Webhook の処理（決済成功、キャンセルなど）
- サブスクリプション状態の確認
- Firestore へのデータ保存

**実装手順**:
1. Firebase プロジェクトを作成
2. Firebase Functions をセットアップ
3. `functions/index.js` を実装（`docs/SUBSCRIPTION_IMPLEMENTATION.md` 参照）
4. Stripe API キーを設定
5. デプロイ: `firebase deploy --only functions`

---

### 3. **メインアプリ（サブスクリプション検証）**

**ファイル**: `voicetranslate-pro.js`

**目的**: サブスクリプション状態を確認し、機能を制限

**機能**:
- 初期化時にサブスクリプション状態を確認
- サブスクリプションが無効な場合、機能を制限
- 「録音開始」ボタンクリック時にサブスクリプションをチェック

**実装例**:
```javascript
// 初期化時にサブスクリプション状態を確認
async init() {
  // Firebase認証状態を監視
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      // ログイン済み: サブスクリプション状態を確認
      const subscription = await subscriptionManager.checkSubscription();
      
      if (!subscription.isActive) {
        // サブスクリプションが無効: subscription.html にリダイレクト
        window.location.href = 'subscription.html';
      }
    } else {
      // 未ログイン: subscription.html にリダイレクト
      window.location.href = 'subscription.html';
    }
  });
}

// 録音開始時にサブスクリプションをチェック
async startRecording() {
  // サブスクリプションチェック
  if (!subscriptionManager.canUseFeature()) {
    return; // サブスクリプションが無効な場合、処理を中止
  }

  // ... 既存の録音開始コード ...
}
```

---

## 💰 料金説明

### プラグイン費用

| 項目 | 料金 | 説明 |
|------|------|------|
| **サブスクリプション** | **$3/月** | プラグイン使用料 |
| **無料トライアル** | 7日間 | クレジットカード登録必要 |
| **キャンセル** | いつでも可能 | 違約金なし |

**重要**: プラグイン費用（$3/月）とは別に、**OpenAI APIキー**が必要です。

---

### OpenAI API費用（自己負担）

| 項目 | 料金 | 説明 |
|------|------|------|
| **音声入力** | $0.06/分 | マイク入力の音声認識 |
| **音声出力** | $0.24/分 | 翻訳音声の出力 |
| **概算** | $0.50-$1.00/時間 | 1時間の会議での目安 |

**OpenAI APIキーの取得方法**:
1. [OpenAI Platform](https://platform.openai.com) にアクセス
2. アカウント作成（無料）
3. APIキーを取得
4. クレジットカード登録（使用した分だけ支払い）

---

### 月額費用の例

| 使用時間 | プラグイン費用 | OpenAI API費用 | **合計** |
|---------|--------------|---------------|---------|
| 10時間/月 | $3 | $5-$10 | **$8-$13** |
| 20時間/月 | $3 | $10-$20 | **$13-$23** |
| 40時間/月 | $3 | $20-$40 | **$23-$43** |

---

## 🔄 ユーザーフロー

### 1. **初回インストール**

```
ユーザーがChrome Web Storeからインストール
    ↓
拡張機能アイコンをクリック
    ↓
subscription.html が表示される
    ↓
「サブスクリプションを開始」ボタンをクリック
    ↓
Googleアカウントでログイン
    ↓
Stripe Checkout にリダイレクト
    ↓
クレジットカード情報を入力
    ↓
決済完了（7日間無料トライアル開始）
    ↓
teams-realtime-translator.html にリダイレクト
    ↓
OpenAI APIキーを入力
    ↓
翻訳開始
```

### 2. **既存ユーザー**

```
ユーザーがログイン
    ↓
サブスクリプション状態を確認
    ↓
有効な場合: teams-realtime-translator.html にリダイレクト
    ↓
無効な場合: subscription.html にリダイレクト
```

### 3. **サブスクリプションキャンセル**

```
ユーザーがStripeダッシュボードでキャンセル
    ↓
Stripe Webhook が Firebase Functions に通知
    ↓
Firestore のサブスクリプション状態を更新（canceled）
    ↓
次回ログイン時: subscription.html にリダイレクト
```

---

## 📊 収益計算

### Stripe手数料

- **手数料**: 2.9% + $0.30/取引
- **月額3ドルの場合**: 実質収益 $2.61/月

### 収益シミュレーション

| ユーザー数 | 月額収益（総額） | Stripe手数料 | **実質収益** |
|-----------|----------------|-------------|-------------|
| 100 | $300 | $38.70 | **$261.30** |
| 500 | $1,500 | $193.50 | **$1,306.50** |
| 1,000 | $3,000 | $387.00 | **$2,613.00** |
| 5,000 | $15,000 | $1,935.00 | **$13,065.00** |

---

## 🎯 実装チェックリスト

### 必須項目

- [ ] **Stripe アカウントを作成**
  - [ ] 商品を作成: $3.00/月
  - [ ] API キーを取得: `pk_live_...` と `sk_live_...`

- [ ] **Firebase プロジェクトを作成**
  - [ ] Firebase Authentication を有効化
  - [ ] Firestore を有効化
  - [ ] Firebase Functions を有効化

- [ ] **バックエンドの実装**
  - [ ] `firebase-backend/functions/index.js` を実装
  - [ ] Stripe API キーを設定
  - [ ] デプロイ: `firebase deploy --only functions`

- [ ] **Chrome拡張機能の修正**
  - [ ] `subscription.html` を作成（✅ 完了）
  - [ ] Firebase SDK を追加
  - [ ] サブスクリプション管理機能を追加
  - [ ] メインアプリに統合

- [ ] **Chrome Web Store に公開**
  - [ ] プライバシーポリシーを公開
  - [ ] ストアリスティングを入力
  - [ ] 料金について明記

---

## 📝 ユーザーへの説明文

### Chrome Web Store の説明文

```
💰 料金について

【プラグイン費用】
- 月額3ドル
- 7日間無料トライアル
- いつでもキャンセル可能

【OpenAI API費用（別途必要）】
- 音声入力: $0.06/分
- 音声出力: $0.24/分
- 概算: $0.50-$1.00/時間

⚠️ 重要: プラグイン費用（$3/月）とは別に、OpenAI APIキーが必要です。
OpenAI APIの費用は使用量に応じて別途発生します（従量課金制）。

【月額費用の例】
- 10時間/月: $8-$13（プラグイン$3 + API$5-$10）
- 20時間/月: $13-$23（プラグイン$3 + API$10-$20）
- 40時間/月: $23-$43（プラグイン$3 + API$20-$40）
```

### README.md の説明文

```
## 💰 料金について

### プラグイン費用（Chrome拡張機能版）

- **サブスクリプション**: $3/月
- **無料トライアル**: 7日間
- **キャンセル**: いつでも可能

**重要**: プラグイン費用（$3/月）とは別に、**OpenAI APIキー**が必要です。

### OpenAI API費用（自己負担）

- **音声入力**: $0.06/分
- **音声出力**: $0.24/分
- **概算**: $0.50-$1.00/時間

### 月額費用の例

| 使用時間 | プラグイン費用 | OpenAI API費用 | 合計 |
|---------|--------------|---------------|------|
| 10時間/月 | $3 | $5-$10 | $8-$13 |
| 20時間/月 | $3 | $10-$20 | $13-$23 |
| 40時間/月 | $3 | $20-$40 | $23-$43 |
```

---

## 🔗 関連ドキュメント

- **[SUBSCRIPTION_IMPLEMENTATION.md](./SUBSCRIPTION_IMPLEMENTATION.md)** - サブスクリプション実装ガイド
- **[CHROME_STORE_LISTING.md](./CHROME_STORE_LISTING.md)** - Chrome Web Store ストアリスティング
- **[PRIVACY_POLICY.md](../PRIVACY_POLICY.md)** - プライバシーポリシー

---

**VoiceTranslate Pro Team**  
**最終更新日**: 2024年12月

