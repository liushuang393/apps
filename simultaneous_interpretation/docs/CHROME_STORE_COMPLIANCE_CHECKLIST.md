# Chrome Web Store 公開コンプライアンスチェックリスト

## ✅ 修正完了項目

### 1. **プライバシーポリシー**
- ✅ `PRIVACY_POLICY.md` を作成
- ✅ データ収集、使用、共有、保護について明記
- ✅ ユーザーの権利（アクセス、削除、エクスポート）を明記
- ✅ 連絡先情報を記載

**公開方法**:
```bash
# GitHub Pages で公開（推奨）
# 1. GitHubリポジトリにPRIVACY_POLICY.mdをプッシュ
git add PRIVACY_POLICY.md
git commit -m "Add privacy policy for Chrome Web Store"
git push origin main

# 2. GitHub Pages を有効化
# Settings → Pages → Source: main branch → Save

# 3. プライバシーポリシーURL
# https://liushuang393.github.io/voicetranslate-pro/PRIVACY_POLICY.html
```

**Chrome Web Store での設定**:
- Developer Dashboard → Privacy → Privacy Policy URL
- URL: `https://liushuang393.github.io/voicetranslate-pro/PRIVACY_POLICY.html`

---

### 2. **manifest.json の修正**
- ✅ `author` フィールドを追加
- ✅ `homepage_url` フィールドを追加
- ✅ `web_accessible_resources` の `matches` を `<all_urls>` から `https://*/*` に制限

**変更内容**:
```json
{
  "author": "VoiceTranslate Pro Team",
  "homepage_url": "https://github.com/liushuang393/voicetranslate-pro",
  "web_accessible_resources": [
    {
      "resources": ["voicetranslate-pro.js", "teams-realtime-translator.html"],
      "matches": ["https://*/*"]
    }
  ]
}
```

**理由**:
- `author`: 開発者情報を明示
- `homepage_url`: プロジェクトのホームページを明示
- `matches`: セキュリティリスクを低減（HTTPSのみに制限）

---

### 3. **background.js の修正**
- ✅ `console.info` を削除（本番環境用）
- ✅ `console.error` を削除（本番環境用）

**変更内容**:
- デバッグ用のログ出力を削除
- エラーハンドリングは維持（ただしログ出力なし）

**理由**:
- Chrome Web Store は本番環境でのconsole.logを推奨しない
- ユーザーのコンソールを汚染しない

---

### 4. **権限説明ドキュメント**
- ✅ `docs/PERMISSIONS_JUSTIFICATION.md` を作成
- ✅ 各権限の使用目的と正当性を説明
- ✅ Chrome Web Store レビュー時のテンプレートを用意

---

## 📋 公開前の最終チェックリスト

### 必須項目

- [x] **manifest.json の確認**
  - [x] バージョン: `3.0.1`
  - [x] 権限: `storage`, `activeTab`, `scripting`, `tabCapture`
  - [x] アイコン: 16, 32, 48, 128 PNG
  - [x] `author` フィールド
  - [x] `homepage_url` フィールド

- [x] **アイコンファイルの準備**
  - [x] `icons/icon16.png` (16x16)
  - [x] `icons/icon32.png` (32x32)
  - [x] `icons/icon48.png` (48x48)
  - [x] `icons/icon128.png` (128x128)

- [ ] **プライバシーポリシーの公開**
  - [ ] GitHub Pages で公開
  - [ ] URL を確認: `https://liushuang393.github.io/voicetranslate-pro/PRIVACY_POLICY.html`

- [ ] **スクリーンショットの準備**
  - [ ] 最低1枚、推奨5枚
  - [ ] サイズ: 1280x800 または 640x400 PNG/JPEG
  - [ ] 推奨内容:
    1. メイン画面（翻訳実行中）
    2. 設定画面（言語選択、APIキー入力）
    3. 翻訳結果表示
    4. Teams/Zoom での使用例
    5. 多言語対応の例

- [ ] **拡張機能のパッケージング**
  - [ ] ZIPファイルの作成
  - [ ] ファイルサイズの確認（推奨: 10MB以下）

- [ ] **Chrome Web Store Developer アカウント**
  - [ ] 登録完了（$5の登録料）
  - [ ] 開発者情報の入力

---

## 🚀 公開手順

### ステップ1: プライバシーポリシーの公開

