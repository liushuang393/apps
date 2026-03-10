# TriPrize Mobile App

Flutter製のクロスプラットフォームモバイルアプリ（iOS/Android/Web対応）

---

## 📍 開発・ビルド・デプロイの全体フロー

### 🔄 開発サイクル

```
【初回セットアップ】（新規プロジェクト時のみ）
├── 1. flutter pub get
├── 2. flutterfire configure --platforms=android,ios,web  ← 初回のみ
├── 3. .env ファイル作成
└── 4. flutter run -d chrome  ← 開発開始

【日常の開発作業】（毎回）
├── flutter run -d chrome  ← 開発・テスト
├── flutter run -d <device>  ← 実機テスト
└── flutter test  ← テスト実行

【本番ビルド前】（リリース時）
├── 1. .env を本番設定に更新
├── 2. flutterfire configure --project=production-id  ← 本番 Firebase 設定
├── 3. flutter clean && flutter pub get
└── 4. flutter build apk/ios/web --release  ← ビルド実行
```

### ⏰ いつ Firebase 設定コマンドを実行するか

| タイミング | コマンド | 説明 |
|----------|---------|------|
| **初回セットアップ時** | `flutterfire configure --platforms=android,ios,web` | プロジェクトを初めてクローンした時 |
| **Firebase プロジェクト変更時** | `flutterfire configure --project=new-project-id` | 開発/本番環境を切り替える時 |
| **新規プラットフォーム追加時** | `flutterfire configure --platforms=web` | Web サポートを追加する時 |
| **本番ビルド前** | `flutterfire configure --project=production-id` | 本番用 Firebase に切り替える時 |
| **設定ファイルが失われた時** | `flutterfire configure` | エラーが発生した時 |

**通常の開発作業では実行不要！** 初回セットアップ後は、Firebase プロジェクトを変更する時のみ実行してください。

---

## 📱 サポートプラットフォーム

- ✅ **Android** (API 21+)
- ✅ **iOS** (iOS 12+)
- ✅ **Web** (Chrome, Safari, Edge)

---

## 🛠️ 技術スタック

- **Flutter** 3.16+ / Dart 3.2+
- **Clean Architecture** (BLoC pattern)
- **Firebase Authentication**
- **Firebase Cloud Messaging** (Push通知)
- **Stripe Flutter SDK** (決済UI)
- **Dio** (HTTP client)
- **Provider** (状態管理)
- **GetIt** (依存性注入)

---

## 🚀 開発環境セットアップ

### 📋 初回セットアップ手順（新規プロジェクトの場合）

以下の手順を**初回のみ**実行してください：

1. **依存関係のインストール** → 2. **Firebase 設定** → 3. **環境変数設定** → 4. **アプリ起動**

---

### 1. 依存関係のインストール

```bash
cd mobile
flutter pub get
```

---

### 2. Firebase 設定（初回セットアップ時のみ必須）

**⚠️ 重要:** この手順は**初回セットアップ時**または**Firebase プロジェクトを変更する時**のみ必要です。
通常の開発作業では実行不要です。

#### 2.1 FlutterFire CLI のインストール（初回のみ）

```bash
# FlutterFire CLI をグローバルにインストール（初回のみ）
flutter pub global activate flutterfire_cli

# PATH に追加されていない場合、完全パスで実行
# Windows:
C:\Users\<ユーザー名>\AppData\Local\Pub\Cache\bin\flutterfire.bat configure

# または flutter pub global run を使用
flutter pub global run flutterfire_cli:flutterfire configure
```

#### 2.2 Firebase プロジェクトの設定（初回セットアップ時）

このプロジェクトは以下のプラットフォームをサポートしています：

**主要プラットフォーム（必須）:**
- ✅ **Android** - モバイルアプリ（必須）
- ✅ **iOS** - モバイルアプリ（必須）
- ✅ **Web** - Web アプリケーション（必須）

**追加プラットフォーム（オプション）:**
- macOS
- Windows

#### 2.3 Firebase 設定コマンド（初回セットアップ時のみ実行）

**🎯 開発環境での初回設定:**

```bash
# 全プラットフォームを一度に設定（推奨 - 初回セットアップ時）
flutterfire configure --platforms=android,ios,web

# または、対話形式で設定
flutterfire configure
```

