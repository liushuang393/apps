# 本番リリース手順書（VoiceTranslate Pro）

本アプリは **2つの配布形態** がある。両方とも同じ `voicetranslate-*.js` を共有して動く。

| 形態 | 配布物 | 配布先 |
|---|---|---|
| ローカルアプリ (Electron) | Windowsインストーラ `.exe` / portable版 | 自社サイト / GitHub Releases 等で直接配布 |
| ブラウザ拡張 (Chrome) | `voicetranslate-pro-extension.zip` | Chrome ウェブストア |

---

## 0. リリース前チェックリスト

- [ ] `package.json` の `version` を更新（例: `2.0.0` → `2.0.1`）
- [ ] `manifest.json` の `version` を更新（**Chromeストアは同一バージョンの再アップロード不可**。必ず上げる）
- [ ] 必要な場合は OS/配布環境に `OPENAI_API_KEY` 等を設定した（本番パッケージは `.env` を含まない）
- [ ] 既知の品質ゲートエラー（後述 §4）を解消した
- [ ] `start-local.bat` で起動・動作確認した
- [ ] CHANGELOG / リリースノートを用意した

---

## 1. ワンクリック自動ビルド

```
build-release.bat をダブルクリック
```

このバッチが順に実行する内容:

1. `npm run quality` … 型チェック / lint / format / 拡張チェック
2. `npm run build:all` … core + electron + extension をコンパイル
3. `npm run dist:win` … Windowsインストーラを `release\` に生成
4. `npm run pack:extension` … `voicetranslate-pro-extension.zip` を生成

> いずれかで失敗すると停止しログを表示する。

---

## 2. ローカルアプリ (Electron) の配布

### 2-1. ビルド成果物
`build-release.bat` 実行後、`release\` に以下が生成される:
- `VoiceTranslate Pro Setup <version>.exe` … NSISインストーラ
- `VoiceTranslate Pro <version>.exe` … portable版（インストール不要）

手動で個別に作る場合:
```bash
npm run dist:win     # Windows
npm run dist:mac     # macOS（macOS実機が必要）
npm run dist:linux   # Linux
```

### 2-2. 配布方法
- **GitHub Releases**: タグを切って `release\*.exe` をアップロード
  ```bash
  git tag v2.0.1
  git push origin v2.0.1
  # GitHub の Releases 画面で release\*.exe を添付
  ```
- **自社サイト**: `release\*.exe` をダウンロードリンクとして配置

### 2-3. コード署名（任意・推奨）
未署名の `.exe` は Windows SmartScreen で警告が出る。回避するにはコードサイニング証明書が必要:
1. 証明書(.pfx)を取得（DigiCert / SSL.com 等）
2. 環境変数を設定して `dist:win`:
   ```
   set CSC_LINK=path\to\cert.pfx
   set CSC_KEY_PASSWORD=********
   npm run dist:win
   ```
electron-builder が自動で署名する。

---

## 3. ブラウザ拡張 (Chrome ウェブストア) の公開

### 3-1. アップロード用zipの生成
```bash
npm run pack:extension
```
→ ルートに `voicetranslate-pro-extension.zip` が生成される（同梱ファイルは `build-extension.js` の `INCLUDE_FILES` で定義）。

### 3-2. 初回公開（デベロッパー登録）
1. [Chrome ウェブストア デベロッパーダッシュボード](https://chrome.google.com/webstore/devconsole) にアクセス
2. 初回のみ **登録料 $5（一度きり）** を支払う
3. 「新しいアイテム」→ `voicetranslate-pro-extension.zip` をアップロード
4. ストア掲載情報を入力（参考: `docs/CHROME_STORE_LISTING.md` / `docs/CHROME_STORE_COMPLIANCE_CHECKLIST.md`）
   - 説明文、スクリーンショット（1280x800 or 640x400）、アイコン
   - **プライバシー: 権限の正当性**（`docs/PERMISSIONS_JUSTIFICATION.md` 参照）
     `tabCapture` / `scripting` / `storage` を使う理由を明記
   - データ利用の開示（音声をOpenAIへ送信する旨）
5. 「審査用に送信」→ 審査（数時間〜数日）

### 3-3. 更新公開
1. `manifest.json` の `version` を上げる（必須）
2. `npm run pack:extension` で新zipを生成
3. ダッシュボードの該当アイテム →「パッケージ」→ 新zipをアップロード →「審査用に送信」

> 注意: `host_permissions` に Supabase/Vercel の本番URLがハードコードされている（`manifest.json`）。
> サーバーを移行した場合はここも更新すること。

---

## 4. Electron 安全性とデータ

凭据、端点、履历保存と packaged smoke の仕様は
[`ELECTRON_SECURITY_AND_DATA.md`](./ELECTRON_SECURITY_AND_DATA.md) を参照する。リリース前は `npm run quality`、`npm run test:runtime:coverage`、`npm run dist:win`、`npm run smoke:packaged` をすべて通過させる。

---

## 5. バージョン番号の同期

リリースのたびに以下2箇所を**必ず同じ番号に**揃える:
- `package.json` → `"version"`（Electronアプリ版）
- `manifest.json` → `"version"`（Chrome拡張版）
