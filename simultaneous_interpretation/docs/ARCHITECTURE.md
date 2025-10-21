# アーキテクチャ設計書

## 📋 目次

- [システム概要](#システム概要)
- [アーキテクチャ図](#アーキテクチャ図)
- [ファイル依存関係](#ファイル依存関係)
- [モジュール構成](#モジュール構成)
- [データフロー](#データフロー)

---

## システム概要

同時通訳 (Simultaneous Interpretation) は、Electron ベースのデスクトップアプリケーションで、以下の3層アーキテクチャを採用しています:

1. **Electron Main Process**: システムリソースへのアクセス、音声キャプチャ
2. **Renderer Process**: UI、音声処理、VAD
3. **OpenAI Realtime API**: 音声認識、翻訳、音声合成

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

## まとめ

同時通訳システムは、以下の設計原則に基づいています:

1. **モジュール化**: 機能ごとに分離された保守性の高い設計
2. **型安全性**: TypeScript による型チェック
3. **セキュリティ**: API キーの暗号化、データ保護
4. **パフォーマンス**: 低遅延、効率的な音声処理
5. **拡張性**: 新機能の追加が容易

詳細は各モジュールのソースコードを参照してください。