**🔧 特定のプラットフォームのみ設定する場合:**

```bash
# Android のみ設定（Android 開発時）
flutterfire configure --platforms=android

# iOS のみ設定（iOS 開発時）
flutterfire configure --platforms=ios

# Web のみ設定（Web 開発時）
flutterfire configure --platforms=web
```

**📝 その他のオプション:**

```bash
# 特定の Firebase プロジェクトを指定
flutterfire configure --project=your-project-id

# 出力ファイルを指定（デフォルト: lib/firebase_options.dart）
flutterfire configure --out=lib/config/firebase_options.dart
```

#### 2.4 設定後の確認

設定が完了すると、以下のファイルが生成/更新されます：

- `lib/firebase_options.dart` - Firebase 設定ファイル（自動生成）
- `firebase.json` - Firebase プロジェクト設定
- `android/app/google-services.json` - Android 用設定（自動ダウンロード）
- `ios/Runner/GoogleService-Info.plist` - iOS 用設定（自動ダウンロード）

**注意:** これらのファイルは自動生成されるため、手動で編集しないでください。

**✅ 設定完了後は、通常の開発作業に進んでください。**

### 3. 環境変数ファイルの設定

`.env` ファイルを `mobile` ディレクトリに作成:

```env
# バックエンドAPIのベースURL
API_BASE_URL=http://localhost:3000

# Stripe公開可能キー（決済用）
STRIPE_PUBLISHABLE_KEY=pk_test_xxx

# Mock認証を使用するか（true: テスト用, false: 本番用）
USE_MOCK_AUTH=true

# デバッグログを有効にするか
ENABLE_DEBUG_LOGGING=true
```

**重要:** 
- `.env` ファイルは Git にコミットしないでください（既に `.gitignore` に追加済み）
- ローカル開発では `example.env` をコピーして使用できます

### 4. アプリの起動

#### 4.1 利用可能なデバイスの確認

```bash
# 接続されているデバイス/エミュレータを一覧表示
flutter devices
```

出力例：
```
3 connected devices:

Chrome (web) • chrome • web-javascript • Google Chrome 120.0.0.0
Windows (desktop) • windows • windows-x64 • Microsoft Windows [Version 10.0.19045.3803]
Edge (web) • edge • web-javascript • Microsoft Edge 120.0.0.0
```

#### 4.2 Web 版で起動（開発推奨 - 最速）

```bash
# Chrome で起動
flutter run -d chrome

# カスタムポートで起動
flutter run -d chrome --web-port=8888

# Edge で起動
flutter run -d edge

# リリースモードで起動（パフォーマンス向上）
flutter run -d chrome --release
```

**Web 版の注意事項:**
- Stripe 決済 UI は使用できません（API は使用可能）
- Push 通知は使用できません
- 開発時は最速で起動できます

#### 4.3 Android で起動

```bash
# エミュレータで起動
flutter run -d emulator-5554

# 実機で起動（USB デバッグ有効化が必要）
flutter run -d <device-id>

# デバッグモード（デフォルト）
flutter run -d <device-id> --debug

# プロファイルモード（パフォーマンス分析用）
flutter run -d <device-id> --profile

# リリースモード
flutter run -d <device-id> --release
```

**Android エミュレータの起動:**
```bash
# Android Studio からエミュレータを起動
# または
emulator -avd <avd_name>
```

#### 4.4 iOS で起動（macOS のみ）

```bash
# シミュレータで起動
flutter run -d "iPhone 15 Pro"

# 利用可能なシミュレータを確認
xcrun simctl list devices

# 特定のシミュレータで起動
flutter run -d <simulator-id>

# 実機で起動（開発者証明書が必要）
flutter run -d <device-id>
```

**iOS 実機での実行:**
1. Xcode で `ios/Runner.xcworkspace` を開く
2. 署名と機能を設定
3. 実機を接続して実行

#### 4.5 ホットリロードとホットリスタート

アプリ実行中：
- **`r`** - ホットリロード（変更を即座に反映）
- **`R`** - ホットリスタート（アプリを再起動）
- **`q`** - アプリを終了

### 5. 開発時の便利なコマンド

```bash
# アプリをクリーンして再ビルド
flutter clean
flutter pub get
flutter run

# 依存関係の更新
flutter pub upgrade

# コード分析
flutter analyze

# コードフォーマット
flutter format .

# テスト実行
flutter test
```

