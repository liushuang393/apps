# パフォーマンス改善ガイド - フレームドロップ対策

## 📋 概要

Teams/ブラウザ監視モードでの深刻なフレームドロップ問題を解決するための改善を実施しました。

## 🔍 問題の原因

### 1. ScriptProcessorNode使用（主要因）
- **問題**: メインスレッドで音声処理を実行し、UIをブロック
- **影響**: 深刻なフレームドロップ、品質低下
- **対象ファイル**:
  - `AudioProcessingPipeline.ts`
  - `AudioRouter.ts`

### 2. 大きなバッファサイズ
- **問題**: デフォルト4096サンプル（約170ms @ 24kHz）
- **影響**: 遅延が大きく、リアルタイム性が低下

### 3. エコーキャンセレーション設定
- **問題**: システム音声でエコーキャンセレーションが無効
- **影響**: 個人対話時にエコーが発生

## ✅ 実施した改善

### 1. AudioWorklet移行（最重要）

#### AudioProcessingPipeline.ts
```typescript
// ✅ 改善後: AudioWorklet優先、ScriptProcessorNodeはフォールバック
private async createProcessingNodes(): Promise<void> {
    // AudioWorklet を優先使用
    try {
        await this.setupAudioWorklet();
    } catch (error) {
        logger.warn('AudioWorklet setup failed, falling back to ScriptProcessorNode', error);
        this.setupScriptProcessor();
    }
}

private async setupAudioWorklet(): Promise<void> {
    await this.audioContext.audioWorklet.addModule('audio-processor-worklet.js');
    this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor-worklet');
    
    this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audiodata' && this.audioCallback) {
            const audioData = event.data.data as Float32Array;
            this.processAudioData(audioData);
        }
    };
}
```

**効果**:
- ✅ メインスレッドのブロック解消
- ✅ フレームドロップ大幅削減
- ✅ 音声処理が独立スレッドで実行

#### AudioRouter.ts
同様にAudioWorklet対応を追加し、複数音声ソースのミキシング時もパフォーマンスを維持。

### 2. 超低遅延プリセット追加

#### Config.ts
```typescript
export type AudioPresetName =
    | 'BALANCED'
    | 'AGGRESSIVE'
    | 'LOW_LATENCY'
    | 'ULTRA_LOW_LATENCY'  // ✅ 新規追加
    | 'SERVER_VAD';

AUDIO_PRESETS: {
    // 方案D: 超低遅延型（Teams/ブラウザ監視用）
    ULTRA_LOW_LATENCY: {
        BUFFER_SIZE: 2048,      // 85ms @ 24kHz
        MIN_SPEECH_MS: 300,     // 最小音声長さ
        VAD_DEBOUNCE: 150,      // VAD去抖動時間
        DESCRIPTION: '超低遅延 - Teams/ブラウザ監視最適化、フレームドロップ防止'
    }
}
```

**効果**:
- ✅ バッファサイズ 4096 → 2048（遅延半減）
- ✅ Teams/Zoom監視に最適化
- ✅ リアルタイム性向上

### 3. エコーキャンセレーション改善

#### SystemAudioCapture.ts
```typescript
export interface SystemAudioCaptureConfig {
    // ... 既存設定 ...
    /** 個人対話モード（エコー防止強化） */
    personalConversationMode?: boolean;  // ✅ 新規追加
}

constructor(config: Partial<SystemAudioCaptureConfig> = {}) {
    const personalMode = config.personalConversationMode ?? false;
    
    this.config = {
        sampleRate: config.sampleRate ?? 24000,
        channelCount: config.channelCount ?? 1,
        // ✅ 個人対話モード時は自動的にエコーキャンセレーション有効化
        echoCancellation: personalMode ? true : (config.echoCancellation ?? false),
        noiseSuppression: personalMode ? true : (config.noiseSuppression ?? false),
        autoGainControl: personalMode ? true : (config.autoGainControl ?? false),
        personalConversationMode: personalMode
    };
}
```

**効果**:
- ✅ 個人対話時のエコー防止
- ✅ 設定の簡素化（1つのフラグで全て制御）

## 📊 パフォーマンス比較

### バッファサイズ比較（@ 24kHz）

| プリセット | バッファサイズ | 遅延 | 用途 |
|-----------|--------------|------|------|
| AGGRESSIVE | 8000 | 333ms | 最高精度 |
| BALANCED | 6000 | 250ms | 推奨設定 |
| LOW_LATENCY | 4800 | 200ms | 低遅延 |
| **ULTRA_LOW_LATENCY** | **2048** | **85ms** | **Teams/監視** |

