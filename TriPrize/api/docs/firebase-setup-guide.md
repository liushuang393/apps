# Firebase Admin SDK 導入手順書

新規プロジェクトでFirebase Admin SDKを導入するための完全ガイド。

---

## 目次

1. [Firebase Console 操作](#1-firebase-console-操作)
2. [サービスアカウントキー取得](#2-サービスアカウントキー取得)
3. [プロジェクトへのファイル配置](#3-プロジェクトへのファイル配置)
4. [環境変数設定](#4-環境変数設定)
5. [動作確認](#5-動作確認)

---

## 1. Firebase Console 操作

### 1.1 Firebaseプロジェクト作成

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. 「プロジェクトを追加」をクリック
3. プロジェクト名を入力（例: `my-project-dev`）
4. Google アナリティクスは任意で設定
5. 「プロジェクトを作成」をクリック

### 1.2 Authentication 有効化

1. 左メニュー「Authentication」→「始める」
2. 「Sign-in method」タブ
3. 使用する認証方法を有効化:
   - メール/パスワード（推奨）
   - Google
   - その他必要なプロバイダー

---

## 2. サービスアカウントキー取得

### 2.1 キーファイルのダウンロード

1. Firebase Console → ⚙️ (設定) → 「プロジェクトの設定」
2. 「サービスアカウント」タブを選択
3. 「新しい秘密鍵の生成」をクリック
4. JSONファイルがダウンロードされる

### 2.2 ファイル名の命名規則（推奨）

```
{プロジェクト名}-firebase-adminsdk.json
```

環境別の例:
- 開発: `my-project-dev-firebase-adminsdk.json`
- ステージング: `my-project-staging-firebase-adminsdk.json`
- 本番: `my-project-prod-firebase-adminsdk.json`

### 2.3 セキュリティ注意事項

⚠️ **絶対にGitにコミットしない！**

`.gitignore` に以下を追加:
```gitignore
# Firebase service account keys
*-firebase-adminsdk*.json
```

---

## 3. プロジェクトへのファイル配置

### 3.1 そのまま使用可能なファイル（コピーのみ）

以下のファイルは変更なしでそのまま使用可能:

| ファイル | 配置先 | 説明 |
|---------|--------|------|
| `firebase-service-account.config.ts` | `src/config/` | サービスアカウント読み込みクラス |

### 3.2 コピー後に修正が必要なファイル

| ファイル | 配置先 | 修正箇所 |
|---------|--------|----------|
| `firebase.config.ts` | `src/config/` | 必要に応じてロギング調整 |
| `.env.example` | プロジェクトルート | Firebase関連のセクションのみ参考 |

### 3.3 ディレクトリ構成

```
your-project/
├── src/
│   ├── config/
│   │   ├── firebase-service-account.config.ts  # ← コピー
│   │   └── firebase.config.ts                  # ← コピー＆必要に応じ修正
│   ├── middleware/
│   │   └── auth.middleware.ts                  # ← 認証が必要な場合
│   └── utils/
│       └── logger.util.ts                      # ← ロガー（依存）
├── {project-name}-firebase-adminsdk.json       # ← 公式からDL
├── .env                                        # ← パス設定
└── .gitignore                                  # ← JSONを除外
```

---

## 4. 環境変数設定

### 4.1 .env ファイル設定

```env
# Firebase Service Account Key Path
# 公式からダウンロードしたJSONファイルのパスを指定
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./my-project-dev-firebase-adminsdk.json

# Mock Authentication (開発時のみ)
# true: Firebase認証をスキップ / false: 本番認証
USE_MOCK_AUTH=false
```

### 4.2 環境別の切替

開発・ステージング・本番でJSONファイルを切り替えるだけ:

```env
# 開発
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./my-project-dev-firebase-adminsdk.json

# ステージング
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./my-project-staging-firebase-adminsdk.json

# 本番
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./my-project-prod-firebase-adminsdk.json
```

---

## 5. 動作確認

### 5.1 診断スクリプト実行

```bash
npx ts-node src/utils/diagnose_firebase.ts
```

成功時の出力:
```
🔍 Diagnosing Firebase Configuration...
📄 Service Account Key Path: ./my-project-dev-firebase-adminsdk.json
🕐 Server time: 2024-XX-XXTXX:XX:XX.XXXZ
✅ Service Account loaded successfully:
   Project ID: my-project-dev
   Client Email: firebase-adminsdk-xxxxx@my-project-dev.iam.gserviceaccount.com
✅ Firebase Admin SDK initialized successfully!
✅ Firebase Auth instance created successfully!
```

### 5.2 よくあるエラーと対処

| エラー | 原因 | 対処 |
|--------|------|------|
| `FIREBASE_SERVICE_ACCOUNT_KEY_PATH is not set` | .env未設定 | .envにパスを追加 |
| `Firebase service account file not found` | JSONファイルが無い | パスを確認、ファイル配置 |
| `Invalid JWT Signature` | サーバー時刻ずれ | `w32tm /resync` (Win) |
| `private_key format is invalid` | JSONが壊れている | 再ダウンロード |

---

## 補足: サーバー側の依存パッケージ

```bash
npm install firebase-admin dotenv
npm install -D @types/node
```

---

## 6. クライアント側の実装

クライアント（Web/モバイル）からFirebase認証を使用し、バックエンドAPIと連携する方法。

### 6.1 Firebase Client SDK セットアップ

#### Firebase Console でアプリ追加

1. Firebase Console → プロジェクト設定 → 「アプリを追加」
2. プラットフォーム選択（Web / iOS / Android）
3. 表示される設定情報をコピー

---

### 6.2 Web (JavaScript/TypeScript)

#### インストール

```bash
npm install firebase
```

#### 初期化 (`firebase-client.config.ts`)

```typescript
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Firebase Console → プロジェクト設定 → 全般 → マイアプリ から取得
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "my-project-dev.firebaseapp.com",
  projectId: "my-project-dev",
  storageBucket: "my-project-dev.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
```

#### ログイン & API呼び出し例

```typescript
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from './firebase-client.config';

// ログイン
const userCredential = await signInWithEmailAndPassword(auth, email, password);

// IDトークン取得（これをバックエンドに送信）
const idToken = await userCredential.user.getIdToken();

// バックエンドAPIを呼び出し
const response = await fetch('https://api.example.com/users/me', {
  headers: {
    'Authorization': `Bearer ${idToken}`
  }
});
```

---

### 6.3 Flutter (Dart)

#### インストール (`pubspec.yaml`)

```yaml
dependencies:
  firebase_core: ^2.24.0
  firebase_auth: ^4.16.0
```

#### 初期化 (`main.dart`)

```dart
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart'; // flutterfire configure で生成

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  runApp(MyApp());
}
```

#### ログイン & API呼び出し例

```dart
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

// ログイン
final credential = await FirebaseAuth.instance.signInWithEmailAndPassword(
  email: email,
  password: password,
);

// IDトークン取得
final idToken = await credential.user?.getIdToken();

// バックエンドAPIを呼び出し
final response = await http.get(
  Uri.parse('https://api.example.com/users/me'),
  headers: {'Authorization': 'Bearer $idToken'},
);
```

---

### 6.4 React Native

#### インストール

```bash
npm install @react-native-firebase/app @react-native-firebase/auth
```

#### ログイン & API呼び出し例

```typescript
import auth from '@react-native-firebase/auth';

// ログイン
const userCredential = await auth().signInWithEmailAndPassword(email, password);

// IDトークン取得
const idToken = await userCredential.user.getIdToken();

// バックエンドAPIを呼び出し
const response = await fetch('https://api.example.com/users/me', {
  headers: { 'Authorization': `Bearer ${idToken}` }
});
```

---

### 6.5 認証フロー図

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Client    │      │  Firebase   │      │  Backend    │
│ (Web/App)   │      │   Auth      │      │   Server    │
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │                    │                    │
       │ 1. ログイン要求    │                    │
       │ ─────────────────> │                    │
       │                    │                    │
       │ 2. ID Token返却    │                    │
       │ <───────────────── │                    │
       │                    │                    │
       │ 3. API呼び出し (Authorization: Bearer {token})
       │ ────────────────────────────────────────>
       │                    │                    │
       │                    │ 4. Token検証       │
       │                    │ <───────────────── │
       │                    │                    │
       │                    │ 5. 検証結果        │
       │                    │ ─────────────────> │
       │                    │                    │
       │ 6. APIレスポンス   │                    │
       │ <────────────────────────────────────────
       │                    │                    │
```

---

### 6.6 バックエンド認証ミドルウェア使用例

サーバー側でトークンを検証:

```typescript
// auth.middleware.ts から getAuth() を使用
import { getAuth } from '../config/firebase.config';

const auth = getAuth();
const decodedToken = await auth.verifyIdToken(idToken);
const uid = decodedToken.uid;  // Firebase UID
```

---

## チェックリスト

### サーバー側（Backend）

- [ ] Firebaseプロジェクト作成
- [ ] Authentication有効化（メール/パスワード等）
- [ ] サービスアカウントキーJSON取得
- [ ] JSONファイルをプロジェクトルートに配置
- [ ] `.gitignore`にJSON除外ルール追加
- [ ] `firebase-service-account.config.ts`をコピー
- [ ] `firebase.config.ts`をコピー
- [ ] `.env`に`FIREBASE_SERVICE_ACCOUNT_KEY_PATH`設定
- [ ] 診断スクリプトで動作確認

### クライアント側（Frontend/Mobile）

- [ ] Firebase Consoleでアプリ追加（Web/iOS/Android）
- [ ] Firebase Client SDKインストール
- [ ] firebaseConfig設定（Console→プロジェクト設定から取得）
- [ ] 認証機能実装（signIn/signUp）
- [ ] IDトークン取得 → Authorizationヘッダーに設定
- [ ] バックエンドAPI呼び出しテスト

---

## クイックリファレンス

### IDトークン取得（全プラットフォーム共通パターン）

| プラットフォーム | コード |
|-----------------|--------|
| Web JS | `await user.getIdToken()` |
| Flutter | `await user.getIdToken()` |
| React Native | `await user.getIdToken()` |
| iOS Swift | `try await user.getIDToken()` |
| Android Kotlin | `user.getIdToken(false).await()` |

### APIリクエストヘッダー

```
Authorization: Bearer {idToken}
```

---

*作成日: 2024-12 | TriPrizeプロジェクト成果物より*

