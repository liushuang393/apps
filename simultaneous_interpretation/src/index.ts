/**
 * VoiceTranslate Pro - メインエクスポート
 *
 * @description
 * すべてのモジュールを一箇所からエクスポート
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

// 設定
export {
    AppConfig,
    type AudioPresetName,
    type AudioPresetConfig,
    type VADSensitivityConfig,
    type VADModeConfig
} from './config';

// インターフェース（IAudioPipeline.ts からのインターフェース定義）
export type {
    IAudioPipeline,
    IVADProcessor,
    IResamplerProcessor,
    IEncoderProcessor
} from './interfaces/IAudioPipeline';

export type { IWebSocketAdapter, IConfigManager, ITranslationService } from './interfaces';

export type { AudioData, LanguageInfo } from './interfaces/ICoreTypes';

// アダプター
export * from './adapters';

// サービス
export { LatencyOptimizer } from './services';

// 音声処理（実装クラスとローカル型定義）
export {
    AudioProcessor,
    type AudioProcessingResult,
    type IAudioProcessor
} from './audio/AudioProcessor';
export { VADProcessor, type VADConfig, type VADResult } from './audio/VADProcessor';
export { ResamplerProcessor } from './audio/ResamplerProcessor';
export { EncoderProcessor, AudioFormat } from './audio/EncoderProcessor';
export { AudioPipeline, AudioPipelineBuilder } from './audio/AudioPipeline';
export { SystemAudioCapture } from './audio/SystemAudioCapture';

// コアクラス
export { VoiceTranslateCore } from './core/VoiceTranslateCore';
export { WebSocketManager } from './core/WebSocketManager';
export { AudioManager } from './core/AudioManager';
export { UIManager } from './core/UIManager';
export { VoiceActivityDetector } from './core/VAD';
export { ResponseStateManager, ResponseState } from './core/ResponseStateManager';
export { ImprovedResponseQueue } from './core/ImprovedResponseQueue';
export type { ResponseRequest } from './core/ImprovedResponseQueue';

// ユーティリティ
export * from './utils';
