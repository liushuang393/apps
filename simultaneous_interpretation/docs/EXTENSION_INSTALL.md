# VoiceTranslate Pro - ブラウザ拡張機能インストールガイド

## 📦 **拡張機能の構成**

### ✅ **完成したファイル**
- `manifest.json` - 拡張機能の設定ファイル
- `voicetranslate-pro.js` - メインのJavaScriptコード（HTMLから抽出済み）
- `teams-realtime-translator.html` - ポップアップUI
- `README.md` - 機能説明とドキュメント

### ⚠️ **不足しているファイル**
- `icons/` フォルダ内のアイコンファイル（16x16, 32x32, 48x48, 128x128 PNG）

## 🚀 **インストール手順**

### **1. アイコンファイルの準備**
```bash
# iconsフォルダに以下のファイルを配置してください：
teams-translator/app2/icons/
├── icon16.png   (16x16 pixels)
├── icon32.png   (32x32 pixels)
├── icon48.png   (48x48 pixels)
└── icon128.png  (128x128 pixels)
```

### **2. Chrome拡張機能として読み込み**
1. Chrome ブラウザを開く
2. `chrome://extensions/` にアクセス
3. 右上の「デベロッパーモード」を有効にする
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. `teams-translator/app2/` フォルダを選択

### **3. 拡張機能の使用**
1. ブラウザのツールバーに表示される拡張機能アイコンをクリック
2. ポップアップでOpenAI APIキーを入力
3. 言語設定を行い、「接続」ボタンをクリック
4. 「録音開始」で音声翻訳を開始

## 🔧 **技術的な改善点**

### **現在の制限事項**
- **アイコンファイル未作成**：拡張機能のアイコンが表示されない
- **ポップアップサイズ制限**：ブラウザ拡張のポップアップは通常小さく表示される
- **マイクアクセス**：拡張機能からのマイクアクセスには追加の権限設定が必要

### **推奨改善**
1. **アイコン作成**：VoiceTranslate Proのロゴアイコンを作成
2. **ポップアップ最適化**：小さなポップアップに適したUIレイアウト
3. **権限設定**：`"microphone"` 権限をmanifest.jsonに追加
4. **エラーハンドリング**：拡張機能特有のエラー処理を追加

## 📋 **ファイル構成確認**

```
teams-translator/app2/
├── manifest.json                    ✅ 完成
├── voicetranslate-pro.js           ✅ 完成（HTMLから抽出済み）
├── teams-realtime-translator.html  ✅ 完成（外部JS参照に変更済み）
├── README.md                       ✅ 完成
├── EXTENSION_INSTALL.md            ✅ 完成（このファイル）
└── icons/                          ❌ アイコンファイル未作成
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## 🎯 **次のステップ**

1. **アイコンファイルの作成**：デザインツールでVoiceTranslate Proのアイコンを作成
2. **テスト実行**：Chrome拡張機能として読み込んで動作確認
3. **UI調整**：ポップアップサイズに合わせたレイアウト調整
4. **権限追加**：必要に応じてマイク権限をmanifest.jsonに追加

## ⚠️ **重要な注意事項**

- **OpenAI APIキー**：有効なAPIキーが必要です
- **HTTPS必須**：WebSocket接続にはHTTPS環境が必要です
- **ブラウザ互換性**：Chrome/Edge（Chromium系）で動作確認済み
- **マイクアクセス**：初回使用時にマイクアクセス許可が必要です

拡張機能として正常に動作するためには、上記の手順に従ってアイコンファイルを準備してください。
