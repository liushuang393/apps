# VoiceTranslate Pro - 音質向上機能 API ドキュメント

## 📚 概要

このドキュメントは、VoiceTranslate Pro の音質向上機能の API リファレンスです。

---

## 📦 モジュール一覧

### 1. AdaptiveVADBuffer

**場所**: `src/audio/AdaptiveVADBuffer.ts`

言語・シナリオ・ユーザーの発話パターンに応じてVADパラメータを動的に調整します。

#### コンストラクタ

```typescript
constructor(language: string, scenario: ScenarioPreset = 'conversation')
```

**パラメータ**:
- `language`: 言語コード ('ja' | 'en' | 'zh' | 'vi')
- `scenario`: シナリオ ('meeting' | 'conversation' | 'quickChat')

#### メソッド

##### calculateOptimalParams()

```typescript
calculateOptimalParams(): VADParameters
```

最適なVADパラメータを計算します。

**戻り値**:
```typescript
{
    minDuration: number;        // 最小発話時長 (ms)
    silenceDelay: number;       // 無声確認遅延 (ms)
    language: string;           // 使用言語
    scenario: ScenarioPreset;   // 使用シナリオ
    adaptiveApplied: boolean;   // 適応調整が適用されたか
}
```

##### recordSpeech()

```typescript
recordSpeech(duration: number, silenceBefore: number): void
```

発話を記録して適応的調整に使用します。

**パラメータ**:
- `duration`: 発話時長 (ms)
- `silenceBefore`: 発話前の無声時長 (ms)

##### setLanguage()

```typescript
setLanguage(language: string): void
```

言語を変更します（履歴はリセットされます）。

##### setScenario()

```typescript
setScenario(scenario: ScenarioPreset): void
```

シナリオを変更します。

---

### 2. AudioValidator

**場所**: `src/audio/AudioValidator.ts`

音声データの有効性を検証し、無音・無効なデータの送信を防ぎます。

#### コンストラクタ

```typescript
constructor(config?: Partial<AudioValidationConfig>)
```

**デフォルト設定**:
```typescript
{
    minSampleCount: 4800,    // 200ms @ 24kHz
    minRMSEnergy: 0.001,
    maxZeroRatio: 0.95,
    includeDetails: false
}
```

#### メソッド

##### validate()

```typescript
validate(audioData: Float32Array): ValidationResult
```

音声データを検証します。

**戻り値**:
```typescript
{
    valid: boolean;
    reason?: string;
    details?: ValidationDetails;
}
```

##### calculateRMS()

```typescript
calculateRMS(data: Float32Array): number
```

RMS（Root Mean Square）エネルギーを計算します。

##### calculateQualityMetrics()

```typescript
calculateQualityMetrics(data: Float32Array): AudioQualityMetrics
```

詳細な品質メトリクスを計算します。

---

### 3. StreamingAudioSender

**場所**: `src/audio/StreamingAudioSender.ts`

音声データを小さなチャンクに分割してストリーミング送信します。

#### コンストラクタ

```typescript
constructor(
    sendFn: SendAudioChunkFunction,
    config?: Partial<StreamingAudioSenderConfig>
)
```

**デフォルト設定**:
```typescript
{
    chunkSize: 2400,        // 100ms @ 24kHz
    sendInterval: 100,      // 100ms
    maxBufferSize: 48000    // 2秒 @ 24kHz
}
```

#### メソッド

##### start()

```typescript
start(): void
```

ストリーミング送信を開始します。

##### stop()

```typescript
stop(): void
```

ストリーミング送信を停止します。

##### append()

```typescript
append(audioData: Float32Array): void
```

音声データをバッファに追加します（自動的に送信されます）。

##### flush()

```typescript
flush(): void
```

すべてのバッファをフラッシュして送信します。

---

### 4. NoiseSuppression

**場所**: `src/audio/NoiseSuppression.ts`

Web Audio API を使用してノイズを抑制します。

#### コンストラクタ

```typescript
constructor(config?: Partial<NoiseSuppressionConfig>)
```

**デフォルト設定**:
```typescript
{
    highpassFreq: 100,   // 100Hz
    lowpassFreq: 8000,   // 8kHz
    gain: 1.0,
    enabled: true
}
```

#### メソッド

##### apply()

```typescript
apply(
    stream: MediaStream,
    audioContext: AudioContext
): MediaStreamAudioDestinationNode
```

ノイズサプレッションを適用します。

**戻り値**: 処理済みの MediaStreamAudioDestinationNode

##### updateConfig()

```typescript
updateConfig(config: Partial<NoiseSuppressionConfig>): void
```

設定を動的に更新します。

##### dispose()

```typescript
dispose(): void
```

リソースを解放します。

---

### 5. ConversationContext

**場所**: `src/context/ConversationContext.ts`

会話履歴を管理し、翻訳の一貫性を保ちます。

#### コンストラクタ

```typescript
constructor(maxHistory: number = 5, maxAgeMs: number = 300000)
```

**パラメータ**:
- `maxHistory`: 最大履歴件数（デフォルト: 5）
- `maxAgeMs`: 最大年齢（デフォルト: 5分）

#### メソッド