---

## 🧪 テストとコード品質

### Lintチェック

```bash
flutter analyze
```

### ユニットテスト実行

```bash
# 全テスト実行
flutter test

# カバレッジ付き
flutter test --coverage

# 特定のテストのみ
flutter test test/features/auth/presentation/providers/auth_provider_test.dart
```

### コードフォーマット

```bash
# フォーマットチェック
flutter format --set-exit-if-changed .

# フォーマット適用
flutter format .
```

---

## 📦 本番ビルド

### 🎯 ビルド前の準備チェックリスト

本番ビルドを実行する前に、以下の手順を**必ず**確認してください：

#### 1. 環境変数の確認と更新

```bash
# .env ファイルで本番用の設定を確認・更新
API_BASE_URL=https://api.yourdomain.com
STRIPE_PUBLISHABLE_KEY=pk_live_xxx  # 本番用キー（テストキーではない）
USE_MOCK_AUTH=false
ENABLE_DEBUG_LOGGING=false
```

#### 2. Firebase 設定の確認（本番ビルド前の必須ステップ）

**⚠️ 重要:** 本番ビルド前に、本番用 Firebase プロジェクトが正しく設定されているか確認してください。

```bash
# 本番用 Firebase プロジェクトに切り替え（開発環境と本番環境が異なる場合）
flutterfire configure --project=production-project-id --platforms=android,ios,web

# または、既存の設定を確認
# firebase.json と lib/firebase_options.dart を確認
```

**本番ビルド用の Firebase 設定確認:**

```bash
# Android 用の本番設定を確認
flutterfire configure --platforms=android --project=production-project-id

# iOS 用の本番設定を確認
flutterfire configure --platforms=ios --project=production-project-id

# Web 用の本番設定を確認
flutterfire configure --platforms=web --project=production-project-id
```

**確認事項:**
- ✅ `lib/firebase_options.dart` に本番用のプロジェクト ID が設定されているか
- ✅ `android/app/google-services.json` が本番用か（開発用ではないか）
- ✅ `ios/Runner/GoogleService-Info.plist` が本番用か（開発用ではないか）

#### 3. 依存関係の更新

```bash
flutter pub get
flutter pub upgrade
```

#### 4. ビルド前の最終確認

```bash
# コード分析
flutter analyze

# テスト実行
flutter test

# クリーンビルド（キャッシュをクリア）
flutter clean
flutter pub get
```

### Android ビルド

#### Debug ビルド（テスト用）

```bash
# Debug APK
flutter build apk --debug

# ビルド成果物: build/app/outputs/flutter-apk/app-debug.apk
```

#### Release ビルド（本番用）

```bash
# Release APK（直接配布用）
flutter build apk --release

# Release App Bundle（Google Play Store 推奨）
flutter build appbundle --release

# 複数の ABI 用に APK を分割（サイズ削減）
flutter build apk --release --split-per-abi

# 特定の ABI のみビルド
flutter build apk --release --target-platform android-arm64
flutter build apk --release --target-platform android-x64
```

**ビルド成果物の場所:**
- APK: `build/app/outputs/flutter-apk/app-release.apk`
- AAB: `build/app/outputs/bundle/release/app-release.aab`
- 分割 APK: `build/app/outputs/flutter-apk/app-armeabi-v7a-release.apk` など

**署名設定:**
1. `android/key.properties` を作成（既に `.gitignore` に追加済み）
2. キーストアファイルを配置（`android/app/triprize.jks`）
3. `android/app/build.gradle` で署名設定を確認

#### ビルドオプション

```bash
# ビルド番号を指定
flutter build apk --release --build-number=2

# バージョン名を指定
flutter build apk --release --build-name=1.0.0

# カスタムフレーバー（複数のビルド設定がある場合）
flutter build apk --release --flavor=production
```

### iOS ビルド（macOS のみ）

#### Debug ビルド

```bash
# Debug ビルド
flutter build ios --debug

# シミュレータ用ビルド
flutter build ios --debug --simulator
```

#### Release ビルドと配布

```bash
# Release ビルド
flutter build ios --release

# ビルド番号とバージョン名を指定
flutter build ios --release --build-number=2 --build-name=1.0.0
```

