# VoiceTranslate Pro 環境設定手順書

## 📋 目次

1. [システム要件](#システム要件)
2. [開発環境セットアップ](#開発環境セットアップ)
3. [API Key 取得と設定](#api-key-取得と設定)
4. [アプリケーション設定](#アプリケーション設定)
5. [動作確認](#動作確認)
6. [トラブルシューティング](#トラブルシューティング)

---

## システム要件

### 最小要件
- **OS**: Windows 10+, macOS 10.15+, Ubuntu 20.04+
- **Node.js**: 20.0.0 以上
- **npm**: 9.0.0 以上
- **RAM**: 4GB 以上
- **ディスク**: 1GB 以上の空き容量

### 推奨要件
- **OS**: Windows 11, macOS 12+, Ubuntu 22.04+
- **Node.js**: 20.10.0 以上
- **npm**: 10.0.0 以上
- **RAM**: 8GB 以上
- **ディスク**: 2GB 以上の空き容量

---

## 開発環境セットアップ

### 1. プロジェクトディレクトリへ移動

```bash
# プロジェクトディレクトリへ移動
cd teams-translator/app2
```

### 2. 依存パッケージのインストール

```bash
# npm パッケージをインストール
npm install

# インストール確認
npm list --depth=0
```

**期待される出力**:
```
app2@1.0.0
├── @types/jest@29.5.12
├── @types/node@20.11.19
├── electron@28.2.3
├── jest@29.7.0
├── typescript@5.3.3
└── ... (その他のパッケージ)
```

### 3. TypeScript コンパイル確認

```bash
# TypeScript コンパイル
npm run build

# Electron コード コンパイル
npm run build:electron
```

**期待される出力**:
```
> app2@1.0.0 build
> tsc

(エラーなし)
```

---

## API Key 取得と設定

### 🔑 必要な API Key

VoiceTranslate Pro を動作させるには、以下の API Key が必要です：

1. **OpenAI API Key** (必須)
2. **Azure Speech Services Key** (オプション)
3. **Google Cloud Translation API Key** (オプション)

---

### 1. OpenAI API Key の取得（必須）

#### Step 1: OpenAI アカウント作成

1. **OpenAI 公式サイトにアクセス**
   - URL: https://platform.openai.com/signup

2. **アカウント登録**
   - メールアドレスで登録
   - または Google/Microsoft アカウントで登録

3. **メール認証**
   - 登録メールアドレスに届いた確認メールをクリック

#### Step 2: API Key 作成

1. **OpenAI Platform にログイン**
   - URL: https://platform.openai.com/

2. **API Keys ページに移動**
   - 左メニューから「API keys」をクリック
   - または直接アクセス: https://platform.openai.com/api-keys

3. **新しい API Key を作成**
   - 「Create new secret key」ボタンをクリック
   - Key の名前を入力（例: "VoiceTranslate Pro"）
   - 「Create secret key」をクリック

4. **API Key をコピー**
   - ⚠️ **重要**: この画面でしか表示されません！
   - API Key をコピーして安全な場所に保存
   - 形式: `sk-proj-...` または `sk-...`

#### Step 3: 使用量制限の確認

1. **Billing ページにアクセス**
   - URL: https://platform.openai.com/account/billing/overview

2. **支払い方法を設定**
   - クレジットカードを登録
   - 使用量制限を設定（推奨: $10-50/月）

3. **使用量を確認**
   - Realtime API の料金: 約 $0.06/分（音声入力）
   - 推奨予算: 月 $20-50

---

### 2. Azure Speech Services Key の取得（オプション）

#### Step 1: Azure アカウント作成

1. **Azure Portal にアクセス**
   - URL: https://portal.azure.com/

2. **無料アカウント作成**
   - 「無料で始める」をクリック
   - Microsoft アカウントでサインイン

#### Step 2: Speech Services リソース作成

1. **リソースの作成**
   - 「リソースの作成」をクリック
   - 「Speech」を検索

2. **Speech Services を作成**
   - サブスクリプション: 選択
   - リソースグループ: 新規作成（例: "voicetranslate-rg"）
   - リージョン: 選択（例: "Japan East"）
   - 名前: 入力（例: "voicetranslate-speech"）
   - 価格レベル: Free F0（月 5 時間無料）

3. **API Key を取得**
   - リソース作成後、「キーとエンドポイント」をクリック
   - KEY 1 または KEY 2 をコピー
   - リージョンもメモ（例: "japaneast"）

---

### 3. Google Cloud Translation API Key の取得（オプション）

#### Step 1: Google Cloud アカウント作成

1. **Google Cloud Console にアクセス**
   - URL: https://console.cloud.google.com/

2. **無料トライアル開始**
   - 「無料で開始」をクリック
   - Google アカウントでサインイン

#### Step 2: プロジェクト作成

1. **新しいプロジェクトを作成**
   - プロジェクト名: "VoiceTranslate Pro"
   - プロジェクト ID: 自動生成

#### Step 3: Translation API を有効化

1. **API ライブラリにアクセス**
   - 左メニュー → 「API とサービス」 → 「ライブラリ」

2. **Cloud Translation API を検索**
   - 「Cloud Translation API」を選択
   - 「有効にする」をクリック

#### Step 4: API Key を作成

1. **認証情報ページにアクセス**
   - 左メニュー → 「API とサービス」 → 「認証情報」

2. **API Key を作成**
   - 「認証情報を作成」 → 「API キー」
   - API Key をコピー

3. **API Key を制限（推奨）**
   - 「キーを制限」をクリック
   - アプリケーションの制限: なし
   - API の制限: Cloud Translation API のみ

---

## アプリケーション設定

### 方法 1: 環境変数ファイル（推奨）

#### Step 1: .env ファイルを作成

```bash
# app2 ディレクトリで実行
cd teams-translator/app2
touch .env
```

#### Step 2: .env ファイルを編集

```bash
# Windows
notepad .env

# macOS/Linux
nano .env
# または
code .env
```

#### Step 3: API Key を設定

`.env` ファイルに以下を記述：

```env
# OpenAI API Key（必須）
OPENAI_API_KEY=sk-proj-your-actual-api-key-here

# Azure Speech Services（オプション）
AZURE_SPEECH_KEY=your-azure-speech-key-here
AZURE_SPEECH_REGION=japaneast

# Google Cloud Translation（オプション）
GOOGLE_TRANSLATION_API_KEY=your-google-api-key-here

# アプリケーション設定
NODE_ENV=development
LOG_LEVEL=INFO
```

**⚠️ 重要**:
- `your-actual-api-key-here` を実際の API Key に置き換える
- `.env` ファイルは `.gitignore` に含まれているため Git にコミットされません
- API Key は絶対に公開しないでください

#### Step 4: .env ファイルの確認

```bash
# .env ファイルが存在することを確認
ls -la .env

# 内容を確認（API Key が設定されているか）
cat .env
```

---

### 方法 2: アプリケーション UI から設定

#### Step 1: アプリケーションを起動

```bash
# 開発モードで起動
npm run electron:dev
```

#### Step 2: 設定画面を開く

1. アプリケーションが起動したら
2. メニューから「設定」をクリック
3. 「API Keys」タブを選択

#### Step 3: API Key を入力

1. **OpenAI API Key**
   - フィールドに API Key を貼り付け
   - 「保存」をクリック

2. **Azure Speech Key**（オプション）
   - フィールドに API Key を貼り付け
   - リージョンを選択
   - 「保存」をクリック

3. **Google Translation Key**（オプション）
   - フィールドに API Key を貼り付け
   - 「保存」をクリック

**セキュリティ**:
- API Key は AES-256-GCM で暗号化されて保存されます
- 保存場所: `%APPDATA%/VoiceTranslatePro/config.json`（暗号化済み）

---

### 方法 3: 設定ファイル（非推奨）

⚠️ **セキュリティリスク**: この方法は推奨されません

```bash
# config.json を作成
cd teams-translator/app2
touch config.json
```

`config.json`:
```json
{
  "apiKeys": {
    "openai": "sk-proj-your-actual-api-key-here",
    "azure": {
      "key": "your-azure-key",
      "region": "japaneast"
    },
    "google": "your-google-key"
  }
}
```

---

## 動作確認

### 1. テスト実行

```bash
# 全テストを実行
npm test

# カバレッジ付きテスト
npm test -- --coverage

# 特定のテストのみ実行
npm test -- WebSocketManager.test
```

**期待される出力**:
```
Test Suites: 15 passed, 15 total
Tests:       324 passed, 324 total
Snapshots:   0 total
Time:        38.421 s
```

### 2. Electron アプリ起動

```bash
# 開発モードで起動
npm run electron:dev
```

**期待される動作**:
1. Electron ウィンドウが開く
2. システムトレイにアイコンが表示される
3. エラーがコンソールに表示されない

### 3. API 接続テスト

#### OpenAI API テスト

```bash
# Node.js で簡易テスト
node -e "
const https = require('https');
const apiKey = process.env.OPENAI_API_KEY;

const options = {
  hostname: 'api.openai.com',
  path: '/v1/models',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + apiKey
  }
};

https.get(options, (res) => {
  console.log('Status:', res.statusCode);
  if (res.statusCode === 200) {
    console.log('✅ OpenAI API 接続成功');
  } else {
    console.log('❌ OpenAI API 接続失敗');
  }
}).on('error', (e) => {
  console.error('❌ エラー:', e.message);
});
"
```

**期待される出力**:
```
Status: 200
✅ OpenAI API 接続成功
```

### 4. 音声デバイステスト

アプリケーション起動後：

1. **マイクテスト**
   - 「設定」→「音声デバイス」
   - マイクを選択
   - 「テスト」ボタンをクリック
   - 音声レベルメーターが動くことを確認

2. **システム音声テスト**
   - 「設定」→「システム音声」
   - 音声ソースを選択
   - 「テスト」ボタンをクリック

---

## トラブルシューティング

### 問題 1: API Key が無効

**症状**:
```
Error: Invalid API Key
Status: 401 Unauthorized
```

**解決方法**:
1. API Key が正しくコピーされているか確認
2. API Key の前後にスペースがないか確認
3. OpenAI Platform で API Key が有効か確認
4. 使用量制限に達していないか確認

### 問題 2: npm install エラー

**症状**:
```
npm ERR! code ENOENT
npm ERR! syscall open
```

**解決方法**:
```bash
# npm キャッシュをクリア
npm cache clean --force

# node_modules を削除
rm -rf node_modules package-lock.json

# 再インストール
npm install
```

### 問題 3: Electron が起動しない

**症状**:
```
Error: Electron failed to install correctly
```

**解決方法**:
```bash
# Electron を再インストール
npm install electron --save-dev

# または
npx electron-rebuild
```

### 問題 4: TypeScript コンパイルエラー

**症状**:
```
error TS2307: Cannot find module
```

**解決方法**:
```bash
# 型定義をインストール
npm install --save-dev @types/node @types/jest

# tsconfig.json を確認
cat tsconfig.json
```

### 問題 5: マイクが認識されない

**症状**:
- マイクリストが空
- 音声が取得できない

**解決方法**:
1. **ブラウザの権限を確認**
   - Chrome: chrome://settings/content/microphone
   - 許可されているか確認

2. **システムの権限を確認**
   - Windows: 設定 → プライバシー → マイク
   - macOS: システム環境設定 → セキュリティとプライバシー → マイク
   - アプリに権限が付与されているか確認

3. **デバイスドライバを確認**
   - デバイスマネージャーでマイクが認識されているか

---

## 次のステップ

### 環境設定完了後

1. **テスト実行**
   ```bash
   npm test
   ```

2. **開発者に報告**
   - 「環境設定完了しました」と報告
   - テスト結果を共有
   - API Key が正常に動作しているか確認

3. **実際の API テスト実行**
   - 開発者が実際の OpenAI API を使用したテストを実行
   - 音声認識・翻訳の動作確認
   - パフォーマンステスト

---

## セキュリティ注意事項

### ⚠️ 絶対にやってはいけないこと

1. **API Key を公開しない**
   - GitHub にコミットしない
   - スクリーンショットに含めない
   - チャットに貼り付けない

2. **API Key を共有しない**
   - 他人に教えない
   - メールで送信しない

3. **API Key をハードコードしない**
   - ソースコードに直接書かない
   - 環境変数または暗号化ストレージを使用

### ✅ 推奨されるセキュリティ対策

1. **環境変数を使用**
   - `.env` ファイルを使用
   - `.gitignore` に `.env` を追加

2. **API Key を定期的にローテーション**
   - 3-6 ヶ月ごとに新しい Key を作成
   - 古い Key を削除

3. **使用量を監視**
   - OpenAI Dashboard で使用量を確認
   - 異常な使用量があれば Key を無効化

---

## サポート

### 問題が解決しない場合

1. **ログを確認**
   ```bash
   # ログファイルの場所
   # Windows: %APPDATA%/VoiceTranslatePro/logs/
   # macOS: ~/Library/Application Support/VoiceTranslatePro/logs/
   # Linux: ~/.config/VoiceTranslatePro/logs/
   ```

2. **Issue を作成**
   - GitHub Issues にバグレポートを作成
   - ログファイルを添付（API Key は削除）

3. **開発者に連絡**
   - 詳細なエラーメッセージを共有
   - 環境情報を共有（OS、Node.js バージョンなど）

---

**最終更新日**: 2024-12-XX  
**バージョン**: 2.0.0  
**作成者**: VoiceTranslate Pro Team