```bash
# 1. GitHubにプッシュ
git add PRIVACY_POLICY.md manifest.json background.js docs/
git commit -m "Prepare for Chrome Web Store submission"
git push origin main

# 2. GitHub Pages を有効化
# https://github.com/liushuang393/voicetranslate-pro/settings/pages
# Source: main branch → Save

# 3. プライバシーポリシーURLを確認
# https://liushuang393.github.io/voicetranslate-pro/PRIVACY_POLICY.html
```

### ステップ2: 拡張機能のパッケージング

```bash
# プロジェクトルートで実行
cd simultaneous_interpretation

# Windows PowerShell の場合
Compress-Archive -Path manifest.json,voicetranslate-pro.js,voicetranslate-*.js,teams-realtime-translator.html,background.js,icons -DestinationPath voicetranslate-pro.zip -Force

# macOS/Linux の場合
zip -r voicetranslate-pro.zip manifest.json voicetranslate-pro.js voicetranslate-*.js teams-realtime-translator.html background.js icons/
```

### ステップ3: Chrome Web Store にアップロード

1. **Developer Dashboard にアクセス**
   - https://chrome.google.com/webstore/devconsole

2. **新しいアイテムを追加**
   - 「新しいアイテム」ボタンをクリック
   - `voicetranslate-pro.zip` をアップロード

3. **ストアリスティングの入力**

   **基本情報**:
   - 名前: `VoiceTranslate Pro - リアルタイム音声翻訳`
   - 概要: `OpenAI Realtime APIを使用した高精度リアルタイム音声翻訳。Teams、Zoom等のオンライン会議で多言語コミュニケーションを実現。`
   - カテゴリ: `生産性` / `コミュニケーション`

   **プライバシー**:
   - プライバシーポリシーURL: `https://liushuang393.github.io/voicetranslate-pro/PRIVACY_POLICY.html`

   **権限の説明**:
   ```
   storage: APIキーと設定の永続化のために使用します。
   activeTab: タブ音声のキャプチャのために使用します。
   scripting: コンテンツスクリプトの動的注入のために使用します。
   tabCapture: タブ音声のキャプチャのために使用します。音声データは一切保存せず、リアルタイム処理のみ行います。
   ```

4. **送信してレビュー**
   - 「レビューのために送信」ボタンをクリック
   - レビュー期間: 通常1〜3営業日

---

## ⚠️ 潜在的な問題と対策

### 問題1: プライバシーポリシーのURL

**問題**: GitHub Pages のURLが正しく設定されていない

**対策**:
1. GitHub Pages が有効化されているか確認
2. `PRIVACY_POLICY.md` が `main` ブランチにプッシュされているか確認
3. URLにアクセスして、正しく表示されるか確認

### 問題2: 権限の説明不足

**問題**: Chrome Web Store のレビュー時に権限の説明を求められる

**対策**:
- `docs/PERMISSIONS_JUSTIFICATION.md` を参照
- 各権限の使用目的を明確に説明
- 必要に応じて、コード例を提示

### 問題3: スクリーンショットの品質

**問題**: スクリーンショットが不鮮明、または内容が不適切

**対策**:
- 高解像度のスクリーンショットを使用（1280x800推奨）
- 実際の使用シーンを示す
- テキストが読みやすいか確認

---

## 📊 レビュー後の対応

### レビュー合格

1. **公開設定**
   - 公開範囲: 全ユーザー
   - 地域: 全世界

2. **モニタリング**
   - インストール数の確認
   - レビュー評価の確認
   - バグレポートの確認

### レビュー不合格

1. **フィードバックの確認**
   - Chrome Web Store からのフィードバックを確認
   - 指摘された問題を特定

2. **修正と再送信**
   - 問題を修正
   - 新しいバージョンをアップロード
   - 再度レビューを送信

---

## 🎯 成功のポイント

1. ✅ **透明性**: プライバシーポリシーと権限の説明を明確に
2. ✅ **セキュリティ**: データの暗号化と保護
3. ✅ **品質**: 高品質なスクリーンショットと説明文
4. ✅ **サポート**: ユーザーサポートの準備（GitHub Issues、メール）
5. ✅ **更新**: 定期的なバグ修正とアップデート

---

**VoiceTranslate Pro Team**  
**最終更新日**: 2024年12月