**App Store への配布手順:**

1. **Xcode で Archive を作成**
   ```bash
   # Xcode を開く
   open ios/Runner.xcworkspace
   
   # Xcode で:
   # 1. Product > Scheme > Runner を選択
   # 2. Product > Destination > Any iOS Device を選択
   # 3. Product > Archive を実行
   ```

2. **Archive の検証と配布**
   - Xcode Organizer で Archive を選択
   - "Validate App" で検証
   - "Distribute App" で App Store Connect にアップロード

3. **TestFlight でのテスト**
   - App Store Connect で TestFlight を設定
   - ベータテスターに配布

**実機でのテスト:**
```bash
# 実機に直接インストール（開発者証明書が必要）
flutter install --release
```

### Web ビルド

#### Debug ビルド（開発用）

```bash
# Debug ビルド
flutter build web --debug

# ビルド成果物: build/web/
```

#### Release ビルド（本番用）

```bash
# Release ビルド（最適化済み）
flutter build web --release

# カナリアチャネル（最新機能）を使用
flutter build web --release --dart-define=FLUTTER_WEB_CANVASKIT_URL=...

# ビルド成果物: build/web/
```

**ビルド成果物の内容:**
```
build/web/
├── index.html          # エントリーポイント
├── main.dart.js       # コンパイルされた Dart コード
├── assets/            # アセットファイル
└── ...
```

#### Web デプロイ

**Firebase Hosting へのデプロイ:**
```bash
# Firebase CLI がインストールされている場合
firebase deploy --only hosting

# または、build/web/ を手動でアップロード
```

**その他のホスティングサービス:**
- **Vercel**: `build/web/` をドラッグ&ドロップ
- **Netlify**: `build/web/` をデプロイ
- **GitHub Pages**: `build/web/` を `gh-pages` ブランチにプッシュ
- **AWS S3 + CloudFront**: `build/web/` を S3 バケットにアップロード

**Web ビルドの最適化:**
```bash
# カナリアチャネルを使用（最新の最適化）
flutter build web --release --dart-define=FLUTTER_WEB_CANVASKIT_URL=https://unpkg.com/canvaskit-wasm@latest/bin/

# ベース URL を指定（サブディレクトリにデプロイする場合）
flutter build web --release --base-href=/your-app-path/
```

### ビルドモードの比較

| モード | 用途 | パフォーマンス | サイズ | デバッグ情報 |
|--------|------|---------------|--------|------------|
| **Debug** | 開発・テスト | 遅い | 大きい | あり |
| **Profile** | パフォーマンス分析 | 中 | 中 | 一部 |
| **Release** | 本番配布 | 速い | 小さい | なし |

### ビルド後の確認事項

1. **ビルドサイズの確認**
   ```bash
   # APK サイズを確認
   ls -lh build/app/outputs/flutter-apk/app-release.apk
   
   # Web ビルドサイズを確認
   du -sh build/web/
   ```

2. **動作確認**
   - 各プラットフォームで実際にアプリを起動
   - 主要機能が正常に動作するか確認
   - パフォーマンステストを実行

3. **セキュリティチェック**
   - API キーがハードコードされていないか確認
   - `.env` ファイルがビルドに含まれていないか確認
   - デバッグモードが無効になっているか確認

---

## 🎨 プロジェクト構造

```
lib/
├── core/                    # コア機能
│   ├── constants/          # 定数（テーマ、APIなど）
│   ├── di/                 # 依存性注入設定
│   ├── network/            # API client, interceptors
│   └── utils/              # ユーティリティ（logger等）
├── features/               # 機能別モジュール
│   ├── auth/               # 認証機能
│   │   ├── data/           # データ層（API, models）
│   │   ├── domain/         # ドメイン層（entities, repos）
│   │   └── presentation/   # プレゼンテーション層（UI, providers）
│   ├── campaign/           # キャンペーン機能
│   ├── purchase/           # 購入機能
│   └── lottery/            # 抽選機能
├── firebase_options.dart   # Firebase設定（自動生成）
└── main.dart               # エントリーポイント
```

---

## 🔧 開発中のトラブルシューティング

### 1. Stripe初期化エラー（Web）

**エラー:** `Unsupported operation: Platform._operatingSystem`

