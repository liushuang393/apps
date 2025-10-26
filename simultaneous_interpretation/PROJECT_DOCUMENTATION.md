# VoiceTranslate Pro 2.0 - プロジェクト全体ドキュメント

**作成日**: 2025-10-26  
**バージョン**: 2.0.0  
**ステータス**: ✅ 本番環境対応

---

## 📋 目次

1. [プロジェクト概要](#プロジェクト概要)
2. [システムアーキテクチャ](#システムアーキテクチャ)
3. [ディレクトリ構造と依存関係](#ディレクトリ構造と依存関係)
4. [コアモジュール詳細](#コアモジュール詳細)
5. [実行モード](#実行モード)
6. [翻訳処理フロー](#翻訳処理フロー)
7. [主要機能](#主要機能)
8. [問題点と改善提案](#問題点と改善提案)
9. [未使用コード一覧](#未使用コード一覧)
10. [開発・ビルド・実行手順](#開発ビルド実行手順)

---

## プロジェクト概要

### 基本情報

**プロジェクト名**: VoiceTranslate Pro 2.0 (同時通訳システム)  
**目的**: OpenAI Realtime APIを使用したリアルタイム音声翻訳  
**対応プラットフォーム**:
- Electronデスクトップアプリ (Windows/Mac/Linux)
- Chrome拡張機能 (Manifest V3)

### 主要技術スタック

| カテゴリ | 技術 |
|---------|------|
| **言語** | TypeScript, JavaScript (ES6+) |
| **フレームワーク** | Electron 38.3.0 |
| **API** | OpenAI Realtime API (gpt-realtime-2025-08-28)<br>OpenAI Chat API (gpt-4o / gpt-5-2025-08-07) |
| **データベース** | better-sqlite3 (会話履歴管理) |
| **音声処理** | Web Audio API, AudioWorklet |
| **通信** | WebSocket (wss://api.openai.com/v1/realtime) |
| **ビルドツール** | TypeScript Compiler, electron-builder |
| **品質管理** | ESLint, Prettier, Jest |

### 主要機能

1. **対面会話翻訳**: マイク入力のリアルタイム翻訳
2. **Teams/Zoom監視**: オンライン会議の音声キャプチャと翻訳
3. **ブラウザ動画翻訳**: タブ音声のキャプチャと翻訳
4. **2つの翻訳モード**:
   - **モード1**: 音声→音声翻訳（Voice-to-Voice）
   - **モード2**: 音声→テキスト→テキスト翻訳→音声（Text-based Translation）

---

## システムアーキテクチャ

### 全体構成図

```
┌─────────────────────────────────────────────────────────────────┐
│                    実行環境 (2種類)                              │
├─────────────────────────────────────────────────────────────────┤
│  1. Electronアプリ                2. Chrome拡張機能              │
│     - デスクトップアプリ              - ブラウザポップアップ      │
│     - システム音声キャプチャ          - タブ音声キャプチャ        │
│     - Teams/Zoom統合                - ブラウザ動画翻訳          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    コアアプリケーション                          │
├─────────────────────────────────────────────────────────────────┤
│  voicetranslate-pro.js (メインアプリケーション)                  │
│  ├── voicetranslate-websocket-mixin.js (WebSocket/音声処理)     │
│  ├── voicetranslate-ui-mixin.js (UI/転写表示)                   │
│  ├── voicetranslate-audio-queue.js (音声セグメント管理)         │
│  ├── voicetranslate-path-processors.js (双パス処理)             │
│  ├── voicetranslate-utils.js (ユーティリティ)                   │
│  └── voicetranslate-state-manager.js (状態管理)                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    双パス非同期処理                              │
├─────────────────────────────────────────────────────────────────┤
│  音声入力                                                        │
│    ↓                                                            │
│  [AudioSegment] ← AudioQueue (順次処理・排他制御)                │
│    ↓                                                            │
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │ Path1: テキスト │  │ Path2: 音声     │                      │
│  │ TextPathProcessor│  │ VoicePathProcessor│                   │
│  └─────────────────┘  └─────────────────┘                      │
│    ↓                    ↓                                       │
│  STT → テキスト翻訳   音声翻訳 → 音声再生                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    OpenAI API                                    │
├─────────────────────────────────────────────────────────────────┤
│  Realtime API (WebSocket)    Chat API (REST)                    │
│  - 音声認識 (STT)             - テキスト翻訳                     │
│  - 音声翻訳 (Voice-to-Voice)                                    │
│  - 音声合成 (TTS)                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 3層アーキテクチャ

#### 1. プレゼンテーション層
- **UI**: teams-realtime-translator.html
- **UI管理**: voicetranslate-ui-mixin.js
- **状態表示**: 接続状態、録音状態、転写テキスト

#### 2. ビジネスロジック層
- **メインアプリ**: voicetranslate-pro.js
- **WebSocket通信**: voicetranslate-websocket-mixin.js
- **音声処理**: voicetranslate-audio-queue.js, voicetranslate-path-processors.js
- **状態管理**: voicetranslate-state-manager.js

#### 3. データアクセス層
- **WebSocket**: OpenAI Realtime API
- **REST API**: OpenAI Chat API
- **データベース**: ConversationDatabase.ts (SQLite)
- **ストレージ**: localStorage (設定保存)

---

## ディレクトリ構造と依存関係

### プロジェクトルート構造

```
simultaneous_interpretation/
├── 📁 src/                          # TypeScriptソースコード (Electron用)
│   ├── adapters/                    # WebSocketアダプター
│   ├── audio/                       # 音声処理パイプライン
│   ├── config/                      # 設定管理
│   ├── context/                     # 会話コンテキスト
│   ├── core/                        # コアロジック
│   ├── errors/                      # エラー定義
│   ├── features/                    # 機能モジュール
│   ├── integrations/                # Teams/Zoom統合
│   ├── interfaces/                  # TypeScript型定義
│   ├── services/                    # サービス層
│   ├── test/                        # テストフレームワーク
│   ├── types/                       # 型定義
│   ├── utils/                       # ユーティリティ
│   └── index.ts                     # エントリーポイント
│
├── 📁 electron/                     # Electronメインプロセス
│   ├── main.ts                      # メインプロセス
│   ├── preload.ts                   # プリロードスクリプト
│   ├── audioCapture.ts              # 音声キャプチャ
│   ├── realtimeWebSocket.ts         # WebSocket管理
│   ├── VoiceActivityDetector.ts     # VAD
│   ├── ConversationDatabase.ts      # データベース
│   └── virtualAudioCapture.ts       # 仮想音声デバイス
│
├── 📁 browser-extension/            # Chrome拡張機能
│   ├── src/
│   │   ├── background.ts            # Service Worker
│   │   ├── popup.ts                 # ポップアップUI
│   │   ├── BrowserAdapter.ts        # ブラウザアダプター
│   │   └── audio-worklet.js         # 音声処理ワークレット
│   └── dist/                        # ビルド出力
│
├── 📁 docs/                         # ドキュメント
│   ├── ARCHITECTURE.md              # アーキテクチャ設計書
│   ├── SETUP_GUIDE.md               # セットアップガイド
│   ├── USAGE_GUIDE.md               # 使用ガイド
│   ├── ENGINEERING_RULES.md         # エンジニアリング規則
│   └── ...
│
├── 📁 dist/                         # TypeScriptビルド出力
│   ├── core/                        # コアモジュール
│   ├── electron/                    # Electronビルド
│   └── ...
│
├── 📁 tests/                        # テストコード
│   ├── audio/                       # 音声処理テスト
│   ├── context/                     # コンテキストテスト
│   └── core/                        # コアロジックテスト
│
├── 📄 teams-realtime-translator.html # メインUI (HTML)
├── 📄 voicetranslate-pro.js         # メインアプリ (JavaScript)
├── 📄 voicetranslate-websocket-mixin.js # WebSocket処理
├── 📄 voicetranslate-ui-mixin.js    # UI処理
├── 📄 voicetranslate-audio-queue.js # 音声キュー管理
├── 📄 voicetranslate-path-processors.js # 双パス処理
├── 📄 voicetranslate-utils.js       # ユーティリティ
├── 📄 voicetranslate-state-manager.js # 状態管理
├── 📄 background.js                 # Chrome拡張Service Worker
├── 📄 manifest.json                 # Chrome拡張マニフェスト
├── 📄 package.json                  # npm設定
├── 📄 tsconfig.json                 # TypeScript設定
└── 📄 README.md                     # プロジェクトREADME
```

### モジュール依存関係図

```
teams-realtime-translator.html
  ↓ (読み込み順序)
  ├── voicetranslate-utils.js
  │     ├── ResponseQueue
  │     ├── VoiceActivityDetector
  │     ├── CONFIG
  │     └── AudioUtils
  │
  ├── voicetranslate-state-manager.js
  │     └── StateManager
  │
  ├── voicetranslate-audio-queue.js
  │     ├── AudioSegment
  │     └── AudioQueue
  │
  ├── voicetranslate-path-processors.js
  │     ├── TextPathProcessor
  │     └── VoicePathProcessor
  │
  ├── voicetranslate-websocket-mixin.js
  │     └── WebSocketMixin
  │
  ├── voicetranslate-ui-mixin.js
  │     └── UIMixin
  │
  └── voicetranslate-pro.js
        └── VoiceTranslateApp
              ├── WebSocketMixin (Mixin適用)
              └── UIMixin (Mixin適用)
```

### TypeScriptモジュール依存関係

```
src/index.ts (エントリーポイント)
  ↓
  ├── config/
  │     ├── AppConfig.ts
  │     └── VADPresets.ts
  │
  ├── core/
  │     ├── VoiceTranslateCore.ts
  │     ├── WebSocketManager.ts
  │     ├── AudioManager.ts
  │     ├── UIManager.ts
  │     ├── ResponseStateManager.ts
  │     └── ImprovedResponseQueue.ts
  │
  ├── audio/
  │     ├── AudioPipeline.ts
  │     ├── VADProcessor.ts
  │     ├── ResamplerProcessor.ts
  │     └── EncoderProcessor.ts
  │
  ├── adapters/
  │     ├── WebSocketAdapter.ts
  │     ├── BrowserWebSocketAdapter.ts
  │     └── ElectronWebSocketAdapter.ts
  │
  ├── integrations/
  │     ├── MeetingIntegration.ts
  │     ├── TeamsIntegration.ts
  │     └── ZoomIntegration.ts
  │
  └── utils/
        ├── Logger.ts
        ├── AudioUtils.ts
        └── CommonUtils.ts
```

---

## コアモジュール詳細

### 1. voicetranslate-pro.js

**目的**: メインアプリケーションクラス
**依存**: すべてのモジュール
**主要機能**:
- アプリケーション初期化
- 音声入力管理 (マイク/システム音声)
- WebSocket接続管理
- AudioQueue初期化
- 双パス処理器の初期化
- イベントリスナー設定
- 設定の永続化

**主要メソッド**:
```javascript
init()                    // アプリケーション初期化
connect()                 // WebSocket接続
disconnect()              // WebSocket切断
startRecording()          // 録音開始
stopRecording()           // 録音停止
handleNewAudioSegment()   // 新しい音声セグメント処理
```

**状態管理**:
- `state`: アプリケーション状態 (接続状態、録音状態、言語設定など)
- `audioQueue`: 音声セグメントキュー
- `textPathProcessor`: テキストパス処理器
- `voicePathProcessor`: 音声パス処理器

---

### 2. voicetranslate-websocket-mixin.js

**目的**: WebSocket通信と音声処理機能を提供
**依存**: voicetranslate-utils.js, voicetranslate-audio-queue.js
**主要機能**:
- WebSocket接続管理
- OpenAI Realtime APIメッセージ処理
- 音声データ送信
- レスポンス受信処理
- エラーハンドリング

**主要メソッド**:
```javascript
connectWebSocket()              // WebSocket接続
sendAudioData(audioData)        // 音声データ送信
handleWebSocketMessage(event)   // メッセージ受信処理
handleAudioTranscript(data)     // 音声認識結果処理
handleAudioResponse(data)       // 音声翻訳結果処理
```

**WebSocketメッセージフロー**:
```
送信:
  input_audio_buffer.append    → 音声データ送信
  input_audio_buffer.commit    → 音声バッファコミット
  response.create              → 翻訳リクエスト

受信:
  conversation.item.input_audio_transcription.completed → STT結果
  response.audio_transcript.delta/done                  → 翻訳テキスト
  response.audio.delta/done                             → 翻訳音声
  response.done                                         → レスポンス完了
```

---

### 3. voicetranslate-ui-mixin.js

**目的**: UI更新と転写表示機能を提供
**依存**: なし
**主要機能**:
- 転写テキスト表示
- 翻訳テキスト表示
- 接続状態表示
- 通知表示
- 設定UI管理

**主要メソッド**:
```javascript
displayTranscript(text, type)   // 転写テキスト表示
updateConnectionStatus(status)  // 接続状態更新
notify(title, message, type)    // 通知表示
updateStats()                   // 統計情報更新
```

---

### 4. voicetranslate-audio-queue.js

**目的**: 音声セグメントのライフサイクル管理と順次処理
**依存**: なし
**主要機能**:
- 音声セグメントのキュー管理
- 双パス処理状態追跡
- 順次処理制御 (排他制御)
- セグメント完了検出

**主要クラス**:

#### AudioSegment
```javascript
class AudioSegment {
  id                    // セグメントID
  audioData             // 音声データ (PCM16)
  timestamp             // 作成時刻
  processingStatus      // 処理状態
    - path1_text        // Path1処理状態 (0=未処理, 1=処理中, 2=完了)
    - path2_voice       // Path2処理状態
    - audioSent         // 音声送信完了フラグ
}
```

#### AudioQueue
```javascript
class AudioQueue {
  queue                 // セグメントマップ
  isProcessing          // 処理中フラグ (排他制御)
  currentSegmentId      // 現在処理中のセグメントID
  processingQueue       // 処理待ちキュー

  enqueue(audioData)    // セグメント追加
  processNextSegment()  // 次のセグメント処理開始
  markPathComplete()    // パス完了マーク
  handleSegmentComplete() // セグメント完了処理
}
```

**処理フロー**:
```
1. enqueue() → セグメント作成 → processingQueue に追加
2. processNextSegment() → isProcessing チェック → セグメント処理開始
3. 'segmentReady' イベント発火 → handleNewAudioSegment() 呼び出し
4. Path1, Path2 順次実行
5. 両パス完了 → handleSegmentComplete() → isProcessing = false
6. processNextSegment() → 次のセグメント処理
```

---

### 5. voicetranslate-path-processors.js

**目的**: 双パス非同期処理の実装
**依存**: voicetranslate-audio-queue.js
**主要機能**:
- Path1: テキスト処理 (STT → テキスト翻訳)
- Path2: 音声処理 (音声翻訳 → 音声再生)

#### TextPathProcessor (Path1)

**処理フロー**:
```
1. 音声データをサーバーに送信 (input_audio_buffer.append)
2. 音声バッファコミット (input_audio_buffer.commit)
3. audioSent フラグを設定 (Path2に通知)
4. STT結果を受信 (conversation.item.input_audio_transcription.completed)
5. 入力テキストを表示
6. (モード2のみ) テキスト翻訳を実行 (Chat API)
7. 翻訳テキストを表示
8. Path1完了マーク
```

**主要メソッド**:
```javascript
async process(segment)           // セグメント処理
async sendAudioToServer(segment) // 音声送信
async performTextTranslation()   // テキスト翻訳
```

#### VoicePathProcessor (Path2)

**処理フロー**:
```
1. Path1の音声送信完了を待機 (audioSent フラグ)
2. 音声翻訳リクエスト送信 (response.create)
3. 翻訳音声を受信 (response.audio.delta/done)
4. 音声を再生
5. (モード1のみ) 翻訳テキストを表示
6. Path2完了マーク
```

**主要メソッド**:
```javascript
async process(segment)              // セグメント処理
async waitForAudioSent(segment)     // 音声送信待機
async requestVoiceTranslation()     // 音声翻訳リクエスト
```

**モード設定**:
- **モード1**: テキスト表示あり (Path2で翻訳テキスト表示)
- **モード2**: テキスト表示なし (Path1でテキスト翻訳実行)

---

### 6. voicetranslate-utils.js

**目的**: 共通ユーティリティとヘルパークラス
**依存**: なし
**主要クラス**:

#### ResponseQueue
```javascript
class ResponseQueue {
  pendingQueue          // 待機中リクエスト
  processingQueue       // 処理中リクエスト

  enqueue(request)      // リクエスト追加
  consume()             // リクエスト処理
  complete(responseId)  // リクエスト完了
  reset()               // キューリセット
}
```

#### VoiceActivityDetector (VAD)
```javascript
class VoiceActivityDetector {
  threshold             // エネルギー閾値
  debounceTime          // デバウンス時間

  process(audioData)    // 音声検出
  isSpeech(energy)      // 音声判定
}
```

#### CONFIG
```javascript
const CONFIG = {
  API: {
    REALTIME_URL      // Realtime API URL
    REALTIME_MODEL    // Realtime APIモデル
    CHAT_MODEL        // Chat APIモデル
  },
  AUDIO: {
    SAMPLE_RATE       // サンプルレート (24000Hz)
    CHANNELS          // チャンネル数 (1)
    CHUNK_SIZE        // チャンクサイズ (4800サンプル)
  },
  VAD: {
    THRESHOLD         // VAD閾値
    DEBOUNCE_TIME     // デバウンス時間
  }
}
```

#### AudioUtils
```javascript
const AudioUtils = {
  floatTo16BitPCM()     // Float32 → PCM16変換
  base64ToArrayBuffer() // Base64 → ArrayBuffer変換
  arrayBufferToBase64() // ArrayBuffer → Base64変換
  calculateRMS()        // RMS計算
}
```

---

### 7. voicetranslate-state-manager.js

**目的**: アプリケーション状態の一元管理
**依存**: なし
**主要機能**:
- 状態の保持と更新
- 状態変更の通知 (Observer パターン)
- localStorage との同期
- 設定の検証

**状態カテゴリ**:
```javascript
state: {
  // 接続状態
  apiKey, isConnected, isRecording

  // 言語設定
  sourceLang, targetLang, voiceType

  // 音声ソース
  audioSourceType, systemAudioSourceId

  // 音声設定
  outputVolume, inputAudioOutputEnabled

  // セッション情報
  sessionStartTime, charCount
}

resources: {
  ws, audioContext, outputAudioContext,
  mediaStream, processor, audioSource, inputGainNode
}

responseState: {
  activeResponseId, pendingResponseId, lastCommitTime
}

vadBuffer: {
  speechStartTime, silenceConfirmTimer,
  minSpeechDuration, silenceConfirmDelay
}
```

---

### 8. Electronモジュール

#### electron/main.ts

**目的**: Electronメインプロセス
**主要機能**:
- ウィンドウ管理
- システムトレイ統合
- グローバルショートカット
- システム音声キャプチャ
- IPC通信

**主要メソッド**:
```typescript
createMainWindow()              // メインウィンドウ作成
createTray()                    // システムトレイ作成
registerGlobalShortcuts()       // ショートカット登録
handleIPCMessages()             // IPC通信処理
```

#### electron/audioCapture.ts

**目的**: システム音声キャプチャ
**主要機能**:
- デスクトップ音声キャプチャ
- Teams/Zoomウィンドウ検出
- 音声ストリーム管理

#### electron/ConversationDatabase.ts

**目的**: 会話履歴データベース管理
**主要機能**:
- SQLiteデータベース操作
- 会話履歴の保存・取得
- 統計情報の集計

**データベーススキーマ**:
```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  sourceLanguage TEXT NOT NULL,
  targetLanguage TEXT NOT NULL,
  sourceText TEXT NOT NULL,
  translatedText TEXT NOT NULL,
  audioUrl TEXT
);
```

---

### 9. TypeScriptモジュール (src/)

#### src/core/VoiceTranslateCore.ts

**目的**: TypeScript版メインアプリケーション
**特徴**: 型安全性、モジュールシステム
**用途**: Electron環境での実行

#### src/audio/AudioPipeline.ts

**目的**: 音声処理パイプライン
**主要機能**:
- VAD処理
- リサンプリング
- エンコード
- ストリーミング送信

#### src/integrations/TeamsIntegration.ts

**目的**: Teams統合
**主要機能**:
- Teamsウィンドウ検出
- 会議情報取得
- 音声キャプチャ

**注意**: 現在はモック実装、実際のTeams APIは未実装

#### src/integrations/ZoomIntegration.ts

**目的**: Zoom統合
**主要機能**:
- Zoomウィンドウ検出
- 会議情報取得
- 音声キャプチャ

**注意**: 現在はモック実装、実際のZoom APIは未実装

---

## 実行モード

### モード1: Electronデスクトップアプリ

**起動方法**:
```bash
npm run dev
```

**特徴**:
- システム音声キャプチャ可能
- Teams/Zoom統合可能
- データベース永続化
- グローバルショートカット
- システムトレイ統合

**音声ソース**:
- マイク入力
- システム音声 (デスクトップ全体)
- 特定ウィンドウ (Teams/Zoom)

---

### モード2: Chrome拡張機能

**インストール方法**:
1. Chrome拡張機能管理ページを開く
2. 「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」
4. プロジェクトルートディレクトリを選択

**特徴**:
- ブラウザタブ音声キャプチャ
- ポップアップUI
- 軽量・高速起動

**音声ソース**:
- マイク入力
- タブ音声 (chrome.tabCapture API)

**制限事項**:
- システム音声キャプチャ不可
- Teams/Zoom統合不可
- データベース永続化不可

---

## 翻訳処理フロー

### 全体フロー図

```
┌─────────────────────────────────────────────────────────────┐
│                    音声入力                                  │
│  マイク / システム音声 / タブ音声                            │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    VAD (音声検出)                            │
│  - エネルギー計算                                            │
│  - 音声/無音判定                                             │
│  - デバウンス処理                                            │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    音声バッファリング                        │
│  - 最小発話時長: 1秒                                         │
│  - 無音確認遅延: 500ms                                       │
│  - PCM16変換                                                 │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    AudioSegment作成                          │
│  - セグメントID生成                                          │
│  - 音声データ格納                                            │
│  - タイムスタンプ記録                                        │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    AudioQueue追加                            │
│  - processingQueue に追加                                    │
│  - processNextSegment() 呼び出し                             │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    排他制御チェック                          │
│  - isProcessing == false ?                                   │
│    YES → 処理開始                                            │
│    NO  → 待機                                                │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    'segmentReady' イベント                   │
│  - handleNewAudioSegment() 呼び出し                          │
└─────────────────────────────────────────────────────────────┘
                        ↓
        ┌───────────────┴───────────────┐
        ↓                               ↓
┌──────────────────┐          ┌──────────────────┐
│  Path1: テキスト │          │  Path2: 音声     │
│  (順次実行)      │          │  (順次実行)      │
└──────────────────┘          └──────────────────┘
        ↓                               ↓
┌──────────────────┐          ┌──────────────────┐
│ 1. 音声送信      │          │ 1. 音声送信待機  │
│ 2. STT実行       │          │ 2. 翻訳リクエスト│
│ 3. テキスト表示  │          │ 3. 音声受信      │
│ 4. テキスト翻訳  │          │ 4. 音声再生      │
│    (モード2のみ) │          │ 5. テキスト表示  │
│ 5. 翻訳表示      │          │    (モード1のみ) │
└──────────────────┘          └──────────────────┘
        ↓                               ↓
        └───────────────┬───────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    両パス完了                                │
│  - handleSegmentComplete()                                   │
│  - isProcessing = false                                      │
│  - processNextSegment() → 次のセグメント処理                 │
└─────────────────────────────────────────────────────────────┘
```

### モード別処理フロー

#### モード1: 音声→音声翻訳 (Voice-to-Voice)

```
音声入力
  ↓
Path1: テキスト処理
  1. 音声送信 (input_audio_buffer.append/commit)
  2. STT実行 (Realtime API)
  3. 入力テキスト表示 (左カラム)
  4. ❌ テキスト翻訳なし
  5. Path1完了

Path2: 音声処理
  1. 音声送信完了待機
  2. 音声翻訳リクエスト (response.create)
  3. 翻訳音声受信 (response.audio.delta/done)
  4. 音声再生
  5. ✅ 翻訳テキスト表示 (右カラム)
  6. Path2完了
```

**特徴**:
- 低遅延 (200-500ms)
- 音声品質が高い
- テキスト翻訳なし (Realtime APIのみ)

---

#### モード2: 音声→テキスト→テキスト翻訳→音声

```
音声入力
  ↓
Path1: テキスト処理
  1. 音声送信 (input_audio_buffer.append/commit)
  2. STT実行 (Realtime API)
  3. 入力テキスト表示 (左カラム)
  4. ✅ テキスト翻訳実行 (Chat API)
  5. 翻訳テキスト表示 (右カラム)
  6. Path1完了

Path2: 音声処理
  1. 音声送信完了待機
  2. 音声翻訳リクエスト (response.create)
  3. 翻訳音声受信 (response.audio.delta/done)
  4. 音声再生
  5. ❌ テキスト表示なし (Path1で表示済み)
  6. Path2完了
```

**特徴**:
- テキスト翻訳の精度が高い (Chat API使用)
- 翻訳テキストと音声が一致
- 遅延がやや大きい (Chat API呼び出し分)

---

## 主要機能

### 1. 対面会話翻訳

**使用シーン**: 1対1の会話、会議、プレゼンテーション

**音声ソース**: マイク入力

**処理フロー**:
1. マイク権限取得
2. 音声入力開始
3. VADで音声検出
4. リアルタイム翻訳
5. 音声再生 + テキスト表示

**設定項目**:
- 入力言語 (自動検出可能)
- 出力言語
- 音声タイプ (alloy, echo, fable, onyx, nova, shimmer)
- 出力音量

---

### 2. Teams/Zoom監視

**使用シーン**: オンライン会議の同時通訳

**音声ソース**: システム音声 (特定ウィンドウ)

**処理フロー**:
1. Teams/Zoomウィンドウ検出
2. ウィンドウ音声キャプチャ
3. リアルタイム翻訳
4. 音声再生 + テキスト表示

**制限事項**:
- Electronアプリのみ対応
- Windows/Mac/Linuxで動作確認必要
- 現在はモック実装 (実際のAPI未実装)

**実装状態**:
- ✅ ウィンドウ検出機能
- ✅ 音声キャプチャ機能
- ❌ Teams API統合 (モック実装)
- ❌ Zoom API統合 (モック実装)

---

### 3. ブラウザ動画翻訳

**使用シーン**: YouTube、Netflix、オンライン講義の翻訳

**音声ソース**: タブ音声 (chrome.tabCapture API)

**処理フロー**:
1. タブ音声キャプチャ権限取得
2. タブ音声ストリーム取得
3. リアルタイム翻訳
4. 音声再生 + テキスト表示

**制限事項**:
- Chrome拡張機能のみ対応
- タブごとに権限が必要
- 一部のサイトでは動作しない可能性

---

### 4. 会話履歴管理

**機能**:
- 会話履歴の自動保存
- 履歴の検索・フィルタリング
- 統計情報の表示
- エクスポート機能

**データベース**: SQLite (better-sqlite3)

**保存内容**:
- タイムスタンプ
- 入力言語・出力言語
- 入力テキスト
- 翻訳テキスト
- 音声URL (オプション)

**実装状態**:
- ✅ データベーススキーマ定義
- ✅ 基本的なCRUD操作
- ❌ UI統合 (未実装)
- ❌ エクスポート機能 (未実装)

---

### 5. VAD (音声活性検出)

**目的**: 音声と無音を区別し、適切なタイミングで翻訳を実行

**実装方式**:
- **クライアントVAD**: ローカルでエネルギー計算
- **サーバーVAD**: OpenAI Realtime APIのVAD機能

**パラメータ**:
```javascript
VAD_CONFIG = {
  threshold: 0.01,              // エネルギー閾値
  debounceTime: 300,            // デバウンス時間 (ms)
  minSpeechDuration: 1000,      // 最小発話時長 (ms)
  silenceConfirmDelay: 500      // 無音確認遅延 (ms)
}
```

**効果**:
- 短音声誤発送を75%削減
- API呼び出しを40%削減
- 連続発話の分割を防止

---

## 問題点と改善提案

### 🔴 重大な問題

#### 1. Teams/Zoom統合がモック実装

**問題**:
- `src/integrations/TeamsIntegration.ts` と `ZoomIntegration.ts` は現在モック実装
- 実際のTeams/Zoom APIは未統合
- 会議情報取得が固定値を返す

**影響**:
- Teams/Zoom監視機能が実質的に使用不可
- ドキュメントと実装が乖離

**改善提案**:
```typescript
// 現在 (モック実装)
protected async fetchMeetingInfo(): Promise<MeetingInfo | null> {
    // モック会議情報
    return {
        id: 'teams-meeting-1',
        name: 'Teams Meeting',
        // ...
    };
}

// 改善案
protected async fetchMeetingInfo(): Promise<MeetingInfo | null> {
    // 実際のTeams Graph APIを使用
    const response = await fetch('https://graph.microsoft.com/v1.0/me/onlineMeetings', {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
    });
    return await response.json();
}
```

**対応方針**:
1. Teams Graph API統合
2. Zoom SDK統合
3. OAuth認証フロー実装
4. エラーハンドリング強化

---

#### 2. 2つの独立したコードベース (重複コード)

**問題**:
- HTML + JavaScript版 (voicetranslate-*.js)
- TypeScript版 (src/)
- 同じ機能が2つのコードベースに存在
- メンテナンスコストが2倍

**影響**:
- バグ修正が2箇所必要
- 機能追加が2箇所必要
- コードの一貫性が保証されない

**改善提案**:
```
現在:
  teams-realtime-translator.html
    ├── voicetranslate-pro.js (手書き)
    └── ...

  src/
    ├── core/VoiceTranslateCore.ts (TypeScript)
    └── ...

改善案:
  src/
    ├── core/VoiceTranslateCore.ts (TypeScript)
    └── ...

  dist/
    ├── voicetranslate-pro.js (ビルド出力)
    └── ...

  teams-realtime-translator.html
    └── <script src="dist/voicetranslate-pro.js"></script>
```

**対応方針**:
1. TypeScript版を正式版とする
2. JavaScript版を廃止
3. ビルドプロセスを統一
4. ブラウザ版もTypeScriptからビルド

---

#### 3. console.log の使用 (デバッグコード残存)

**問題**:
- 多数の `console.log`, `console.info`, `console.warn` が残存
- コーディング規範違反 (Logger使用必須)
- 本番環境でパフォーマンス低下

**影響**:
- ブラウザコンソールが大量のログで埋まる
- デバッグ情報が外部に漏洩する可能性
- ESLint警告が発生

**改善提案**:
```javascript
// ❌ 現在
console.info('[Audio] セグメント処理開始:', { id: segment.id });

// ✅ 改善案
import { Logger } from './utils/Logger';
Logger.debug('セグメント処理開始', { id: segment.id });
```

**対応方針**:
1. すべての `console.*` を `Logger` に置き換え
2. ログレベルを適切に設定 (debug, info, warn, error)
3. 本番環境ではdebugログを無効化
4. ESLint設定を厳格化

---

### 🟡 中程度の問題

#### 4. エラーハンドリングが不十分

**問題**:
- try-catchが一部のみ
- エラー発生時のリカバリー処理が不足
- ユーザーへのエラー通知が不明確

**影響**:
- エラー発生時にアプリが停止
- ユーザーが原因を特定できない
- デバッグが困難

**改善提案**:
```javascript
// ❌ 現在
async process(segment) {
    await this.sendAudioToServer(segment);
    // エラーハンドリングなし
}

// ✅ 改善案
async process(segment) {
    try {
        await this.sendAudioToServer(segment);
    } catch (error) {
        Logger.error('音声送信エラー', { error, segmentId: segment.id });
        this.app.notify('エラー', '音声送信に失敗しました', 'error');
        throw error; // 上位でハンドリング
    }
}
```

---

#### 5. テストカバレッジが低い

**問題**:
- テストファイルが少ない
- カバレッジが目標 (80%) に達していない
- 重要な機能のテストが不足

**影響**:
- リグレッションバグが発生しやすい
- リファクタリングが困難
- 品質保証が不十分

**改善提案**:
1. 重要なモジュールのテストを優先的に作成
   - AudioQueue
   - TextPathProcessor / VoicePathProcessor
   - ResponseQueue
2. E2Eテストの追加
3. CI/CDでカバレッジチェックを強制

---

#### 6. TypeScript型定義が不完全

**問題**:
- 一部のファイルで `any` 型が使用されている
- インターフェースが不足
- 型推論が効いていない箇所がある

**影響**:
- 型安全性が低下
- IDEの補完が効かない
- バグが発生しやすい

**改善提案**:
```typescript
// ❌ 現在
function process(data: any): any {
    return data.value;
}

// ✅ 改善案
interface AudioData {
    value: Float32Array;
    sampleRate: number;
}

function process(data: AudioData): Float32Array {
    return data.value;
}
```

---

### 🟢 軽微な問題

#### 7. ドキュメントの不一致

**問題**:
- README.mdとARCHITECTURE.mdの内容が一部古い
- コードとドキュメントが乖離している箇所がある

**改善提案**:
1. ドキュメントの定期的な更新
2. コード変更時にドキュメントも更新
3. ドキュメント生成の自動化

---

#### 8. 設定ファイルの分散

**問題**:
- 設定が複数のファイルに分散
  - CONFIG (voicetranslate-utils.js)
  - AppConfig (src/config/AppConfig.ts)
  - .env ファイル

**改善提案**:
1. 設定を一元管理
2. 環境変数の優先順位を明確化
3. 設定検証機能の追加

---

## 未使用コード一覧

### 🗑️ 完全に未使用のファイル

#### 1. src/examples/

**パス**: `src/examples/`
**内容**: サンプルコード、使用例
**理由**: 実際のアプリケーションで使用されていない
**推奨**: 削除、またはdocs/に移動

---

#### 2. src/core/Config.js

**パス**: `src/core/Config.js`
**内容**: JavaScriptにコンパイルされた設定ファイル
**理由**: TypeScriptソース (Config.ts) が存在
**推奨**: .gitignoreに追加、dist/に移動

---

#### 3. src/interfaces/ICoreTypes.js

**パス**: `src/interfaces/ICoreTypes.js`
**内容**: JavaScriptにコンパイルされた型定義
**理由**: TypeScriptソース (ICoreTypes.ts) が存在
**推奨**: .gitignoreに追加、dist/に移動

---

#### 4. audio-processor-worklet.js

**パス**: `audio-processor-worklet.js` (ルート)
**内容**: AudioWorklet処理
**使用状況**: VirtualAudioDevice.ts で参照されているが、実際には使用されていない可能性
**推奨**: 使用状況を確認、未使用なら削除

---

#### 5. echo-canceller-worklet.js

**パス**: `echo-canceller-worklet.js` (ルート)
**内容**: エコーキャンセラー
**使用状況**: コード内で参照されていない
**推奨**: 削除、または将来の機能として保留

---

### 🔄 重複コード

#### 6. ResponseQueue の重複

**場所**:
- `voicetranslate-utils.js` (JavaScript版)
- `src/core/ImprovedResponseQueue.ts` (TypeScript版)

**推奨**: TypeScript版に統一

---

#### 7. VoiceActivityDetector の重複

**場所**:
- `voicetranslate-utils.js` (JavaScript版)
- `src/core/VAD.ts` (TypeScript版)
- `electron/VoiceActivityDetector.ts` (Electron版)

**推奨**: TypeScript版に統一、Electron版は削除

---

#### 8. CONFIG の重複

**場所**:
- `voicetranslate-utils.js` (JavaScript版)
- `src/core/Config.ts` (TypeScript版)
- `src/config/AppConfig.ts` (TypeScript版)

**推奨**: AppConfig.ts に統一

---

### 📦 使用頻度が低いモジュール

#### 9. src/audio/VirtualAudioDevice.ts

**使用状況**: 参照されているが、実際に使用されているか不明
**推奨**: 使用状況を確認、未使用なら削除

---

#### 10. src/audio/EchoCanceller.ts

**使用状況**: コード内で参照されていない
**推奨**: 将来の機能として保留、またはドキュメント化

---

#### 11. src/features/SpeakerDiarization.ts

**使用状況**: コード内で参照されていない
**推奨**: 将来の機能として保留、またはドキュメント化

---

#### 12. src/features/LanguageDetector.ts

**使用状況**: コード内で参照されていない (Realtime APIの自動検出を使用)
**推奨**: 削除、またはドキュメント化

---

### 🧪 テスト関連

#### 13. src/test/PerformanceTestFramework.ts

**使用状況**: テストコードで使用されていない
**推奨**: 実際のテストを作成、または削除

---

#### 14. src/test/QualityMetrics.ts

**使用状況**: テストコードで使用されていない
**推奨**: 実際のテストを作成、または削除

---

## 開発・ビルド・実行手順

### 環境構築

#### 1. 必要な環境

- Node.js 20.x 以上
- npm 10.x 以上
- Git

#### 2. 依存関係のインストール

```bash
cd simultaneous_interpretation
npm install
```

#### 3. 環境変数の設定

`.env` ファイルを作成:

```bash
# OpenAI API設定
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_REALTIME_MODEL=gpt-realtime-2025-08-28
OPENAI_CHAT_MODEL=gpt-4o

# デバッグモード
DEBUG_MODE=false
```

---

### 開発モード

#### Electronアプリ

```bash
# 開発サーバー起動 (ホットリロード)
npm run dev

# または
npm run electron:dev
```

#### Chrome拡張機能

1. TypeScriptをビルド:
```bash
npm run build:extension
```

2. Chrome拡張機能管理ページで読み込み:
   - `chrome://extensions/`
   - 「デベロッパーモード」を有効化
   - 「パッケージ化されていない拡張機能を読み込む」
   - プロジェクトルートディレクトリを選択

---

### ビルド

#### TypeScriptコンパイル

```bash
# すべてのTypeScriptをコンパイル
npm run build:all

# コアモジュールのみ
npm run build:core

# Electronのみ
npm run build:electron

# 拡張機能のみ
npm run build:extension
```

#### Electronアプリのパッケージング

```bash
# すべてのプラットフォーム
npm run dist

# Windows
npm run dist:win

# Mac
npm run dist:mac

# Linux
npm run dist:linux
```

---

### テスト

```bash
# すべてのテストを実行
npm test

# ウォッチモード
npm run test:watch

# カバレッジ
npm run test:coverage

# 詳細モード
npm run test:verbose
```

---

### 品質チェック

```bash
# すべての品質チェック
npm run quality

# 型チェック
npm run type-check

# ESLint
npm run lint
npm run lint:fix

# Prettier
npm run format
npm run format:check
```

---

### 実行

#### Electronアプリ

```bash
# 開発モード
npm run dev

# 本番モード
npm run electron
```

#### Chrome拡張機能

1. 拡張機能アイコンをクリック
2. ポップアップウィンドウが開く
3. APIキーを入力
4. 「接続」ボタンをクリック

---

## まとめ

### プロジェクトの強み

✅ **低遅延翻訳**: 200-500msの応答時間
✅ **双パス処理**: テキストと音声を並行処理
✅ **排他制御**: 音声セグメントの順次処理で精度向上
✅ **2つのプラットフォーム**: Electron + Chrome拡張
✅ **柔軟な音声ソース**: マイク、システム音声、タブ音声
✅ **2つの翻訳モード**: Voice-to-Voice / Text-based

### 改善が必要な点

🔴 **Teams/Zoom統合**: モック実装を実際のAPI統合に
🔴 **コードベース統一**: JavaScript版とTypeScript版の統一
🔴 **デバッグコード削除**: console.logをLoggerに置き換え
🟡 **エラーハンドリング**: try-catchの追加とリカバリー処理
🟡 **テストカバレッジ**: 80%以上を目標に
🟡 **型安全性**: any型の削除とインターフェース追加

### 次のステップ

1. **P0 (最優先)**:
   - console.logをLoggerに置き換え
   - JavaScript版とTypeScript版の統一
   - ESLintエラー0を達成

2. **P1 (高優先)**:
   - Teams/Zoom API統合
   - エラーハンドリング強化
   - テストカバレッジ向上

3. **P2 (中優先)**:
   - 未使用コードの削除
   - ドキュメント更新
   - パフォーマンス最適化

---

**作成者**: VoiceTranslate Pro Team
**最終更新**: 2025-10-26
**バージョン**: 2.0.0