##### addEntry()

```typescript
addEntry(
    sourceText: string,
    translatedText: string,
    language: string,
    confidence?: number
): void
```

会話エントリを追加します。

##### getContext()

```typescript
getContext(options?: ContextGenerationOptions): ContextInfo
```

コンテキスト情報を取得します。

**戻り値**:
```typescript
{
    contextString: string;
    terminology: Map<string, string>;
    historyCount: number;
    oldestTimestamp: number | null;
}
```

---

### 6. TerminologyManager

**場所**: `src/context/TerminologyManager.ts`

術語辞書を管理し、翻訳の術語一貫性を保ちます。

#### メソッド

##### addUserTerm()

```typescript
addUserTerm(entry: TermEntry): void
```

ユーザー術語を追加します。

**TermEntry**:
```typescript
{
    source: string;
    target: string;
    domain: string;
    priority: number;    // 1-10
    createdAt: number;
}
```

##### generateInstructions()

```typescript
generateInstructions(params: InstructionsParams): string
```

OpenAI API 用の Instructions を生成します。

**パラメータ**:
```typescript
{
    sourceLang: string;
    targetLang: string;
    domain?: string;
    customInstructions?: string;
    style?: 'formal' | 'casual' | 'technical';
}
```

##### saveToLocalStorage()

```typescript
saveToLocalStorage(key?: string): void
```

LocalStorage に保存します。

##### loadFromLocalStorage()

```typescript
loadFromLocalStorage(key?: string): number
```

LocalStorage から読み込みます。戻り値は読み込まれた術語数。

---

### 7. ResponseQueue (改修版)

**場所**: `src/core/ResponseQueue.ts`

タイムアウトとリトライ機能を持つレスポンスキュー。

#### コンストラクタ

```typescript
constructor(
    sendMessageFn: SendMessageFunction<T>,
    options: ResponseQueueOptions = {}
)
```

**新しいオプション**:
```typescript
{
    maxQueueSize?: number;
    timeout?: number;           // NEW: デフォルト 30秒
    maxRetries?: number;        // NEW: デフォルト 2回
    retryBaseDelay?: number;    // NEW: デフォルト 1秒
    debugMode?: boolean;
}
```

#### メソッド

##### enqueue()

```typescript
enqueue(request: T): Promise<string>
```

リクエストをキューに追加します。タイムアウト・リトライを自動処理します。

##### handleResponseDone()

```typescript
handleResponseDone(responseId: string): void
```

レスポンス完了を通知します（タイムアウトタイマーをクリア）。

##### handleError()

```typescript
handleError(error: Error, code?: string): void
```

エラーを処理します（必要に応じてリトライ）。

##### getStats()

```typescript
getStats(): QueueStats
```

統計情報を取得します。

**戻り値**:
```typescript
{
    totalRequests: number;
    completedRequests: number;
    failedRequests: number;
    retriedRequests: number;      // NEW
    timeoutRequests: number;      // NEW
    pendingCount: number;
    processingCount: number;
}
```

---

## 🔧 使用例

### 基本的な使い方

```typescript
// 1. AdaptiveVADBuffer
const vadBuffer = new AdaptiveVADBuffer('ja', 'meeting');
const params = vadBuffer.calculateOptimalParams();
console.log('VAD Params:', params);

// 発話完了後に記録
vadBuffer.recordSpeech(1500, 600);

// 2. AudioValidator
const validator = new AudioValidator();
const result = validator.validate(audioData);

if (!result.valid) {
    console.warn('Invalid audio:', result.reason);
    return;
}

// 3. StreamingAudioSender
const sender = new StreamingAudioSender((base64Audio) => {
    ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64Audio
    }));
}, {
    chunkSize: 2400,
    sendInterval: 100
});

sender.start();
sender.append(audioData);
sender.flush();
sender.stop();

// 4. NoiseSuppression
const noiseSuppression = new NoiseSuppression({
    highpassFreq: 100,
    lowpassFreq: 8000
});

const processedStream = noiseSuppression.apply(stream, audioContext);

// 5. ConversationContext
const context = new ConversationContext(5, 300000);
context.addEntry('Hello', 'こんにちは', 'en');

const info = context.getContext();
console.log('Context:', info.contextString);

// 6. TerminologyManager
const termManager = new TerminologyManager();
termManager.addUserTerm({
    source: 'AI',
    target: '人工知能',
    domain: 'IT',
    priority: 10,
    createdAt: Date.now()
});

const instructions = termManager.generateInstructions({
    sourceLang: 'en',
    targetLang: 'ja',
    style: 'formal'
});

// 7. ResponseQueue (改修版)
const queue = new ResponseQueue(sendFn, {
    timeout: 30000,
    maxRetries: 2,
    retryBaseDelay: 1000
});

try {
    const responseId = await queue.enqueue(request);
    console.log('Response:', responseId);
} catch (error) {
    console.error('Request failed:', error);
}
```

---

## 📖 詳細ドキュメント

- [統合ガイド](./統合ガイド.md)
- [最終完了報告書](./最終完了報告書.md)
- [タスク管理表](./03_タスク管理表.md)

---

**最終更新**: 2025-10-26