**原因:** Stripe SDKはWeb非対応

**解決済み:** `main.dart` で Web プラットフォーム検出時に Stripe 初期化をスキップ

### 2. Firebase設定エラー

**エラー:** `FirebaseOptions not found`

**原因:** Firebase 設定ファイルが生成されていない、または設定が失われた

**解決方法（開発時）:**
```bash
# 開発環境用の Firebase 設定を再生成
flutterfire configure --platforms=android,ios,web

# または、対話形式で設定
flutterfire configure

# PATH に追加されていない場合
flutter pub global run flutterfire_cli:flutterfire configure
```

**エラー:** `'flutterfire' is not recognized`

**解決方法:**
```bash
# 方法1: flutter pub global run を使用（推奨）
flutter pub global run flutterfire_cli:flutterfire configure

# 方法2: 完全パスで実行（Windows）
C:\Users\<ユーザー名>\AppData\Local\Pub\Cache\bin\flutterfire.bat configure

# 方法3: PATH 環境変数に追加（推奨）
# システム環境変数の Path に以下を追加:
# C:\Users\<ユーザー名>\AppData\Local\Pub\Cache\bin
```

**エラー:** ビルド時に Firebase 設定が見つからない

**解決方法（本番ビルド前）:**
```bash
# 1. Firebase 設定を再生成
flutterfire configure --platforms=android,ios,web --project=your-project-id

# 2. 生成されたファイルを確認
cat lib/firebase_options.dart
ls android/app/google-services.json
ls ios/Runner/GoogleService-Info.plist

# 3. クリーンビルド
flutter clean
flutter pub get
flutter build apk --release  # または build ios/web
```

### 3. ビルドエラー

```bash
# クリーンビルド
flutter clean
flutter pub get
flutter run

# Android ビルドエラーの場合
cd android
./gradlew clean
cd ..
flutter build apk --release

# iOS ビルドエラーの場合（macOS のみ）
cd ios
pod deintegrate
pod install
cd ..
flutter build ios --release
```

### 5. プラットフォーム固有のエラー

**Android:**
```bash
# Gradle のキャッシュをクリア
cd android
./gradlew clean
cd ..

# ビルドツールのバージョンを確認
# android/app/build.gradle を確認
```

**iOS:**
```bash
# CocoaPods のキャッシュをクリア
cd ios
pod cache clean --all
pod deintegrate
pod install
cd ..

# Xcode の DerivedData をクリア
rm -rf ~/Library/Developer/Xcode/DerivedData
```

**Web:**
```bash
# Web ビルドのキャッシュをクリア
flutter clean
flutter pub get
flutter build web --release
```

### 4. Hot Reloadが効かない

```bash
# アプリをHot Restartで再起動
# ターミナルで 'R' キーを押す
```

---

## 📝 重要な注意事項

### Web版の制約

- ❌ Stripe決済UI不可（APIは使用可能）
- ❌ Push通知不可
- ❌ ファイルピッカーの機能制限あり

### プラットフォーム固有のセットアップ

#### Android
- `android/key.properties` で署名設定（本番ビルド時）
- Google Play Services APIキー設定

#### iOS
- `ios/Runner.xcworkspace` を Xcode で開いて署名設定
- Apple Developer アカウントが必要（本番配布時）

---

## 🔐 セキュリティ

### 機密情報の管理

**絶対にGitにコミットしないファイル:**
- `.env` (実際の API キー、シークレット)
- `android/key.properties` (Android 署名情報)
- `android/app/triprize.jks` (Android キーストア)
- `ios/Runner.xcarchive` (iOS Archive)
- `google-services.json` (本番Firebase設定)
- `GoogleService-Info.plist` (本番Firebase設定)

これらは既に `.gitignore` に追加済みです。

---

## 📚 参考資料

- [Flutter公式ドキュメント](https://docs.flutter.dev/)
- [Firebase for Flutter](https://firebase.google.com/docs/flutter/setup)
- [Stripe Flutter SDK](https://docs.stripe.com/payments/accept-a-payment?platform=flutter)
- [Clean Architecture in Flutter](https://resocoder.com/flutter-clean-architecture-tdd/)

---

## 🆘 サポート

問題が発生した場合は、プロジェクトルートの [README.md](../README.md) のトラブルシューティングセクションを参照してください。
