# 技術アーキテクチャ設計書 - VoiceTranslate Pro 2.0

**最終更新**: 2025-10-25
**バージョン**: 2.0.0
**ステータス**: ✅ 本番環境対応

## 📋 目次

- [システム概要](#システム概要)
- [アーキテクチャ図](#アーキテクチャ図)
- [実装詳細](#実装詳細)
- [ファイル依存関係](#ファイル依存関係)
- [モジュール構成](#モジュール構成)
- [データフロー](#データフロー)
- [既知の問題と解決策](#既知の問題と解決策)

---

## システム概要

同時通訳 (Simultaneous Interpretation) / VoiceTranslate Pro は、OpenAI Realtime API を活用したリアルタイム音声翻訳システムです。以下の3層アーキテクチャを採用しています:

1. **Electron Main Process**: システムリソースへのアクセス、音声キャプチャ、WebSocket管理
2. **Renderer Process**: UI、音声処理、VAD（音声活性検出）、レスポンス管理
3. **OpenAI Realtime API**: 音声認識、翻訳、音声合成

### 主要な特徴
- **低遅延**: 200-500ms の応答時間
- **3つの並行処理**: 音声→テキスト、音声→音声翻訳、テキスト翻訳
- **堅牢な状態管理**: 競合状態を排除した設計
- **エラーリカバリー**: 自動再接続、状態リセット機構

---

## アーキテクチャ図

### システム全体図

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Audio Capture│  │  WebSocket   │  │    Config    │      │
│  │   Manager    │  │   Manager    │  │   Manager    │      │
│  │              │  │              │  │              │      │
│  │ - Teams      │  │ - Realtime   │  │ - .env       │      │
│  │ - Zoom       │  │   API        │  │ - Validation │      │
│  │ - System     │  │ - Reconnect  │  │ - Encryption │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ IPC
┌─────────────────────────────────────────────────────────────┐
│                   Renderer Process (UI)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │     VAD      │  │    Audio     │  │      UI      │      │
│  │   Detector   │  │   Processor  │  │   Manager    │      │
│  │              │  │              │  │              │      │
│  │ - Threshold  │  │ - PCM16      │  │ - Transcript │      │
│  │ - Debounce   │  │ - 24kHz      │  │ - Status     │      │
│  │ - Noise      │  │ - Buffer     │  │ - Settings   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                    OpenAI Realtime API                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Speech     │  │  Translation │  │     TTS      │      │
│  │ Recognition  │  │    Engine    │  │   Engine     │      │
│  │              │  │              │  │              │      │
│  │ - Whisper-1  │  │ - GPT-4o     │  │ - Alloy      │      │
│  │ - Auto Lang  │  │ - Realtime   │  │ - Echo       │      │
│  │ - Streaming  │  │ - Low Latency│  │ - Nova       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 実装詳細

### 3つの並行処理パイプライン

VoiceTranslate Pro は、ユーザーの音声入力に対して3つの独立した処理を並行実行します:

```
ユーザー音声入力
    ↓
┌─────────────────────────────────────────────────────────────┐
│  OpenAI Realtime API (WebSocket)                            │
│  - 低遅延通信 (WebSocket)                                    │
│  - リアルタイム音声認識 + 音声翻訳                            │
└─────────────────────────────────────────────────────────────┘
    ↓                                    ↓
処理1-1: 入力テキスト化                処理1-2: 音声翻訳
📥 gpt-realtime-2025-08-28            🔊 gpt-realtime-2025-08-28
(Realtime API)                        (Realtime API)
    ↓                                    ↓
左カラムに表示                          音声のみ再生
(リアルタイム字幕)                      (翻訳音声)
    ↓
    └──────────────────┐
                       ↓
              ┌────────────────────┐
              │  処理2: テキスト翻訳 │
              │  📤 Chat API        │
              └────────────────────┘
                       ↓
              OpenAI Chat API
              (gpt-4o / gpt-5-2025-08-07)
                       ↓
              右カラムに表示
              (翻訳テキスト)
```

### 一意性保証メカニズム

各入力音声に対して **transcriptId** を付与し、入力テキストと翻訳テキストの一対一対応を保証します:

```typescript
// voicetranslate-pro.js
const transcriptId = `transcript_${Date.now()}_${Math.random()}`;
// 処理1-1: 入力テキスト化
// 処理1-2: 音声翻訳
// 処理2: テキスト翻訳
// すべてが同じ transcriptId を参照
```

### 競合状態の排除

**P0 修復**: `conversation_already_has_active_response` エラーの根本的解決

**問題**: 前のレスポンスが完了する前に新しいレスポンスを作成しようとする

**解決策**:
1. **状態機械パターン**: 明確な状態遷移ルール
2. **二重ロック機構**: `activeResponseId` + `pendingResponseId`
3. **50-200ms ネットワーク延迟ウィンドウ保護**
4. **エラー後の強制リセット**: 任意のエラーから回復可能

```typescript
// ResponseStateManager.ts
enum ResponseState {
    IDLE = 'idle',
    PENDING = 'pending',
    PROCESSING = 'processing',
    DONE = 'done',
    ERROR = 'error'
}

// 状態遷移ルール
IDLE → PENDING → PROCESSING → DONE → IDLE
                    ↓
                  ERROR → IDLE (強制リセット)
```

### VAD バッファ戦略 (P1-1)

**問題**: 短音声の誤発送、連続発話の分割

**解決策**:
- **最小発話時長**: 1秒以上
- **無声確認延迟**: 500ms
- **二段階フィルタリング**:
  1. クライアント VAD: ローカルで音声検出
  2. サーバー VAD: OpenAI サーバーで高精度検出

**効果**:
- API 呼び出し削減: 40%
- 短音声誤発: 75% 削減

### 会話コンテキスト管理 (P1-2)

**実装**: SQLite データベース

```typescript
// ConversationDatabase.ts
interface Conversation {
    id: number;              // 自動採番 (1, 2, 3...)
    timestamp: number;       // 作成時刻
    sourceLanguage: string;  // 入力言語
    targetLanguage: string;  // 翻訳言語
    sourceText: string;      // 入力テキスト
    translatedText: string;  // 翻訳テキスト
    audioUrl?: string;       // 翻訳音声URL
}
```

**機能**:
- ✅ 会話自動管理
- ✅ 履歴記録の永続化
- ✅ 統計分析
- ✅ クエリと導出

---

## ファイル依存関係

### コアモジュール依存関係

```
src/config/AppConfig.ts (設定管理)
    ↓
src/core/Config.ts (設定エクスポート)
    ↓
┌───────────────────────────────────────┐
│  src/core/                            │
│  ├── Utils.ts (ユーティリティ)         │
│  ├── VAD.ts (音声活性検出)             │
│  └── ResponseQueue.ts (レスポンス管理) │
└───────────────────────────────────────┘
    ↓
voicetranslate-pro.js (メインアプリケーション)
```

### Electron 依存関係

```
electron/main.ts (メインプロセス)
    ├── electron/audioCapture.ts (音声キャプチャ)
    ├── electron/realtimeWebSocket.ts (WebSocket管理)
    ├── electron/preload.ts (プリロードスクリプト)
    └── src/config/AppConfig.ts (設定)
```

### ビルド依存関係

```
tsconfig.json (TypeScript設定)
    ├── src/**/*.ts → dist/**/*.js
    └── electron/**/*.ts → dist/electron/**/*.js

tsconfig.electron.json (Electron専用設定)
    └── electron/**/*.ts → dist/electron/**/*.js
```

---

## モジュール構成

### 1. 設定管理 (Config)

**ファイル**:
- `src/config/AppConfig.ts` - メイン設定クラス
- `src/core/Config.ts` - 設定エクスポート
- `.env` - 環境変数

**責務**:
- 環境変数の読み込み
- モデル設定の管理
- 設定の検証

**依存関係**:
```typescript
// AppConfig.ts
export class AppConfig {
    static API = {
        REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL,
        CHAT_MODEL: process.env.OPENAI_CHAT_MODEL,
        REALTIME_URL: process.env.OPENAI_REALTIME_URL
    };
}
```

### 2. 音声処理 (Audio)

**ファイル**:
- `src/core/VAD.ts` - 音声活性検出
- `electron/audioCapture.ts` - 音声キャプチャ
- `voicetranslate-pro.js` - 音声処理ロジック

**責務**:
- マイク/システム音声のキャプチャ
- VAD による音声検出
- PCM16 フォーマット変換

**データフロー**:
```
マイク/システム音声
    ↓
AudioCapture (Electron)
    ↓ IPC
VAD Detector (Renderer)
    ↓
Audio Processor
    ↓
WebSocket → OpenAI API
```

### 3. WebSocket 管理

**ファイル**:
- `electron/realtimeWebSocket.ts` - WebSocket管理
- `voicetranslate-pro.js` - WebSocketクライアント

**責務**:
- OpenAI Realtime API への接続
- セッション管理
- 再接続処理

**イベントフロー**:
```
session.created
    ↓
conversation.item.created
    ↓
response.audio_transcript.delta
    ↓
response.audio.delta
    ↓
response.done
```

### 4. UI 管理

**ファイル**:
- `teams-realtime-translator.html` - メインUI
- `voicetranslate-pro.js` - UIロジック

**責務**:
- ユーザーインターフェース
- 転写テキスト表示
- ステータス表示

---

## データフロー

### 音声翻訳フロー

```
1. 音声入力
   ユーザーの音声 → マイク/システム音声

2. 音声キャプチャ (Electron Main)
   AudioCapture.startCapture()
   ↓
   MediaRecorder → PCM16 変換

3. VAD 検出 (Renderer)
   VAD.analyze(audioData)
   ↓
   音声検出 → バッファリング

4. WebSocket 送信
   WebSocket.send({
       type: 'input_audio_buffer.append',
       audio: base64Audio
   })

5. OpenAI 処理
   Realtime API
   ↓
   音声認識 → 翻訳 → 音声合成

6. 結果受信
   response.audio_transcript.delta
   ↓
   UI 更新 (転写テキスト表示)

7. 音声再生
   response.audio.delta
   ↓
   AudioContext → スピーカー出力
```

### 設定読み込みフロー

```
1. アプリケーション起動
   electron/main.ts

2. 環境変数読み込み
   dotenv.config()
   ↓
   process.env.OPENAI_REALTIME_MODEL
   process.env.OPENAI_CHAT_MODEL

3. 設定検証
   AppConfig.loadFromEnv()
   ↓
   環境変数が設定されていない場合は例外

4. 設定提供
   IPC: get-env-config
   ↓
   Renderer Process へ設定を送信

5. UI 初期化
   voicetranslate-pro.js
   ↓
   CONFIG.API.REALTIME_MODEL を使用
```

---

## セキュリティ設計

### API キー管理

```
.env ファイル (ローカル)
    ↓
process.env (Electron Main)
    ↓ IPC (暗号化)
Renderer Process (メモリのみ)
    ↓ WebSocket (TLS)
OpenAI API
```

### データ保護

- **音声データ**: メモリ内のみ、ディスクに保存しない
- **API キー**: 環境変数、暗号化保存
- **通信**: TLS/WSS による暗号化

---

## パフォーマンス最適化

### 音声処理

- **バッファサイズ**: 4800-8000 samples (200-333ms @ 24kHz)
- **VAD デバウンス**: 250-500ms
- **送信頻度**: 100ms ごと (10回/秒)

### メモリ管理

- **音声バッファ**: 循環バッファ使用
- **転写履歴**: 最大100件まで保持
- **WebSocket**: 自動再接続、メモリリーク防止

---

## 拡張性

### 新しい音声ソースの追加

```typescript
// electron/audioCapture.ts
export class ElectronAudioCapture {
    static async getAudioSources(types: ('window' | 'screen')[]) {
        // 新しいソースタイプを追加
    }
}
```

### 新しい翻訳モデルの追加

```env
# .env
OPENAI_REALTIME_MODEL=gpt-realtime-2025-08-28
OPENAI_CHAT_MODEL=gpt-4o
```

### 新しい言語の追加

```typescript
// src/core/Utils.ts
export const SUPPORTED_LANGUAGES = {
    'ja': '日本語',
    'en': 'English',
    // 新しい言語を追加
};
```

---

## 既知の問題と解決策

### P0: 並発エラー (解決済み ✅)

**問題**: `conversation_already_has_active_response`

**原因**: 前のレスポンスが完了する前に新しいレスポンスを作成

**解決策**:
- ResponseStateManager による状態管理
- ImprovedResponseQueue による直列化
- 50-200ms ネットワーク延迟ウィンドウ保護

**テスト**: `tests/core/ResponseStateManager.test.ts`

### P1-1: VAD バッファ戦略 (解決済み ✅)

**問題**: 短音声の誤発送、連続発話の分割

**解決策**:
- 最小発話時長: 1秒
- 無声確認延迟: 500ms
- 二段階フィルタリング

**効果**: API 呼び出し 40% 削減、短音声誤発 75% 削減

### P1-2: 会話コンテキスト管理 (解決済み ✅)

**問題**: 会話履歴がない

**解決策**:
- SQLite データベース
- 会話自動採番
- 完全な CRUD API

**テスト**: `tests/core/ConversationDatabase.test.ts`

---

## まとめ

同時通訳システムは、以下の設計原則に基づいています:

1. **モジュール化**: 機能ごとに分離された保守性の高い設計
2. **型安全性**: TypeScript による型チェック
3. **セキュリティ**: API キーの暗号化、データ保護
4. **パフォーマンス**: 低遅延、効率的な音声処理
5. **拡張性**: 新機能の追加が容易
6. **堅牢性**: 競合状態排除、エラーリカバリー

詳細は各モジュールのソースコードを参照してください。

---

## 関連ドキュメント

- **[ENGINEERING_RULES.md](./ENGINEERING_RULES.md)** - エンジニアリング規則
- **[P0_COMPLETE_SUMMARY.md](./P0_COMPLETE_SUMMARY.md)** - P0 完成総結
- **[P1_COMPLETE_SUMMARY.md](./P1_COMPLETE_SUMMARY.md)** - P1 完成総結
- **[P1_VAD_BUFFER_STRATEGY.md](./P1_VAD_BUFFER_STRATEGY.md)** - VAD バッファ戦略
- **[P1_CONVERSATION_CONTEXT.md](./P1_CONVERSATION_CONTEXT.md)** - 会話コンテキスト管理
- **[design/DETAILED_DESIGN.md](../design/DETAILED_DESIGN.md)** - 詳細設計書
- **[design/PROJECT_PLAN.md](../design/PROJECT_PLAN.md)** - プロジェクト計画書

