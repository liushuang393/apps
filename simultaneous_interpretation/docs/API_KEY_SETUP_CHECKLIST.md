# API Key 設定チェックリスト

このチェックリストを使用して、API Key の設定が正しく完了したか確認してください。

---

## ✅ 事前準備

- [ ] Node.js 20+ がインストールされている
- [ ] npm 9+ がインストールされている
- [ ] リポジトリをクローンした
- [ ] `npm install` を実行した

---

## 🔑 OpenAI API Key（必須）

### Step 1: アカウント作成
- [ ] OpenAI アカウントを作成した
  - URL: https://platform.openai.com/signup
- [ ] メール認証を完了した

### Step 2: API Key 取得
- [ ] OpenAI Platform にログインした
  - URL: https://platform.openai.com/
- [ ] API Keys ページにアクセスした
  - URL: https://platform.openai.com/api-keys
- [ ] 新しい API Key を作成した
  - 名前: "VoiceTranslate Pro"
- [ ] API Key をコピーして安全な場所に保存した
  - 形式: `sk-proj-...` または `sk-...`

### Step 3: 支払い設定
- [ ] Billing ページにアクセスした
  - URL: https://platform.openai.com/account/billing/overview
- [ ] クレジットカードを登録した
- [ ] 使用量制限を設定した（推奨: $10-50/月）

### Step 4: 動作確認
- [ ] API Key が有効であることを確認した
- [ ] 使用量が確認できることを確認した

---

## 🔧 環境変数設定

### 方法 1: .env ファイル（推奨）

- [ ] `.env.example` を `.env` にコピーした
  ```bash
  cp .env.example .env
  ```

- [ ] `.env` ファイルを編集した
  ```bash
  # Windows
  notepad .env
  
  # macOS/Linux
  nano .env
  ```

- [ ] OpenAI API Key を設定した
  ```env
  OPENAI_API_KEY=sk-proj-your-actual-api-key-here
  ```

- [ ] `.env` ファイルが `.gitignore` に含まれていることを確認した
  ```bash
  cat .gitignore | grep .env
  ```

### 方法 2: システム環境変数

#### Windows
- [ ] システム環境変数を開いた
  - 「システムのプロパティ」→「環境変数」
- [ ] 新しいユーザー環境変数を追加した
  - 変数名: `OPENAI_API_KEY`
  - 変数値: `sk-proj-...`
- [ ] コマンドプロンプトを再起動した

#### macOS/Linux
- [ ] `.bashrc` または `.zshrc` を編集した
  ```bash
  echo 'export OPENAI_API_KEY="sk-proj-..."' >> ~/.bashrc
  source ~/.bashrc
  ```

---

## 🧪 動作確認

### 1. 環境変数の確認

- [ ] 環境変数が設定されていることを確認した
  ```bash
  # Windows (PowerShell)
  echo $env:OPENAI_API_KEY
  
  # macOS/Linux
  echo $OPENAI_API_KEY
  ```

- [ ] 出力が `sk-proj-...` または `sk-...` で始まることを確認した

### 2. Node.js から確認

- [ ] Node.js で環境変数を読み込めることを確認した
  ```bash
  node -e "console.log(process.env.OPENAI_API_KEY)"
  ```

- [ ] API Key が表示されることを確認した

### 3. API 接続テスト

- [ ] OpenAI API に接続できることを確認した
  ```bash
  curl https://api.openai.com/v1/models \
    -H "Authorization: Bearer $OPENAI_API_KEY"
  ```

- [ ] ステータスコード 200 が返ることを確認した
- [ ] モデルリストが表示されることを確認した

### 4. アプリケーションテスト

- [ ] テストを実行した
  ```bash
  npm test
  ```

- [ ] テストが成功することを確認した
  - 期待: `Tests: 324 passed`

- [ ] Electron アプリを起動した
  ```bash
  npm run electron:dev
  ```

- [ ] アプリが正常に起動することを確認した
- [ ] エラーがコンソールに表示されないことを確認した

---

## 📊 最終確認

### セキュリティチェック

- [ ] `.env` ファイルが `.gitignore` に含まれている
- [ ] API Key をハードコードしていない
- [ ] API Key をスクリーンショットに含めていない
- [ ] API Key を他人と共有していない

### 機能チェック

- [ ] OpenAI API に接続できる
- [ ] テストが全て成功する
- [ ] Electron アプリが起動する
- [ ] エラーログがない

---

## 🎉 完了

全てのチェックボックスにチェックが入ったら、以下を実行してください：

1. **開発者に報告**
   ```
   環境設定完了しました。
   - OpenAI API Key: 設定済み
   - テスト結果: 324/324 passed
   - Electron アプリ: 正常起動
   ```

2. **次のステップ**
   - 開発者が実際の API テストを実行します
   - 音声認識・翻訳の動作確認を行います
   - パフォーマンステストを実施します

---

## ❌ トラブルシューティング

### 問題: API Key が無効

**症状**:
```
Error: Invalid API Key
Status: 401 Unauthorized
```

**確認事項**:
- [ ] API Key が正しくコピーされているか
- [ ] API Key の前後にスペースがないか
- [ ] OpenAI Platform で API Key が有効か
- [ ] 支払い方法が設定されているか
- [ ] 使用量制限に達していないか

**解決方法**:
1. OpenAI Platform で API Key を再確認
2. 新しい API Key を作成
3. `.env` ファイルを更新
4. アプリケーションを再起動

### 問題: 環境変数が読み込めない

**症状**:
```
process.env.OPENAI_API_KEY is undefined
```

**確認事項**:
- [ ] `.env` ファイルが存在するか
- [ ] `.env` ファイルが正しい場所にあるか（`app2/` ディレクトリ）
- [ ] `.env` ファイルの形式が正しいか
- [ ] アプリケーションを再起動したか

**解決方法**:
1. `.env` ファイルの場所を確認
   ```bash
   ls -la .env
   ```
2. `.env` ファイルの内容を確認
   ```bash
   cat .env
   ```
3. アプリケーションを再起動

### 問題: テストが失敗する

**症状**:
```
Tests: 5 failed, 319 passed, 324 total
```

**確認事項**:
- [ ] API Key が設定されているか
- [ ] インターネット接続があるか
- [ ] ファイアウォールがブロックしていないか

**解決方法**:
1. API Key を確認
2. インターネット接続を確認
3. ファイアウォール設定を確認
4. テストを再実行

---

## 📞 サポート

問題が解決しない場合は、以下の情報を含めて開発者に連絡してください：

1. **エラーメッセージ**
   - 完全なエラーメッセージをコピー

2. **環境情報**
   ```bash
   node --version
   npm --version
   echo $OPENAI_API_KEY | cut -c1-10
   ```

3. **ログファイル**
   - `logs/` ディレクトリのログファイル
   - API Key は削除してから共有

---

**最終更新日**: 2024-12-XX  
**バージョン**: 2.0.0

