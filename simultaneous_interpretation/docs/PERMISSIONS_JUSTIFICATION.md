# VoiceTranslate Pro - 権限の使用説明

## 概要

このドキュメントは、VoiceTranslate Pro がChrome Web Storeで要求する各権限の使用目的と正当性を説明します。Chrome Web Storeのレビュー時に参照してください。

---

## 要求する権限

### 1. `storage`

**目的**: APIキーと設定の永続化

**使用方法**:
- `chrome.storage.local` APIを使用してローカルストレージに保存
- 保存するデータ:
  - OpenAI APIキー（AES-256-GCM暗号化）
  - ユーザー設定（言語設定、VAD感度など）
  - 翻訳履歴（オプション）

**コード例**:
```javascript
// APIキーの保存
chrome.storage.local.set({ apiKey: encryptedApiKey });

// 設定の保存
chrome.storage.local.set({ 
  sourceLang: 'ja', 
  targetLang: 'en',
  vadSensitivity: 'medium'
});
```

**正当性**:
- ユーザーがAPIキーを毎回入力する必要がないようにするため
- ユーザー設定を保存して、次回起動時に復元するため
- 翻訳履歴を保存して、ユーザーの利便性を向上させるため

---

### 2. `activeTab`

**目的**: アクティブタブへのアクセス

**使用方法**:
- タブ音声のキャプチャ（会議アプリ対応）
- 現在アクティブなタブの情報を取得

**コード例**:
```javascript
// アクティブタブの取得
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const activeTab = tabs[0];
  // タブ音声のキャプチャ処理
});
```

**正当性**:
- Teams、Zoom等のオンライン会議の音声をキャプチャするため
- ユーザーが現在使用しているタブの音声のみをキャプチャするため
- プライバシー保護: アクティブタブのみにアクセス、他のタブにはアクセスしない

---

### 3. `scripting`

**目的**: コンテンツスクリプトの動的注入

**使用方法**:
- 必要に応じてタブにスクリプトを注入
- 会議アプリの音声キャプチャ機能を有効化

**コード例**:
```javascript
// コンテンツスクリプトの注入
chrome.scripting.executeScript({
  target: { tabId: activeTab.id },
  files: ['content-script.js']
});
```

**正当性**:
- 会議アプリ（Teams、Zoom）の音声をキャプチャするため
- ユーザーが明示的に翻訳を開始した場合のみスクリプトを注入
- 不要なタブにはスクリプトを注入しない

---

### 4. `tabCapture`

**目的**: タブ音声のキャプチャ

**使用方法**:
- `chrome.tabCapture` APIを使用してタブの音声ストリームを取得
- 取得した音声をOpenAI Realtime APIに送信して翻訳

**コード例**:
```javascript
// タブ音声のキャプチャ
chrome.tabCapture.capture({
  audio: true,
  video: false
}, (stream) => {
  // 音声ストリームをOpenAI APIに送信
  sendAudioToOpenAI(stream);
});
```

**正当性**:
- オンライン会議（Teams、Zoom、Google Meet）の音声をリアルタイムで翻訳するため
- ユーザーが明示的に「録音開始」ボタンをクリックした場合のみキャプチャ
- 音声データは一切保存せず、リアルタイム処理のみ

**重要な注意**:
- 音声データはローカルストレージに保存されません
- 音声データはOpenAI APIにのみ送信されます
- ユーザーが「録音停止」ボタンをクリックすると、即座にキャプチャを停止します

---

## ホスト権限

### 1. `https://api.openai.com/*`

**目的**: OpenAI APIへのHTTPSリクエスト

**使用方法**:
- Chat Completions API（テキスト翻訳、言語検出）
- APIキーの検証

**正当性**:
- テキスト翻訳機能を提供するため
- 言語自動検出機能を提供するため

---

### 2. `wss://api.openai.com/*`

**目的**: OpenAI Realtime APIへのWebSocket接続

**使用方法**:
- リアルタイム音声認識
- リアルタイム音声翻訳

**正当性**:
- リアルタイム音声翻訳機能を提供するため
- 低レイテンシの音声処理を実現するため

---

## 権限の最小化

VoiceTranslate Pro は、**最小権限の原則**に従い、必要最小限の権限のみを要求しています。

### 要求しない権限

以下の権限は**要求していません**：

- ❌ `cookies`: Cookie情報にアクセスしない
- ❌ `history`: 閲覧履歴にアクセスしない
- ❌ `bookmarks`: ブックマークにアクセスしない
- ❌ `tabs`: すべてのタブ情報にアクセスしない（`activeTab`のみ）
- ❌ `webRequest`: ネットワークリクエストを傍受しない
- ❌ `geolocation`: 位置情報にアクセスしない
- ❌ `notifications`: 通知を送信しない（拡張機能内の通知のみ）

---

## セキュリティとプライバシー

### データ保護

1. **APIキーの暗号化**
   - AES-256-GCM暗号化を使用
   - 開発者はAPIキーにアクセスできません

2. **音声データの保護**
   - 音声データは一切保存されません
   - リアルタイム処理のみ
   - OpenAI APIにのみ送信

3. **通信の暗号化**
   - HTTPS/WSS（エンドツーエンド暗号化）
   - 中間者攻撃を防止

### プライバシーポリシー

詳細なプライバシーポリシーは、以下のURLで公開されています：

- **GitHub**: https://github.com/liushuang393/voicetranslate-pro/blob/main/PRIVACY_POLICY.md
- **GitHub Pages**: https://liushuang393.github.io/voicetranslate-pro/PRIVACY_POLICY.html

---

## Chrome Web Store レビュー時の注意点

### 権限の説明

Chrome Web Store のレビュー時に、各権限の使用目的を説明する必要があります。以下のテンプレートを使用してください：

**storage**:
```
APIキーと設定の永続化のために使用します。ユーザーがAPIキーを毎回入力する必要がないようにするため、chrome.storage.local APIを使用してローカルストレージに暗号化して保存します。
```

**activeTab**:
```
タブ音声のキャプチャのために使用します。Teams、Zoom等のオンライン会議の音声をリアルタイムで翻訳するため、現在アクティブなタブの情報を取得します。
```

**scripting**:
```
コンテンツスクリプトの動的注入のために使用します。会議アプリの音声キャプチャ機能を有効化するため、ユーザーが明示的に翻訳を開始した場合のみスクリプトを注入します。
```

**tabCapture**:
```
タブ音声のキャプチャのために使用します。オンライン会議の音声をリアルタイムで翻訳するため、chrome.tabCapture APIを使用してタブの音声ストリームを取得します。音声データは一切保存せず、リアルタイム処理のみ行います。
```

---

## まとめ

VoiceTranslate Pro は、以下の原則に従って権限を要求しています：

1. ✅ **最小権限の原則**: 必要最小限の権限のみ要求
2. ✅ **透明性**: 各権限の使用目的を明確に説明
3. ✅ **セキュリティ**: データの暗号化と保護
4. ✅ **プライバシー**: ユーザーデータを第三者と共有しない

---

**VoiceTranslate Pro Team**  
**最終更新日**: 2024年12月

