# エンジニアリング規則 - VoiceTranslate Pro 2.0

## 📋 目次

1. [プロジェクト概要](#プロジェクト概要)
2. [アーキテクチャ](#アーキテクチャ)
3. [開発環境](#開発環境)
4. [コーディング規約](#コーディング規約)
5. [ブラウザ拡張機能](#ブラウザ拡張機能)
6. [Electronアプリ](#electronアプリ)
7. [API使用規則](#api使用規則)
8. [テスト規則](#テスト規則)
9. [品質基準](#品質基準)

---

## プロジェクト概要

### 基本情報
- **プロジェクト名**: 同時通訳 (Simultaneous Interpretation) / VoiceTranslate Pro
- **バージョン**: 2.0.0
- **目的**: OpenAI Realtime APIを活用したリアルタイム音声翻訳システム
- **対応プラットフォーム**: 
  - Electronデスクトップアプリ (Windows/macOS/Linux)
  - Chromeブラウザ拡張機能 (Manifest V3)
  - Webアプリケーション

### 主要機能
1. **リアルタイム音声翻訳** (200-500ms低遅延)
2. **100+言語対応** (自動言語検出)
3. **複数音声入力源** (マイク、システム音声、会議アプリ)
4. **音声活性検出 (VAD)** (クライアント/サーバー両対応)
5. **3つの翻訳モード**:
   - 音声→音声 (Realtime API)
   - 音声→テキスト (Realtime API + Chat API)
   - テキスト→テキスト (Chat Completions API)

---

## アーキテクチャ

### 処理フロー (3つの並行処理)

```
ユーザー音声入力
    ↓
┌─────────────────────────────────────┐
│  OpenAI Realtime API (WebSocket)    │
│  - 低遅延通信                        │
│  - リアルタイム音声認識 + 音声翻訳   │
└─────────────────────────────────────┘
    ↓                    ↓
処理1-1: 入力テキスト化   処理1-2: 音声翻訳
📥 gpt-4o-transcribe    🔊 gpt-realtime-2025-08-28
    ↓                    ↓
左カラムに表示           音声のみ再生
    ↓
    └──────────────────┐
                       ↓
              ┌────────────────┐
              │  処理2: 文本翻訳 │
              │  📤 Chat API    │
              └────────────────┘
                       ↓
              OpenAI Chat API
              (gpt-4o / gpt-5-2025-08-07)
                       ↓
              右カラムに表示
```

### 一意性保証
- 各入力音声に **transcriptId** を付与
- 入力テキストと翻訳テキストの一対一対応を保証
- 処理失敗時も他の処理は継続

### モデル使用規則

#### 文本翻訳モデル (OPENAI_TRANSLATION_MODEL)
- **対応API**: Chat Completions API
- **推奨モデル**: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`, `gpt-5-2025-08-07`
- **禁止**: Realtime APIモデル (`gpt-realtime-xxx`) は使用不可
- **自動置換**: Realtime APIモデルを指定した場合、自動的に `gpt-4o` に置換

#### 音声→音声翻訳モデル (OPENAI_VOICE_TO_VOICE_MODEL)
- **対応API**: Realtime API
- **推奨モデル**: `gpt-realtime-2025-08-28`
- **特徴**:
  - 従来モデル (gpt-4o-realtime-preview) より20%低価格
  - 高品質な音声認識・翻訳・音声合成
  - 低遅延 (平均500-1500ms)
  - 新音声対応 (Cedar, Marin等)

---

## 開発環境

### 必須要件
- **Node.js**: 18.0.0 以上
- **npm**: 9.0.0 以上
- **TypeScript**: 5.9.3
- **Electron**: 38.2.0
- **OS**: Windows 10/11, macOS 11+, Ubuntu 20.04+

### 推奨ツール
- **IDE**: Visual Studio Code
- **拡張機能**: ESLint, Prettier, TypeScript
- **ブラウザ**: Chrome 90+ (拡張機能開発用)

### 開発コマンド

| コマンド | 用途 | 推奨シーン |
|---------|------|-----------|
| `npm run dev` | 🔥 **開発時最推奨** | ファイル監視 + 自動再コンパイル・再起動 |
| `npm start` | ⚡ クイック起動 | 開発版を素早く起動 |
| `npm run electron:dev` | 🔧 開発モード | 手動ビルド後に開発版実行 |
| `npm run electron` | 🏭 本番モード | 本番環境版をテスト |
| `npm run build` | 📦 ビルドのみ | コンパイルのみ (実行なし) |
| `npm run build:all` | 📦 全ビルド | Core + Electron + Extension |
| `npm test` | 🧪 テスト実行 | 全テスト実行 |
| `npm run test:coverage` | 📊 カバレッジ | カバレッジ付きテスト |
| `npm run lint` | ✅ Lint | ESLintチェック |
| `npm run format` | 🎨 フォーマット | Prettierフォーマット |

### ビルドターゲット

```bash
# コアライブラリ
npm run build:core

# Electronアプリ
npm run build:electron

# ブラウザ拡張機能
npm run build:extension

# 全てビルド
npm run build:all
```

---

## コーディング規約

### 基本ルール

#### 1. 文字コード規則
- **ソースコードファイル**: UTF-8 (BOMなし) 必須
- **README・ドキュメント**: UTF-8 (BOM付き可)
- **ファイル編集前**: 必ずエンコーディングを確認

#### 2. コメント規則
- **言語**: 正式な日本語コメント必須
- **必須項目**:
  - 関数・クラスの目的
  - 入力・出力 (I/O)
  - 注意点・制約事項
- **例**:
```typescript
/**
 * 音声データをPCM16形式に変換する
 * @param samples - Float32Array形式の音声サンプル
 * @returns Int16Array形式のPCM16データ
 * @throws {AudioProcessingError} サンプルが空の場合
 */
function convertToPCM16(samples: Float32Array): Int16Array {
    // 実装
}
```

#### 3. TypeScript規則
- **厳格な型チェック**: `strict: true` 必須
- **any禁止**: `any` 型の使用禁止
- **ts-ignore禁止**: `@ts-ignore` の使用禁止
- **型定義**: 全ての関数・変数に明示的な型定義
- **インターフェース**: 複雑なオブジェクトは必ずインターフェース定義

```typescript
// ❌ 悪い例
function process(data: any) {
    // @ts-ignore
    return data.value;
}

// ✅ 良い例
interface ProcessData {
    value: string;
    timestamp: number;
}

function process(data: ProcessData): string {
    return data.value;
}
```

#### 4. 禁止事項
- **デバッグログ**: `console.log`, `console.debug` 禁止 (開発時のみ許可)
- **ハードコード**: 秘密情報・APIキー・パスのハードコード禁止
- **マジックナンバー**: 理由のない数値リテラル禁止 (定数化必須)
- **デモコード**: 実行不可能なデモレベルのコード禁止

```typescript
// ❌ 悪い例
if (value > 100) { // 100は何？
    console.log('Too large'); // 本番環境で禁止
}

// ✅ 良い例
const MAX_BUFFER_SIZE = 100; // バッファの最大サイズ (サンプル数)

if (value > MAX_BUFFER_SIZE) {
    logger.warn('Buffer size exceeded', { value, max: MAX_BUFFER_SIZE });
}
```

### ESLint・Prettier規則

#### ESLint
- **エラー数**: 0 必須
- **警告**: 無視禁止、全て解決必須
- **設定ファイル**: `eslint.config.js`
- **実行**: `npm run lint` (修正: `npm run lint:fix`)

#### Prettier
- **フォーマット**: 全ファイル統一フォーマット必須
- **設定**: プロジェクトルートの `.prettierrc` に従う
- **実行**: `npm run format` (チェック: `npm run format:check`)

---

## ブラウザ拡張機能

### Manifest V3 規則

#### 基本構成
```json
{
  "manifest_version": 3,
  "name": "VoiceTranslate Pro - リアルタイム音声翻訳",
  "version": "3.0.1",
  "permissions": ["storage", "activeTab", "scripting", "tabCapture"],
  "host_permissions": [
    "https://api.openai.com/*",
    "wss://api.openai.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  }
}
```

#### 権限使用規則
- **storage**: API キー・設定の永続化
- **activeTab**: アクティブタブへのアクセス
- **scripting**: コンテンツスクリプトの動的注入
- **tabCapture**: タブ音声のキャプチャ (会議アプリ対応)

#### アイコン規則
- **必須サイズ**: 16x16, 32x32, 48x48, 128x128 PNG
- **デザインスタイル**: 4種類から選択
  - 🎤 マイクスタイル (音声入力強調)
  - 🌐 翻訳スタイル (言語変換強調)
  - 📊 波形スタイル (リアルタイム処理強調)
  - ✨ ミニマルスタイル (シンプル・洗練)
- **生成ツール**: `generate-icons.html` を使用
- **配置場所**: `icons/` フォルダ

#### Content Security Policy
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' wss://api.openai.com https://api.openai.com;"
  }
}
```

### 拡張機能開発規則

#### ビルド
```bash
# 拡張機能のビルド
npm run build:extension

# 出力先
browser-extension/dist/
```

#### インストール手順
1. Chrome で `chrome://extensions/` を開く
2. 「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `simultaneous_interpretation/` フォルダを選択

#### 制限事項
- **ポップアップサイズ**: ブラウザ拡張のポップアップは小さく表示される
- **マイクアクセス**: 追加の権限設定が必要
- **WebSocket**: Content Security Policy に従う必須

---

## Electronアプリ

### アプリケーション構成

#### ファイル構造
```
electron/
├── main.ts              # メインプロセス
├── preload.ts           # プリロードスクリプト
├── audioCapture.ts      # 音声キャプチャ
├── realtimeWebSocket.ts # WebSocket管理
└── VoiceActivityDetector.ts # VAD検出
```

#### プロセス間通信 (IPC)

**メインプロセス → レンダラープロセス**
```typescript
// main.ts
mainWindow.webContents.send('audio-data', audioBuffer);

// preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
    onAudioData: (callback) => ipcRenderer.on('audio-data', callback)
});
```

**レンダラープロセス → メインプロセス**
```typescript
// preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
    startRecording: () => ipcRenderer.invoke('start-recording')
});

// main.ts
ipcMain.handle('start-recording', async () => {
    // 録音開始処理
});
```

### 音声キャプチャ規則

#### システム音声キャプチャ
```typescript
// audioCapture.ts
const constraints = {
    audio: {
        mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
        }
    },
    video: {
        mandatory: {
            chromeMediaSource: 'desktop'
        }
    }
};
```

#### マイク入力
```typescript
const constraints = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 24000,
        channelCount: 1
    }
};
```

### パッケージング規則

#### ビルド設定 (package.json)
```json
{
  "build": {
    "appId": "com.voicetranslate.pro",
    "productName": "VoiceTranslate Pro",
    "files": [
      "dist/**/*",
      "teams-realtime-translator.html",
      "voicetranslate-pro.js",
      "icons/**/*"
    ],
    "win": { "target": ["nsis", "portable"] },
    "mac": { "target": ["dmg", "zip"] },
    "linux": { "target": ["AppImage", "deb"] }
  }
}
```

#### ビルドコマンド
```bash
# 全プラットフォーム
npm run dist

# Windows
npm run dist:win

# macOS
npm run dist:mac

# Linux
npm run dist:linux
```

---

## API使用規則

### OpenAI Realtime API

#### WebSocket接続
```typescript
const ws = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-realtime-2025-08-28',
    {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'OpenAI-Beta': 'realtime=v1'
        }
    }
);
```

#### セッション設定
```typescript
{
    type: 'session.update',
    session: {
        modalities: ['text', 'audio'],
        instructions: '日本語から英語への翻訳を行ってください',
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
            model: 'whisper-1'
        },
        turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
        }
    }
}
```

#### 音声データ送信
```typescript
// PCM16形式 (24kHz, モノラル, 16bit)
{
    type: 'input_audio_buffer.append',
    audio: base64EncodedPCM16
}
```

### OpenAI Chat Completions API

#### テキスト翻訳
```typescript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
            {
                role: 'system',
                content: '日本語から英語への翻訳を行ってください'
            },
            {
                role: 'user',
                content: inputText
            }
        ],
        temperature: 0.3
    })
});
```

### API料金最適化

#### コスト削減のヒント
1. **VAD有効化**: 無音部分を自動スキップ
2. **必要時のみ録音**: 不要な時は停止
3. **短い発話で区切る**: 効率的な処理
4. **適切な感度設定**: 不要な音声検出を防ぐ

#### 料金目安 (2024年12月現在)
- **音声入力**: $0.06/分
- **音声出力**: $0.24/分
- **概算**: 1時間の会議で約 $5-10

---

## テスト規則

### テストフレームワーク
- **Jest**: 単体テスト・統合テスト
- **@testing-library**: DOM テスト
- **ts-jest**: TypeScript サポート

### テストカバレッジ目標
- **全体**: 80% 以上
- **重要モジュール**: 90% 以上
- **出力**: `coverage/` フォルダ

### テストコマンド
```bash
# 全テスト実行
npm test

# カバレッジ付き
npm run test:coverage

# ウォッチモード
npm run test:watch

# 特定ファイル
npm test -- AudioProcessor.test.ts
```

### テスト作成規則

#### 単体テスト
```typescript
describe('AudioProcessor', () => {
    let processor: AudioProcessor;

    beforeEach(() => {
        processor = new AudioProcessor();
    });

    afterEach(async () => {
        await processor.dispose();
    });

    it('should process audio correctly', async () => {
        const input = new Float32Array([0.1, 0.2, 0.3]);
        const result = await processor.process(input);
        
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
    });
});
```

#### 統合テスト
```typescript
describe('Translation Integration', () => {
    it('should translate voice to text', async () => {
        const adapter = new BrowserWebSocketAdapter();
        const pipeline = new AudioPipeline();
        
        await adapter.initialize(config);
        await pipeline.initialize();
        
        // テスト実行
        
        await pipeline.dispose();
        await adapter.dispose();
    });
});
```

---

## 品質基準

### 静的解析

#### フロントエンド
- **ESLint**: 0 エラー必須
- **TypeScript**: `tsc --noEmit` でエラー 0
- **any禁止**: `any` 型使用禁止
- **ts-ignore禁止**: `@ts-ignore` 使用禁止

#### バックエンド (該当する場合)
- **Checkstyle**: 合格必須
- **SpotBugs**: 合格必須

### コミット前チェック

```bash
# 品質チェック実行
npm run quality

# 内容:
# 1. TypeScript型チェック (npm run type-check)
# 2. ESLint (npm run lint)
# 3. Prettier (npm run format:check)
```

### 拒否テンプレート

品質規則を満たさない場合、以下のメッセージで中止:

```
品質規則を満たさないため中止します。
以下を提示してください:
- 環境情報
- ルール詳細
- 依存バージョン
- 実行手順
```

---

## セキュリティ規則

### データ保護
- ✅ 音声データは一時的にのみ処理
- ✅ ローカルストレージに録音は保存されない
- ✅ API キーは AES-256-GCM で暗号化して保存
- ✅ HTTPS 通信でエンドツーエンド暗号化

### 企業利用時の注意
1. 会議参加者に翻訳使用を事前通知
2. 機密情報の取り扱いポリシー確認
3. GDPR/個人情報保護法準拠確認
4. 社内セキュリティポリシーとの整合性確認

### API キー管理
- **環境変数**: `.env` ファイルで管理
- **Git除外**: `.gitignore` に必ず追加
- **暗号化保存**: ブラウザ拡張・Electronアプリで暗号化
- **ハードコード禁止**: ソースコードに直接記載禁止

---

**VoiceTranslate Pro Team**  
**Version 2.0.0**  
**Last Updated: 2025-10-21**

