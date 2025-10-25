# 同時通訳 (Simultaneous Interpretation)

<div align="center">

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)
![Electron](https://img.shields.io/badge/Electron-38.2-47848F.svg)
![Node](https://img.shields.io/badge/Node.js-18+-339933.svg)

**AI駆動のリアルタイム音声翻訳システム**

OpenAI Realtime API を活用した、会議・通話の同時通訳アプリケーション

[English](./README.en.md) | [日本語](./README.md) | [中文](./README.zh.md)

</div>

---

## 📋 目次

- [概要](#概要)
- [主要機能](#主要機能)
- [システム要件](#システム要件)
- [インストール](#インストール)
- [設定](#設定)
- [使用方法](#使用方法)
- [アーキテクチャ](#アーキテクチャ)
- [開発](#開発)
- [トラブルシューティング](#トラブルシューティング)
- [ライセンス](#ライセンス)

---

## 概要

**同時通訳 (Simultaneous Interpretation)** は、OpenAI の最新 Realtime API を活用した、リアルタイム音声翻訳システムです。Microsoft Teams、Zoom、Google Meet などのオンライン会議や、システム音声の同時通訳を実現します。

### 特徴

- 🎯 **リアルタイム翻訳**: 低遅延（200-500ms）の音声→音声翻訳
- 🌐 **多言語対応**: 100+ 言語の自動検出と翻訳
- 🎤 **柔軟な音声入力**: マイク、システム音声、会議アプリの音声キャプチャ
- 🔒 **セキュア**: API キーの暗号化保存、ローカル処理
- ⚡ **高性能**: TypeScript + Electron による最適化
- 🎨 **直感的UI**: シンプルで使いやすいインターフェース

---

## 主要機能

### 1. リアルタイム音声翻訳

- **音声→音声翻訳**: OpenAI Realtime API による高品質翻訳
- **音声認識**: 自動音声認識（Whisper-1 統合）
- **言語自動検出**: 100+ 言語の自動識別
- **低遅延**: 200-500ms の応答時間

### 2. 音声入力ソース

- **マイク入力**: 個人の発話を翻訳
- **システム音声**: ブラウザ、アプリの音声を翻訳
- **会議アプリ**: Teams、Zoom、Google Meet の音声キャプチャ

### 3. 音声活性検出 (VAD)

- **クライアント VAD**: ローカルでの音声検出（低ネットワーク負荷）
- **サーバー VAD**: OpenAI サーバーでの高精度検出
- **カスタマイズ可能**: 感度、デバウンス時間の調整

### 4. 翻訳モード

- **音声→音声**: リアルタイム音声翻訳
- **音声→テキスト**: 音声認識 + テキスト表示
- **テキスト→テキスト**: テキスト翻訳（Chat Completions API）

---

## 🎯 使用シナリオ

### 1️⃣ 国際会議での同時通訳
```
日本語で話す → リアルタイムで英語に翻訳 → 参加者が理解
```

### 2️⃣ 多言語チームコラボレーション
```
各メンバーが母国語で話す → 自動翻訳 → 全員が理解できる
```

### 3️⃣ オンライン研修・セミナー
```
講師の説明 → 複数言語に同時翻訳 → グローバル受講者対応
```

### 4️⃣ カスタマーサポート
```
顧客の言語 → サポート担当者の言語 → スムーズな対応
```

---

## 🔄 処理フロー

VoiceTranslate Pro は、**3つの並発処理**により高速かつ正確な翻訳を実現します。

### 処理の流れ

```
ユーザーの音声入力
    ↓
┌───────────────────────────────────────────────────────┐
│  OpenAI Realtime API (VOICE_TO_VOICE_MODEL)          │
│  - WebSocket接続による低遅延通信                        │
│  - リアルタイム音声認識 + 音声翻訳                      │
└───────────────────────────────────────────────────────┘
    ↓                               ↓
処理1-1: 即座に表示              処理1-2: 音声のみ再生
📥 入力音声テキスト化完了         🔊 入力音声から音声出力
    ↓                               ↓
入力テキストを表示                翻訳音声を再生
(左側カラム)                      (音声のみ、テキスト表示なし)
    ↓
    │
    └─────────────────────────────────┐
                                      ↓
                            ┌─────────────────────┐
                            │  処理2: 文本翻訳     │
                            │  📤🔊 翻訳結果      │
                            └─────────────────────┘
                                      ↓
                            OpenAI Chat API
                            (TRANSLATION_MODEL)
                            より高精度な文本翻訳
                                      ↓
                            翻訳テキストを表示
                            (右側カラム)
```

### 処理の詳細

#### 処理1: Realtime API による音声処理（同時実行）

**処理1-1: 📥 入力音声テキスト化**
- **処理**: Realtime API による音声認識
- **モデル**: `gpt-4o-transcribe`（音声認識専用）
- **表示**: 左側カラムに即座に表示
- **目的**: ユーザーが話した内容を確認

**処理1-2: 🔊 音声翻訳**
- **処理**: Realtime API による音声→音声翻訳
- **モデル**: `VOICE_TO_VOICE_MODEL`（環境変数で設定可能）
- **表示**: 右側カラムにテキスト表示 + 音声再生
- **目的**: 音声出力による翻訳
- **特徴**:
  - 自然な音声で翻訳を出力
  - リアルタイムストリーミング
  - 6種類の音声タイプから選択可能

#### 処理2: 📤 文本翻訳（入力テキストから実行）

- **処理**: Chat Completions API による高精度テキスト翻訳
- **入力**: 処理1-1で得られた入力テキスト
- **モデル**: `TRANSLATION_MODEL`（環境変数で設定可能）
- **表示**: 右側カラムに表示
- **目的**: より正確な文本翻訳を提供
- **特徴**:
  - 入力テキストから直接翻訳
  - 音声翻訳より高精度
  - テキストのみの翻訳に最適化
  - 音声翻訳とは独立したモデルを使用可能

**注意**: 処理1-2の音声翻訳はテキスト表示せず、音声のみ再生します。右側カラムには処理2の文本翻訳のみが表示されます。

### 一対一対応の保証

各入力音声には**一意のID（transcriptId）**が付与され、入力と翻訳が確実に対応します：

```javascript
transcriptId: 1234567890
├─ 📥 入力テキスト: "Hello, how are you?"
├─ 📤 文本翻訳: "こんにちは、お元気ですか？" (入力テキストから翻訳)
└─ 🔊 音声翻訳: 音声再生のみ (音声から直接翻訳、テキスト表示なし)
```

### この設計のメリット

| メリット | 説明 |
|---------|------|
| **高精度** | 文本翻訳は専用モデルを使用し、より正確な翻訳を提供 |
| **リアルタイム性** | 音声翻訳はRealtime APIで低遅延を実現 |
| **シンプル** | 2列表示で見やすく、混乱を避ける |
| **音声出力** | 音声翻訳は音声のみ再生、テキストは文本翻訳を表示 |
| **信頼性** | 一方の処理が失敗しても、他の処理は継続 |

### 使用モデルの設定

`.env` ファイルで各処理のモデルを個別に設定可能：

```bash
# 文本翻訳モデル（Chat Completions API対応モデル）
# 推奨: gpt-4o, gpt-4-turbo, gpt-3.5-turbo
# ⚠️ Realtime APIモデル（gpt-realtime-xxx）は使用不可
OPENAI_TRANSLATION_MODEL=gpt-5-2025-08-07

# 音声→音声翻訳モデル（Realtime API専用モデル）
OPENAI_VOICE_TO_VOICE_MODEL=gpt-realtime-2025-08-28
```

**重要**: 文本翻訳モデルは Chat Completions API 対応モデルを使用してください。Realtime API モデル（`gpt-realtime-xxx`）を指定した場合、自動的に `gpt-4o` に置き換えられます。

---

## 📁 ドキュメント構成

### 📋 コア文書（必読）
- **[ENGINEERING_RULES.md](./docs/ENGINEERING_RULES.md)** - 🔥 **エンジニアリング規則** (開発者必読)
- **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** - 技術アーキテクチャ設計書
- **[API_KEY_SETUP_CHECKLIST.md](./docs/API_KEY_SETUP_CHECKLIST.md)** - API キー設定チェックリスト

### 📚 セットアップ・使用ガイド
- **[SETUP_GUIDE.md](./docs/SETUP_GUIDE.md)** - 詳細なセットアップ手順
- **[USAGE_GUIDE.md](./docs/USAGE_GUIDE.md)** - 使用ガイド
- **[EXTENSION_INSTALL.md](./docs/EXTENSION_INSTALL.md)** - ブラウザ拡張機能のインストール方法
- **[QUICK_TEST_GUIDE.md](./docs/QUICK_TEST_GUIDE.md)** - 快速テストガイド

### 🎨 設計文書
- **[design/DETAILED_DESIGN.md](./design/DETAILED_DESIGN.md)** - 詳細設計書
- **[design/PROJECT_PLAN.md](./design/PROJECT_PLAN.md)** - プロジェクト計画書
- **[design/TEST_PLAN.md](./design/TEST_PLAN.md)** - テスト計画書

### 📊 実装報告書
- **[P0_COMPLETE_SUMMARY.md](./docs/P0_COMPLETE_SUMMARY.md)** - P0 並発エラー修復完了報告
- **[P1_COMPLETE_SUMMARY.md](./docs/P1_COMPLETE_SUMMARY.md)** - P1 機能完善完了報告
- **[P1_VAD_BUFFER_STRATEGY.md](./docs/P1_VAD_BUFFER_STRATEGY.md)** - VAD バッファ戦略
- **[P1_CONVERSATION_CONTEXT.md](./docs/P1_CONVERSATION_CONTEXT.md)** - 会話コンテキスト管理
- **[CODE_REVIEW_P0_P1.md](./docs/CODE_REVIEW_P0_P1.md)** - コード審査報告

### 🚀 API・アップグレード
- **[GPT_REALTIME_2025_UPGRADE_GUIDE.md](./docs/GPT_REALTIME_2025_UPGRADE_GUIDE.md)** - GPT Realtime 2025 アップグレードガイド

---

## 🚀 クイックスタート

### 前提条件
- Node.js 18.0.0 以上
- npm 9.0.0 以上
- OpenAI API キー（[取得方法](./docs/API_KEY_SETUP_CHECKLIST.md)）

### インストール

1. **依存関係のインストール**
   ```bash
   npm install
   npx --yes electron-rebuild -f -w better-sqlite3 2>NUL || npm install better-sqlite3
   ```

2. **起動方法の選択**

   アプリケーションを起動する方法は複数あります。用途に応じて選択してください。

   | コマンド | 用途 | 推奨シーン |
   |---------|------|-----------|
   | `npm run dev` | 🔥 **開発時最推奨** | コード変更時に自動再コンパイル・再起動 |
   | `npm start` | ⚡ クイック起動 | 開発版を素早く起動 |

   | `npm run build:electron` | 🚀 Electron アプリのビルド | ビルドのみ（実行なし） |
   | `npm run electron:dev` | 🔧 開発モード実行 | 手動ビルド後に開発版を実行 |

   
   | `npm run electron` | 🏭 本番モード実行 | 本番環境版をテスト |
   | `npm run build` | 📦 ビルドのみ | コンパイルのみ（実行なし） |

   **詳細説明:**

   - **`npm run dev`** （開発時推奨）
     ```bash
     npm run dev
     ```
     - ファイル監視モードでビルド + 自動再起動
     - コード変更時に自動的に再コンパイル・再起動
     - 開発時に最も便利

   - **`npm start`** または **`npm run electron:dev`**
     ```bash
     npm start
     # または
     npm run electron:dev
     ```
     - 開発モードで一度だけビルド・実行
     - 素早くテストしたい時に便利

   - **`npm run electron`**
     ```bash
     npm run electron
     ```
     - 本番モードでビルド・実行
     - 最終版のテストに使用

   - **`npm run build`**
     ```bash
     npm run build
     ```
     - TypeScript コードのコンパイルのみ
     - アプリケーションは起動しない
     - コンパイルエラーの確認に使用

3. **環境変数を使用した起動（推奨）**

   API キーを環境変数として設定してから起動する方法です。

   **Linux/Mac の場合:**
   ```bash
   # 1. サンプルファイルをコピー
   cp start-with-env.sh.example start-with-env.sh

   # 2. API キーを編集（YOUR_API_KEY_HERE を実際のキーに置き換え）
   nano start-with-env.sh
   # または
   code start-with-env.sh

   # 3. 実行権限を付与
   chmod +x start-with-env.sh

   # 4. 起動
   ./start-with-env.sh
   ```

   **Windows の場合:**
   ```bash
   # 1. サンプルファイルをコピー
   copy start-with-env.bat.example start-with-env.bat

   # 2. API キーを編集（YOUR_API_KEY_HERE を実際のキーに置き換え）
   notepad start-with-env.bat

   # 3. 起動
   start-with-env.bat
   ```

   **⚠️ セキュリティ注意:**
   - `start-with-env.sh` と `start-with-env.bat` は `.gitignore` に追加済み
   - API キーを含むファイルは絶対に Git にコミットしないでください

4. **テスト実行**
   ```bash
   # 全テスト実行
   npm test

   # カバレッジ付きテスト
   npm run test:coverage

   # ウォッチモード
   npm run test:watch
   ```

### ブラウザ拡張機能としてインストール

1. **アイコン生成**
   ```bash
   # ブラウザで generate-icons.html を開く
   # 全アイコンをダウンロードして icons/ フォルダに配置
   ```

2. **Chrome に読み込み**
   - Chrome で `chrome://extensions/` を開く
   - 「デベロッパーモード」を有効化
   - 「パッケージ化されていない拡張機能を読み込む」をクリック
   - `app2` フォルダを選択

詳細は [`docs/EXTENSION_INSTALL.md`](./docs/EXTENSION_INSTALL.md) を参照してください。

---

## 🔧 技術スタック

### フロントエンド
- **TypeScript 5.0**: 型安全な開発環境
- **HTML5**: セマンティックマークアップ
- **CSS3**: モダンスタイリング、グラデーション、アニメーション

### 音声処理
- **Web Audio API**: リアルタイム音声処理
- **MediaRecorder API**: 音声キャプチャ
- **AudioContext**: 音声ストリーム管理
- **AnalyserNode**: スペクトラム解析・可視化

### API 統合・AIモデル
- **OpenAI Realtime API**: リアルタイム音声翻訳（WebSocket）
- **gpt-realtime**: 最新の音声→音声翻訳モデル（2025年8月28日 GA）
  - **音声認識**: 入力音声 → 入力テキスト
  - **翻訳**: 入力テキスト → 翻訳テキスト
  - **音声合成（TTS）**: 翻訳テキスト → 翻訳音声
  - **特徴**:
    - 従来モデル（gpt-4o-realtime-preview）より20%低価格
    - 高品質な音声認識・翻訳・音声合成
    - 低遅延（平均500-1500ms）
    - 自然な音声出力（Cedar、Marinなど新音声対応）
- **Web Crypto API**: API キー暗号化

### ビルド・開発ツール
- **Webpack 5**: モジュールバンドラー
- **TypeScript Compiler**: トランスパイル
- **Babel**: JavaScript トランスパイル
- **ESLint**: コード品質チェック
- **Prettier**: コードフォーマット

### テスト
- **Jest**: 単体テスト・統合テストフレームワーク
- **@testing-library**: DOM テストユーティリティ
- **ts-jest**: TypeScript テストサポート

### デスクトップアプリ
- **Electron**: クロスプラットフォームデスクトップアプリ
- **electron-builder**: アプリケーションパッケージング

### ブラウザ拡張
- **Chrome Extension Manifest V3**: 最新の拡張機能仕様
- **chrome.storage API**: 設定永続化
- **chrome.scripting API**: コンテンツスクリプト

---

## 📦 プロジェクト構造

```
app2/
├── src/                          # TypeScript ソースコード
│   ├── audio/                    # 音声処理モジュール
│   │   ├── AudioProcessor.ts     # 音声処理クラス
│   │   └── VADDetector.ts        # VAD 検出器
│   ├── services/                 # サービス層
│   │   ├── OpenAIService.ts      # OpenAI API 統合
│   │   ├── WebSocketManager.ts   # WebSocket 管理
│   │   └── StorageService.ts     # ストレージ管理
│   ├── features/                 # 機能モジュール
│   │   ├── Translation.ts        # 翻訳機能
│   │   └── Visualization.ts      # 可視化機能
│   ├── utils/                    # ユーティリティ
│   │   ├── Logger.ts             # ログシステム
│   │   ├── ErrorHandler.ts       # エラーハンドリング
│   │   └── Validator.ts          # バリデーション
│   ├── types/                    # TypeScript 型定義
│   │   └── index.ts              # 型定義エクスポート
│   └── integrations/             # 外部統合
│       └── TeamsIntegration.ts   # Teams 統合
├── electron/                     # Electron アプリ
│   ├── main.ts                   # メインプロセス
│   ├── preload.ts                # プリロードスクリプト
│   └── audioCapture.ts           # 音声キャプチャ
├── tests/                        # テストコード
│   ├── unit/                     # 単体テスト
│   └── setup.js                  # テストセットアップ
├── docs/                         # プロジェクト文書
├── design/                       # 設計文書
├── icons/                        # アイコンファイル
├── dist/                         # ビルド出力
├── coverage/                     # テストカバレッジ
├── manifest.json                 # Chrome 拡張マニフェスト
├── teams-realtime-translator.html # メイン UI
├── voicetranslate-pro.js         # バンドル済み JavaScript
├── generate-icons.html           # アイコン生成ツール
├── package.json                  # npm 設定
├── tsconfig.json                 # TypeScript 設定
├── jest.config.js                # Jest 設定
└── eslint.config.js              # ESLint 設定
```

---

## 🎨 アイコン生成

ブラウザ拡張機能用のアイコンを生成するツールを提供しています。**4種類のデザインスタイル**から選択可能！

### 使用方法

1. **アイコン生成ツールを開く**
   - `generate-icons.html` をダブルクリック
   - または、ブラウザにドラッグ&ドロップ

2. **デザインスタイルを選択**
   - 🎤 **マイクスタイル**: 音声入力を強調（デフォルト）
   - 🌐 **翻訳スタイル**: 言語変換を強調
   - 📊 **波形スタイル**: リアルタイム処理を強調
   - ✨ **ミニマルスタイル**: シンプルで洗練されたデザイン

3. **アイコンをダウンロード**
   - 「全てのアイコンをダウンロード」ボタンをクリック
   - 4つのサイズ（16x16, 32x32, 48x48, 128x128）が自動生成される

4. **アイコンを配置**
   ```bash
   # Windows の場合
   move %USERPROFILE%\Downloads\icon*.png icons\

   # macOS/Linux の場合
   mv ~/Downloads/icon*.png icons/
   ```

### 4つのデザインスタイル

#### 🎤 マイクスタイル
- **特徴**: 中央にマイクアイコン、左右に音波エフェクト
- **用途**: 音声入力機能を強調
- **印象**: プロフェッショナル、音声特化

#### 🌐 翻訳スタイル
- **特徴**: "A" と "あ" の文字、双方向矢印
- **用途**: 翻訳機能を強調
- **印象**: 多言語対応、国際的

#### 📊 波形スタイル
- **特徴**: 7本の動的な波形バー
- **用途**: リアルタイム処理を強調
- **印象**: ダイナミック、リアルタイム

#### ✨ ミニマルスタイル
- **特徴**: シンプルな円と4つの点
- **用途**: 洗練されたシンプルなデザイン
- **印象**: モダン、ミニマリスト

### 共通デザイン要素
- **グラデーション背景**: 紫から青へ（#667eea → #764ba2）
- **角丸デザイン**: 親しみやすい印象
- **高品質レンダリング**: アンチエイリアシング対応
- **視認性**: 明暗両方の背景で見やすい

詳細は [HOW_TO_GENERATE_ICONS.md](./HOW_TO_GENERATE_ICONS.md) を参照してください。

---

## 💰 料金について

### OpenAI API 料金（2024年12月現在）
- **音声入力**: $0.06/分
- **音声出力**: $0.24/分
- **概算**: 1時間の会議で約 $5-10

### コスト削減のヒント
1. **VAD を有効化**: 無音部分を自動スキップ
2. **必要な時だけ録音**: 不要な時は停止
3. **短い発話で区切る**: 効率的な処理
4. **適切な感度設定**: 不要な音声検出を防ぐ

---

## 🔒 セキュリティとプライバシー

### データ保護
- ✅ 音声データは**一時的にのみ処理**
- ✅ ローカルストレージに**録音は保存されない**
- ✅ API キーは**AES-256-GCM で暗号化**して保存
- ✅ HTTPS 通信で**エンドツーエンド暗号化**

### 企業利用時の注意
1. 会議参加者に翻訳使用を事前通知
2. 機密情報の取り扱いポリシー確認
3. GDPR/個人情報保護法準拠確認
4. 社内セキュリティポリシーとの整合性確認

---


## 📊 システム要件

### 必須要件
| 項目 | 要件 |
|------|------|
| OS | Windows 10/11, macOS 11+, Ubuntu 20.04+ |
| ブラウザ | Chrome 90+, Edge 90+, Safari 14+ |
| Node.js | 18.0.0 以上 |
| RAM | 8GB 以上推奨 |
| ネットワーク | 安定した高速インターネット（10Mbps 以上） |
| マイク | 高品質マイク推奨 |
| API キー | OpenAI API キー（有料） |

### 推奨環境
- **ヘッドセット使用**（エコー防止）
- **静音環境**（翻訳精度向上）
- **有線 LAN 接続**（安定性向上）

---

## 🛠️ 開発環境

### 開発環境のセットアップ

```bash
# 1. リポジトリをクローン
git clone https://github.com/liushuang393/apps.git
cd simultaneous_interpretation

# 2. 依存関係をインストール
npm install
npx --yes electron-rebuild -f -w better-sqlite3 2>NUL || npm install better-sqlite3

# 3. 環境変数を設定
cp .env.example .env
# .env ファイルを編集して API キーを設定
```

### 開発コマンド

| コマンド | 説明 | 用途 |
|---------|------|------|
| `npm run dev` | 🔥 **推奨** | ファイル監視 + 自動再コンパイル・再起動 |
| `npm start` | ⚡ クイック起動 | 開発版を素早く起動 |
| `npm run build` | 📦 ビルド | TypeScript コンパイル |
| `npm run build:all` | 📦 全ビルド | Core + Electron + Extension |
| `npm test` | 🧪 テスト | 全テスト実行 |
| `npm run test:coverage` | 📊 カバレッジ | カバレッジ付きテスト |
| `npm run lint` | ✅ Lint | ESLint チェック |
| `npm run format` | 🎨 フォーマット | Prettier フォーマット |

### 開発時の注意点

1. **TypeScript エラーチェック**
   ```bash
   npm run type-check
   ```

2. **ESLint チェック**
   ```bash
   npm run lint
   npm run lint:fix  # 自動修正
   ```

3. **コードフォーマット**
   ```bash
   npm run format
   ```

4. **テストカバレッジ確認**
   ```bash
   npm run test:coverage
   # coverage/ フォルダで詳細を確認
   ```

### デバッグ方法

1. **Electron DevTools を開く**
   - アプリ起動後、`Ctrl+Shift+I` (Windows) または `Cmd+Option+I` (Mac)

2. **Console ログを確認**
   - DevTools の Console タブで実行時ログを確認

3. **ネットワークリクエストを確認**
   - DevTools の Network タブで API 通信を確認

---

## 🚀 本番環境

### 本番環境のビルド

```bash
# 1. 本番用ビルド
npm run build:all

# 2. Electron アプリをパッケージング
npm run dist

# 3. 出力ファイル
# Windows: release/VoiceTranslate Pro Setup 2.0.0.exe
# macOS: release/VoiceTranslate Pro-2.0.0.dmg
# Linux: release/VoiceTranslate Pro-2.0.0.AppImage
```

### 本番環境の設定

1. **環境変数の設定**
   ```bash
   # .env ファイルで以下を設定
   NODE_ENV=production
   OPENAI_REALTIME_MODEL=gpt-realtime-2025-08-28
   OPENAI_CHAT_MODEL=gpt-4o
   OPENAI_VOICE_TO_VOICE_MODEL=gpt-realtime-2025-08-28
   OPENAI_TRANSLATION_MODEL=gpt-5-2025-08-07
   ```

2. **API キーの管理**
   - 本番環境では環境変数から読み込み
   - `.env` ファイルは Git にコミットしない
   - `.gitignore` に `.env` が含まれていることを確認

3. **セキュリティチェック**
   ```bash
   # ESLint チェック
   npm run lint

   # TypeScript 型チェック
   npm run type-check

   # テスト実行
   npm test
   ```

### 本番環境での実行

```bash
# 1. ビルド済みアプリを実行
npm run electron

# 2. または、パッケージ化されたアプリを実行
# Windows: VoiceTranslate Pro Setup 2.0.0.exe をダブルクリック
# macOS: VoiceTranslate Pro-2.0.0.dmg をダブルクリック
# Linux: VoiceTranslate Pro-2.0.0.AppImage をダブルクリック
```

### 本番環境での品質基準

- ✅ ESLint エラー: 0
- ✅ TypeScript エラー: 0
- ✅ テストカバレッジ: 80% 以上
- ✅ 全テスト: パス
- ✅ セキュリティ: API キー暗号化、HTTPS 通信

### 本番環境でのトラブルシューティング

1. **アプリが起動しない**
   - Node.js バージョンを確認: `node --version`
   - 依存関係を再インストール: `npm install`

2. **API キーエラー**
   - `.env` ファイルが存在することを確認
   - API キーが正しく設定されていることを確認
   - OpenAI API の利用可能性を確認

3. **音声が出力されない**
   - スピーカーが接続されていることを確認
   - 音量設定を確認
   - ブラウザの音声許可を確認

---

## 🧪 テスト

### テスト実行

```bash
# 全テスト実行
npm test

# カバレッジ付きテスト
npm run test:coverage

# ウォッチモード
npm run test:watch

# 特定のテストファイル
npm test -- AudioProcessor.test.ts
```

### テストカバレッジ
- **目標**: 80% 以上
- **現状**: カバレッジレポートは `coverage/` フォルダに生成

詳細は [`design/TEST_PLAN.md`](./design/TEST_PLAN.md) を参照してください。

---

## 🐛 トラブルシューティング

### よくある問題

| 問題 | 原因 | 解決方法 |
|------|------|----------|
| 接続できない | API キーが無効 | API キーを再確認、新規作成 |
| 音声が認識されない | マイク権限なし | ブラウザ設定でマイク許可 |
| 翻訳が遅い | ネットワーク遅延 | 有線 LAN 使用、他のアプリ終了 |
| エコーが発生 | スピーカー音がマイクに | ヘッドセット使用 |
| 翻訳精度が低い | 騒音が多い | VAD 感度を「高」に設定 |

### エラーコード

| コード | 意味 | 対処法 |
|--------|------|---------|
| WS_001 | WebSocket 接続失敗 | ネットワーク確認 |
| API_001 | API キー認証失敗 | キー再確認 |
| MIC_001 | マイクアクセス拒否 | 権限設定確認 |
| AUDIO_001 | オーディオ処理エラー | ページリロード |

詳細は [`docs/GETTING_STARTED.md`](./docs/GETTING_STARTED.md) を参照してください。

---

## 🤝 コントリビューション

### 開発ワークフロー

1. **ブランチ作成**
   ```bash
   git checkout -b feature/new-feature
   ```

2. **コード変更**
   - TypeScript で実装
   - ESLint/Prettier でフォーマット
   - テストを追加

3. **テスト実行**
   ```bash
   npm test
   npm run lint
   ```

4. **コミット**
   ```bash
   git commit -m "feat: add new feature"
   ```

5. **プルリクエスト**
   - 詳細な説明を記載
   - レビューを依頼

### コーディング規約
- **TypeScript**: 厳格な型チェック
- **ESLint**: エラー 0 必須
- **コメント**: 日本語で詳細に記載
- **テスト**: 新機能には必ずテストを追加

---

## 📝 ライセンス

MIT License - 商用利用可能

Copyright © 2024 VoiceTranslate Pro. All rights reserved.

---

## 📞 サポート

### 技術サポート
- **Email**: support@voicetranslate.pro
- **Documentation**: [`docs/`](./docs/) フォルダ
- **Issues**: GitHub Issues で報告

### よくある質問（FAQ）

**Q: 複数人の会議で使用できますか？**
A: はい、話者が順番に話す場合は問題なく使用できます。

**Q: オフラインで使用できますか？**
A: いいえ、OpenAI API への接続が必要です。

**Q: 録音データは保存されますか？**
A: いいえ、リアルタイム処理のみで録音は保存されません。

**Q: 月額料金はいくらですか？**
A: 使用量に応じた従量課金制です（OpenAI API 料金）。

---

## 🎉 まとめ

VoiceTranslate Pro は、グローバルビジネスコミュニケーションを革新する強力なツールです。適切な設定と使用方法により、言語の壁を越えたスムーズなコミュニケーションを実現します。

**詳細情報は [`docs/`](./docs/) および [`design/`](./design/) フォルダ内の各ドキュメントを参照してください。**

---

<div align="center">

**Made with ❤️ by VoiceTranslate Pro Team**

[ドキュメント](./docs/) • [設計書](./design/) • [サポート](#-サポート)

</div>
