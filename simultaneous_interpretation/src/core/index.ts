/**
 * VoiceTranslate Pro - Core Module Exports
 * 
 * 共有コアロジックのエクスポート
 */

// Config
export {
    CONFIG,
    getAudioPreset,
    setAudioPreset,
    setDebugMode,
    type AppConfig,
    type APIConfig,
    type AudioConfig,
    type AudioPresetConfig,
    type AudioPresetName,
    type VADConfig,
    type VADSensitivityConfig
} from './Config';

// Utils
export {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    floatTo16BitPCM,
    formatTime,
    getLanguageName,
    getNativeLanguageName,
    Utils
} from './Utils';

// VAD
export {
    VoiceActivityDetector,
    type VADOptions,
    type VADAnalysisResult
} from './VAD';

// ResponseQueue
export {
    ResponseQueue,
    type ResponseQueueOptions,
    type QueueStats,
    type SendMessageFunction
} from './ResponseQueue';

// WebSocketManager
export {
    WebSocketManager,
    type SessionConfig,
    type WebSocketMessageHandlers,
    type ConnectionStatus
} from './WebSocketManager';

// AudioManager
export {
    AudioManager,
    type AudioSourceType,
    type AudioConstraints,
    type AudioDataCallback
} from './AudioManager';

// UIManager
export {
    UIManager,
    type ConnectionStatus as UIConnectionStatus,
    type NotificationType,
    type TranscriptType,
    type NotificationOptions
} from './UIManager';

// VoiceTranslateCore
export {
    VoiceTranslateCore
} from './VoiceTranslateCore';