### 処理方式比較

| 方式 | メインスレッド負荷 | フレームドロップ | 推奨度 |
|------|------------------|----------------|--------|
| ScriptProcessorNode | 高 | 多い | ❌ 非推奨 |
| **AudioWorklet** | **低** | **ほぼ無し** | **✅ 推奨** |

## 🚀 使用方法

### 1. Teams/ブラウザ監視モード（推奨設定）

```typescript
import { CONFIG, setAudioPreset } from './core/Config';
import { SystemAudioCapture } from './audio/SystemAudioCapture';

// 超低遅延プリセットに変更
setAudioPreset('ULTRA_LOW_LATENCY');

// システム音声キャプチャ（監視モード）
const systemAudio = new SystemAudioCapture({
    sampleRate: 24000,
    channelCount: 1,
    echoCancellation: false,      // 監視モードではfalse
    noiseSuppression: false,
    autoGainControl: false
});
```

### 2. 個人対話モード（エコー防止）

```typescript
// 個人対話モード（エコーキャンセレーション自動有効化）
const systemAudio = new SystemAudioCapture({
    sampleRate: 24000,
    channelCount: 1,
    personalConversationMode: true  // ✅ これだけでOK
});
```

### 3. AudioProcessingPipeline使用

```typescript
import { AudioProcessingPipeline } from './audio/AudioProcessingPipeline';
import { getAudioPreset } from './core/Config';

const preset = getAudioPreset();

const pipeline = new AudioProcessingPipeline({
    sampleRate: 24000,
    channelCount: 1,
    bufferSize: preset.BUFFER_SIZE,  // プリセットから自動取得
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
});

await pipeline.start((audioData) => {
    // 音声データ処理
    // AudioWorkletで処理されるため、メインスレッドをブロックしない
});
```

## 🔧 トラブルシューティング

### AudioWorkletが使用できない場合

AudioWorkletは自動的にScriptProcessorNodeにフォールバックします。
ログで確認できます：

```
[AudioProcessingPipeline] AudioWorklet setup failed, falling back to ScriptProcessorNode
```

**対処法**:
1. `audio-processor-worklet.js` が正しいパスに配置されているか確認
2. ブラウザがAudioWorkletをサポートしているか確認（Chrome 66+, Firefox 76+）

### フレームドロップが続く場合

1. **プリセット確認**: `ULTRA_LOW_LATENCY` を使用しているか
2. **VAD感度**: MEDIUM または HIGH に設定
3. **ブラウザリソース**: 他のタブを閉じる
4. **CPU使用率**: タスクマネージャーで確認

## 📈 期待される効果

### フレームドロップ
- **改善前**: 頻繁に発生（特にTeams/Zoom監視時）
- **改善後**: ほぼ解消（AudioWorklet使用時）

### 遅延
- **改善前**: 170ms（バッファサイズ4096）
- **改善後**: 85ms（ULTRA_LOW_LATENCY使用時）

### 品質
- **改善前**: 音声途切れ、ノイズ多い
- **改善後**: クリアな音声、安定した処理

## 🎯 推奨設定まとめ

### Teams/Zoom監視
```typescript
setAudioPreset('ULTRA_LOW_LATENCY');
// echoCancellation: false
// VAD感度: MEDIUM または HIGH
```

### 個人対話
```typescript
setAudioPreset('BALANCED');
// personalConversationMode: true
// VAD感度: MEDIUM
```

### 高精度翻訳
```typescript
setAudioPreset('AGGRESSIVE');
// VAD感度: LOW
```

## 📝 変更ファイル一覧

1. ✅ `src/core/Config.ts` - ULTRA_LOW_LATENCY プリセット追加
2. ✅ `src/audio/AudioProcessingPipeline.ts` - AudioWorklet対応
3. ✅ `src/audio/AudioRouter.ts` - AudioWorklet対応
4. ✅ `src/audio/SystemAudioCapture.ts` - 個人対話モード追加

## 🔄 後方互換性

すべての変更は後方互換性を維持しています：
- デフォルト設定は変更なし（BALANCED プリセット）
- 既存のコードは修正不要
- AudioWorklet失敗時は自動的にScriptProcessorNodeにフォールバック

---

**作成日**: 2025-10-26  
**バージョン**: 2.0.1  
**対象**: VoiceTranslate Pro 2.0

