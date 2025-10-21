# 使用ガイド - VoiceTranslate Pro 2.0

## 📚 目次

1. [クイックスタート](#クイックスタート)
2. [モジュール使用例](#モジュール使用例)
3. [設定方法](#設定方法)
4. [トラブルシューティング](#トラブルシューティング)

---

## クイックスタート

### インストール

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev

# ビルド
npm run build
```

### 基本的な使用方法

```typescript
import {
    AppConfig,
    BrowserWebSocketAdapter,
    AudioPipeline,
    VADProcessor,
    ResamplerProcessor,
    EncoderProcessor,
    ErrorHandler,
    LatencyOptimizer
} from './src';

// 1. 設定の初期化
AppConfig.loadFromEnv();

// 2. WebSocket アダプターの作成
const wsAdapter = new BrowserWebSocketAdapter();
await wsAdapter.initialize({
    url: AppConfig.API.REALTIME_URL,
    model: AppConfig.API.REALTIME_MODEL,
    apiKey: 'your-api-key'
});

// 3. 音声処理パイプラインの構築
const pipeline = new AudioPipeline();
pipeline.addProcessor(new VADProcessor());
pipeline.addProcessor(new ResamplerProcessor({ targetSampleRate: 24000, quality: 'high' }));
pipeline.addProcessor(new EncoderProcessor({ format: 'pcm16' }));
await pipeline.initialize();

// 4. エラーハンドラーの設定
const errorHandler = new ErrorHandler();

// 5. 遅延最適化の設定
const latencyOptimizer = new LatencyOptimizer();
latencyOptimizer.setWebSocketAdapter(wsAdapter);

// 6. 接続
await wsAdapter.connect();
```

---

## モジュール使用例

### 1. WebSocket アダプター

#### ブラウザ環境

```typescript
import { BrowserWebSocketAdapter } from './src/adapters';

const adapter = new BrowserWebSocketAdapter();

await adapter.initialize({
    url: 'wss://api.openai.com/v1/realtime',
    model: 'gpt-realtime-2025-08-28',
    apiKey: 'your-api-key',
    reconnect: {
        enabled: true,
        maxAttempts: 5,
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2
    }
}, {
    onOpen: () => console.log('Connected'),
    onMessage: (msg) => console.log('Message:', msg),
    onError: (err) => console.error('Error:', err),
    onClose: (code, reason) => console.log('Closed:', code, reason)
});

await adapter.connect();

// メッセージ送信
await adapter.send({ type: 'session.update', session: { ... } });

// バイナリデータ送信
await adapter.sendBinary(audioBuffer);

// 切断
await adapter.disconnect();
```

#### Electron 環境

```typescript
import { ElectronWebSocketAdapter } from './src/adapters';

const adapter = new ElectronWebSocketAdapter();

// メインプロセスに接続
await adapter.connectToMainProcess();

// 以降はブラウザ版と同じ
await adapter.initialize({ ... });
await adapter.connect();
```

---

### 2. 音声処理パイプライン

```typescript
import {
    AudioPipeline,
    AudioPipelineBuilder,
    VADProcessor,
    ResamplerProcessor,
    EncoderProcessor
} from './src/audio';

// ビルダーパターンで構築
const pipeline = new AudioPipelineBuilder()
    .addProcessor(new VADProcessor({
        threshold: 0.01,
        debounce: 300,
        minSpeechMs: 500
    }))
    .addProcessor(new ResamplerProcessor({
        targetSampleRate: 24000,
        quality: 'high'
    }))
    .addProcessor(new EncoderProcessor({
        format: 'pcm16'
    }))
    .build();

await pipeline.initialize();

// 音声データを処理
const result = await pipeline.process({
    samples: audioSamples,
    sampleRate: 48000,
    channels: 1,
    timestamp: Date.now()
});

if (result.success) {
    console.log('Processed:', result.data);
} else {
    console.error('Error:', result.error);
}
```

---

### 3. エラーハンドラー

```typescript
import { ErrorHandler, AppError, ErrorCategory, ErrorSeverity, RecoveryStrategy } from './src/services';

const errorHandler = new ErrorHandler({
    enableLogging: true,
    enableUserNotification: true,
    enableAutoRecovery: true,
    maxRetries: 3,
    retryDelay: 1000
});

// カスタムエラーの作成
const error = new AppError({
    code: 'CUSTOM_ERROR',
    message: 'Something went wrong',
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.ERROR,
    recoveryStrategy: RecoveryStrategy.RETRY,
    userMessage: 'エラーが発生しました。再試行しています...',
    retryable: true
});

// エラー処理
const recovered = await errorHandler.handleError(error);

if (recovered) {
    console.log('Error recovered successfully');
} else {
    console.log('Manual intervention required');
}

// エラー履歴の取得
const history = errorHandler.getErrorHistory();
console.log('Error history:', history);
```

---

### 4. 遅延最適化

```typescript
import { LatencyOptimizer } from './src/services';

const optimizer = new LatencyOptimizer({
    enablePreconnect: true,
    enableStreaming: true,
    enableAsync: true,
    chunkSizeMs: 100,
    bufferSizeMs: 300
});

// WebSocket 事前接続
await optimizer.preconnectWebSocket();

// ストリーミング開始
await optimizer.startStreaming();

// 音声データをストリーミング送信
await optimizer.streamAudio(audioBuffer);

// 非同期関数呼び出し
await optimizer.callFunctionAsync(
    async () => {
        // 重い処理
        return await heavyOperation();
    },
    (result) => console.log('Success:', result),
    (error) => console.error('Error:', error)
);

// 遅延測定
const { result, latency } = await optimizer.measureLatency(async () => {
    return await someOperation();
});
console.log(`Operation completed in ${latency}ms`);

// 統計情報
const stats = optimizer.getStats();
console.log('Queue size:', stats.queueSize);
console.log('Is processing:', stats.isProcessing);
```

---

### 5. ユーティリティ

#### 音声ユーティリティ

```typescript
import { AudioUtils } from './src/utils';

// Float32 → PCM16 変換
const pcm16 = AudioUtils.floatTo16BitPCM(float32Samples);

// Base64 エンコード
const base64 = AudioUtils.arrayBufferToBase64(audioBuffer);

// RMS 計算
const rms = AudioUtils.calculateRMS(samples);

// 無音検出
const isSilent = AudioUtils.isSilence(samples, 0.01);

// 音声データを正規化
const normalized = AudioUtils.normalizeAudio(samples);
```

#### 共通ユーティリティ

```typescript
import { CommonUtils } from './src/utils';

// 時間フォーマット
const timeStr = CommonUtils.formatTime(3665); // "01:01:05"

// 言語名取得
const langName = CommonUtils.getLanguageName('ja'); // "Japanese"
const nativeName = CommonUtils.getNativeLanguageName('ja'); // "日本語"

// デバウンス
const debouncedFn = CommonUtils.debounce(() => {
    console.log('Debounced!');
}, 300);

// リトライ
const result = await CommonUtils.retry(async () => {
    return await unstableOperation();
}, 3, 1000);

// タイムアウト付き実行
const result = await CommonUtils.withTimeout(
    longRunningOperation(),
    5000,
    'Operation timed out'
);
```

---

## 設定方法

### 環境変数

`.env` ファイルを作成:

```env
OPENAI_API_KEY=your-api-key
OPENAI_REALTIME_MODEL=gpt-realtime-2025-08-28
OPENAI_CHAT_MODEL=gpt-4o
OPENAI_REALTIME_URL=wss://api.openai.com/v1/realtime
DEBUG_MODE=false
```

### プログラムでの設定

```typescript
import { AppConfig } from './src/config';

// 環境変数から読み込み
AppConfig.loadFromEnv();

// 手動設定
AppConfig.API.REALTIME_MODEL = 'gpt-realtime-2025-08-28';
AppConfig.AUDIO_PRESET = 'LOW_LATENCY';

// 設定検証
const validation = AppConfig.validate();
if (!validation.valid) {
    console.error('Configuration errors:', validation.errors);
}

// 現在のプリセット取得
const preset = AppConfig.getAudioPreset();
console.log('Buffer size:', preset.BUFFER_SIZE);
```

---

## トラブルシューティング

### WebSocket 接続エラー

**問題**: WebSocket 接続が失敗する

**解決策**:
1. API キーを確認
2. ネットワーク接続を確認
3. CORS 設定を確認（ブラウザ環境）
4. プロキシ設定を確認

```typescript
// デバッグログを有効化
AppConfig.DEBUG_MODE = true;

// 接続タイムアウトを延長
await adapter.initialize({
    ...config,
    connectionTimeout: 60000 // 60秒
});
```

### 音声処理エラー

**問題**: 音声が正しく処理されない

**解決策**:
1. サンプリングレートを確認（24kHz 必須）
2. チャンネル数を確認（モノラル推奨）
3. VAD 閾値を調整

```typescript
// VAD 感度を調整
const vad = new VADProcessor({
    threshold: 0.005, // より敏感に
    debounce: 200     // より短く
});
```

### メモリリーク

**問題**: 長時間使用でメモリが増加

**解決策**:
1. 使用後に必ず dispose を呼ぶ
2. イベントリスナーを解除

```typescript
// クリーンアップ
await pipeline.dispose();
await adapter.dispose();
await optimizer.dispose();
```

---

## ベストプラクティス

### 1. エラーハンドリング

```typescript
try {
    await adapter.connect();
} catch (error) {
    await errorHandler.handleError(error);
}
```

### 2. リソース管理

```typescript
// 使用後は必ずクリーンアップ
try {
    // 処理
} finally {
    await pipeline.dispose();
    await adapter.dispose();
}
```

### 3. パフォーマンス最適化

```typescript
// 事前接続で初回遅延を削減
await optimizer.preconnectWebSocket();

// ストリーミングで遅延を削減
await optimizer.startStreaming();
```

---

## サンプルコード

完全なサンプルコードは `examples/` ディレクトリを参照してください。

---

**VoiceTranslate Pro Team**  
**Version 2.0.0**

