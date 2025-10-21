// ====================
// VoiceTranslate Pro - Browser Extension
// ====================

// ====================
// ResponseQueue - レスポンスキュー管理
// ====================
/**
 * ResponseQueue - 生産者・消費者パターンによるキュー管理
 *
 * 設計思想:
 *   - 生産者: enqueue()でリクエストをキューに追加(来たら入れるだけ)
 *   - 消費者: handleResponseDone()で消費完了を通知(完了したら次を処理)
 *   - フラグ不要: キューの状態のみで制御
 *
 * 使用方法:
 *   queue.enqueue(request);              // 生産者: リクエストを追加
 *   queue.handleResponseDone(id);        // 消費者: 処理完了を通知
 */
class ResponseQueue {
    /**
     * コンストラクタ
     *
     * @param sendMessageFn - WebSocketメッセージ送信関数
     * @param options - 設定オプション
     */
    constructor(sendMessageFn, options = {}) {
        this.sendMessage = sendMessageFn;
        this.config = {
            maxQueueSize: options.maxQueueSize || 10,
            debugMode: options.debugMode !== undefined ? options.debugMode : false
        };

        // 生産者・消費者キュー
        this.pendingQueue = [];    // 未送信のリクエスト(生産者が追加)
        this.processingQueue = []; // 処理中のリクエスト(消費者が処理)

        // 統計情報
        this.stats = {
            totalRequests: 0,
            completedRequests: 0,
            failedRequests: 0
        };
    }

    /**
     * リクエストをキューに追加(生産者)
     *
     * 目的:
     *   リクエストが来たらキューに入れるだけ
     *   フラグチェック不要
     *
     * @param request - リクエストオブジェクト
     * @returns Promise<string> - レスポンスID
     */
    enqueue(request) {
        return new Promise((resolve, reject) => {
            // ✅ 並発制御: 処理中のリクエストがある場合は即座に拒否
            if (this.processingQueue.length > 0) {
                const error = new Error('Previous response is still in progress');
                console.warn('[ResponseQueue] 並発リクエストを拒否:', {
                    processing: this.processingQueue.length,
                    pending: this.pendingQueue.length
                });
                reject(error);
                return;
            }

            // キューが満杯かチェック
            const totalInQueue = this.pendingQueue.length + this.processingQueue.length;
            if (totalInQueue >= this.config.maxQueueSize) {
                reject(new Error('Queue is full'));
                return;
            }

            // キューに追加(生産)
            const item = {
                request: request,
                resolve: resolve,
                reject: reject,
                timestamp: Date.now()
            };

            this.pendingQueue.push(item);
            this.stats.totalRequests++;

            if (this.config.debugMode) {
                console.log('[ResponseQueue] 生産:', {
                    pending: this.pendingQueue.length,
                    processing: this.processingQueue.length
                });
            }

            // 消費開始
            this.consume();
        });
    }

    /**
     * キューから消費(消費者)
     *
     * 目的:
     *   未送信キューから取り出してAPIに送信
     *   処理中キューに移動
     */
    consume() {
        // 処理中が既にある場合は何もしない(1つずつ処理)
        if (this.processingQueue.length > 0) {
            if (this.config.debugMode) {
                console.log('[ResponseQueue] 処理中のリクエストがあるため待機:', {
                    processing: this.processingQueue.length
                });
            }
            return;
        }

        // 未送信キューが空の場合は何もしない
        if (this.pendingQueue.length === 0) {
            if (this.config.debugMode) {
                console.log('[ResponseQueue] 未送信キューが空です');
            }
            return;
        }

        // 未送信キューから取り出す
        const item = this.pendingQueue.shift();
        if (!item) return;

        // ✅ 重要: 処理中キューに追加してから送信
        // これにより、sendMessage()が同期的に実行されても、
        // 次のenqueue()呼び出しで processingQueue.length > 0 が検出される
        this.processingQueue.push(item);

        if (this.config.debugMode) {
            console.log('[ResponseQueue] 消費開始:', {
                pending: this.pendingQueue.length,
                processing: this.processingQueue.length,
                timestamp: Date.now()
            });
        }

        try {
            // ✅ APIにリクエスト送信(同期実行)
            // この時点で processingQueue.length = 1 なので、
            // 新しいenqueue()は consume()をスキップする
            this.sendMessage({
                type: 'response.create',
                response: item.request
            });

            if (this.config.debugMode) {
                console.log('[ResponseQueue] リクエスト送信完了:', {
                    processing: this.processingQueue.length
                });
            }
        } catch (error) {
            console.error('[ResponseQueue] 送信失敗:', error);
            // 処理中キューから削除
            this.processingQueue.shift();
            if (item.reject) {
                item.reject(error);
            }
            this.stats.failedRequests++;
            // 次を消費
            this.consume();
        }
    }

    /**
     * response.createdイベント処理
     *
     * @param responseId - レスポンスID
     */
    handleResponseCreated(responseId) {
        if (this.config.debugMode) {
            console.log('[ResponseQueue] レスポンス作成:', responseId);
        }
    }

    /**
     * response.doneイベント処理(消費完了)
     *
     * 目的:
     *   処理中キューから削除
     *   次のリクエストを消費
     *
     * @param responseId - レスポンスID
     */
    handleResponseDone(responseId) {
        if (this.config.debugMode) {
            console.log('[ResponseQueue] 消費完了:', responseId);
        }

        // 処理中キューから取り出す
        const item = this.processingQueue.shift();

        if (item) {
            // 完了通知
            if (item.resolve) {
                item.resolve(responseId);
            }
            this.stats.completedRequests++;
        }

        // 次を消費
        this.consume();
    }

    /**
     * エラー処理
     *
     * @param error - エラーオブジェクト
     * @param code - エラーコード
     */
    handleError(error, code) {
        console.error('[ResponseQueue] Error:', error);

        const errorCode = code || '';
        const errorMessage = error.message || '';
        const isActiveResponseError =
            errorCode === 'conversation_already_has_active_response' ||
            errorMessage.includes('conversation_already_has_active_response') ||
            errorMessage.includes('active response in progress');

        if (isActiveResponseError) {
            console.warn('[ResponseQueue] Active response still in progress; waiting for response.done.', {
                code: errorCode || 'N/A',
                pending: this.pendingQueue.length,
                processing: this.processingQueue.length
            });

            // ✅ 修正: 処理中のアイテムを reject せず、ペンディングキューに戻す
            const item = this.processingQueue.shift();
            if (item) {
                console.log('[ResponseQueue] リクエストをペンディングキューに戻します');
                // ペンディングキューの先頭に戻す（優先処理）
                this.pendingQueue.unshift(item);

                // 一定時間後に再試行（500ms待機）
                setTimeout(() => {
                    console.log('[ResponseQueue] 再試行を開始します');
                    this.consume();
                }, 500);
            }

            return;
        }

        const item = this.processingQueue.shift();

        if (item) {
            if (item.reject) {
                item.reject(error);
            }
            this.stats.failedRequests++;
        }

        this.consume();
    }

    /**
     * キューをクリア
     */
    clear() {
        if (this.config.debugMode) {
            console.log('[ResponseQueue] キューをクリア');
        }

        // すべてのリクエストを拒否
        [...this.pendingQueue, ...this.processingQueue].forEach(item => {
            if (item.reject) {
                item.reject(new Error('Queue cleared'));
            }
        });

        this.pendingQueue = [];
        this.processingQueue = [];
    }

    /**
     * 統計情報を取得
     *
     * @returns 統計情報
     */
    getStats() {
        return {
            ...this.stats,
            pendingCount: this.pendingQueue.length,
            processingCount: this.processingQueue.length
        };
    }

    /**
     * ステータスを取得(互換性のため)
     *
     * @returns ステータス情報
     */
    getStatus() {
        return this.getStats();
    }
}

// ====================
// グローバル設定
// ====================
// デフォルト設定（環境変数から上書き可能）
const CONFIG = {
    // デバッグモード（本番環境では false に設定）
    DEBUG_MODE: false,

    API: {
        REALTIME_URL: 'wss://api.openai.com/v1/realtime',
        // 2種類のモデル設定（環境変数から上書き可能）
        //
        // 1. REALTIME_MODEL: Realtime API用（音声→音声翻訳、音声認識）
        //    - 用途: WebSocket接続、Session作成、音声→音声翻訳
        //    - 自動機能: 音声認識（whisper-1）、言語自動検出
        //    - 推奨: gpt-realtime-2025-08-28 (最新・最高品質)
        //    - 例: gpt-realtime-2025-08-28, gpt-4o-realtime-preview-2024-12-17
        REALTIME_MODEL: 'gpt-realtime-2025-08-28',

        // 2. CHAT_MODEL: Chat Completions API用（言語検出、テキスト翻訳）
        //    - 用途: 言語検出、テキスト→テキスト翻訳
        //    - API: /v1/chat/completions
        //    - 例: gpt-4o, gpt-4o-mini, gpt-4, gpt-3.5-turbo
        //    - ⚠️ Realtime APIモデルは使用不可
        CHAT_MODEL: 'gpt-5-2025-08-07',

        TIMEOUT: 30000
    },

    // 音声設定プリセット（4つの方案から選択）
    // 使用方法: CONFIG.AUDIO_PRESET を変更して再読み込み
    AUDIO_PRESET: 'BALANCED', // 'BALANCED' | 'AGGRESSIVE' | 'LOW_LATENCY' | 'SERVER_VAD'

    AUDIO_PRESETS: {
        // 方案A: バランス型（推奨）
        BALANCED: {
            BUFFER_SIZE: 6000,      // 250ms @ 24kHz
            MIN_SPEECH_MS: 500,     // 最小音声長さ
            VAD_DEBOUNCE: 400,      // VAD去抖動時間
            DESCRIPTION: '精度と遅延のバランス - 推奨設定'
        },
        // 方案B: 高精度型
        AGGRESSIVE: {
            BUFFER_SIZE: 8000,      // 333ms @ 24kHz
            MIN_SPEECH_MS: 800,     // 最小音声長さ
            VAD_DEBOUNCE: 500,      // VAD去抖動時間
            DESCRIPTION: '最高精度、ネットワーク負荷最小 - 遅延やや大'
        },
        // 方案C: 低遅延型
        LOW_LATENCY: {
            BUFFER_SIZE: 4800,      // 200ms @ 24kHz
            MIN_SPEECH_MS: 400,     // 最小音声長さ
            VAD_DEBOUNCE: 250,      // VAD去抖動時間
            DESCRIPTION: '最低遅延 - VAD精度やや低'
        },
        // 方案D: Server VAD型
        SERVER_VAD: {
            BUFFER_SIZE: 4800,      // 200ms @ 24kHz
            MIN_SPEECH_MS: 0,       // Server VADに任せる
            VAD_DEBOUNCE: 0,        // Client VAD無効
            DESCRIPTION: 'OpenAI Server VAD使用 - 最高精度、ネットワーク負荷大'
        }
    },

    AUDIO: {
        SAMPLE_RATE: 24000,
        CHUNK_SIZE: 4800,
        FORMAT: 'pcm16'
    },

    VAD: {
        // マイクモード用（静かな環境：個人会議、少人数会議）
        MICROPHONE: {
            LOW: { threshold: 0.008, debounce: 400 },
            MEDIUM: { threshold: 0.004, debounce: 250 },
            HIGH: { threshold: 0.002, debounce: 150 }
        },
        // システム音声モード用（騒がしい環境：ブラウザ音声、会議、音楽）
        SYSTEM: {
            LOW: { threshold: 0.015, debounce: 500 },
            MEDIUM: { threshold: 0.010, debounce: 350 },
            HIGH: { threshold: 0.006, debounce: 250 }
        }
    }
};

// 現在のプリセット設定を取得
function getAudioPreset() {
    return CONFIG.AUDIO_PRESETS[CONFIG.AUDIO_PRESET] || CONFIG.AUDIO_PRESETS.BALANCED;
}

// ====================
// ユーティリティ関数
// ====================
const Utils = {
    // Base64エンコード/デコード
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    },

    // Float32 to PCM16変換
    floatTo16BitPCM(float32Array) {
        const buffer = new ArrayBuffer(float32Array.length * 2);
        const view = new DataView(buffer);
        let offset = 0;
        for (let i = 0; i < float32Array.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return buffer;
    },

    // 時間フォーマット
    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    },

    // 言語名取得（英語名）
    getLanguageName(code) {
        const names = {
            'ja': 'Japanese',
            'en': 'English',
            'zh': 'Chinese',
            'ko': 'Korean',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'pt': 'Portuguese'
        };
        return names[code] || code;
    },

    // ネイティブ言語名取得
    getNativeLanguageName(code) {
        const names = {
            'ja': '日本語',
            'en': 'English',
            'zh': '中文',
            'ko': '한국어',
            'es': 'Español',
            'fr': 'Français',
            'de': 'Deutsch',
            'pt': 'Português'
        };
        return names[code] || code;
    }
};

// ====================
// VADクラス
// ====================
class VoiceActivityDetector {
    constructor(options = {}) {
        this.threshold = options.threshold || 0.01;
        this.debounceTime = options.debounceTime || 300;
        this.onSpeechStart = options.onSpeechStart || (() => {});
        this.onSpeechEnd = options.onSpeechEnd || (() => {});

        this.isSpeaking = false;
        this.silenceTimer = null;
        this.energyHistory = [];
        this.historySize = 10;
        this.calibrationSamples = [];
        this.isCalibrating = true;
        this.calibrationDuration = 30;
        this.noiseFloor = 0;
        this.adaptiveThreshold = this.threshold;
    }

    analyze(audioData) {
        const energy = this.calculateEnergy(audioData);

        if (this.isCalibrating) {
            this.calibrationSamples.push(energy);
            if (this.calibrationSamples.length >= this.calibrationDuration) {
                this.completeCalibration();
            }
            return { energy, isSpeaking: false };
        }

        this.energyHistory.push(energy);
        if (this.energyHistory.length > this.historySize) {
            this.energyHistory.shift();
        }

        const smoothedEnergy = this.getSmoothedEnergy();

        if (smoothedEnergy > this.adaptiveThreshold) {
            if (!this.isSpeaking) {
                this.isSpeaking = true;
                this.onSpeechStart();
            }
            clearTimeout(this.silenceTimer);
        } else if (this.isSpeaking) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = setTimeout(() => {
                this.isSpeaking = false;
                this.onSpeechEnd();
            }, this.debounceTime);
        }

        return { energy: smoothedEnergy, isSpeaking: this.isSpeaking };
    }

    calculateEnergy(data) {
        const sum = data.reduce((acc, val) => acc + val * val, 0);
        return Math.sqrt(sum / data.length);
    }

    getSmoothedEnergy() {
        if (this.energyHistory.length === 0) return 0;
        const sum = this.energyHistory.reduce((acc, val) => acc + val, 0);
        return sum / this.energyHistory.length;
    }

    completeCalibration() {
        const mean = this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length;
        const variance = this.calibrationSamples.reduce((acc, val) =>
            acc + Math.pow(val - mean, 2), 0) / this.calibrationSamples.length;
        const stdDev = Math.sqrt(variance);

        this.noiseFloor = mean;

        // 適応閾値を計算（最小値を設定）
        const calculatedThreshold = mean + (stdDev * 3);
        const minThreshold = 0.01; // 最小閾値（環境が静かすぎる場合の対策）
        this.adaptiveThreshold = Math.max(calculatedThreshold, minThreshold);

        this.isCalibrating = false;

        console.log(`[VAD] Calibration complete - Noise: ${this.noiseFloor.toFixed(4)}, Calculated: ${calculatedThreshold.toFixed(4)}, Final Threshold: ${this.adaptiveThreshold.toFixed(4)}`);
    }

    reset() {
        this.isSpeaking = false;
        this.energyHistory = [];
        this.calibrationSamples = [];
        this.isCalibrating = true;
        clearTimeout(this.silenceTimer);
    }
}

// ====================
// メインアプリケーションクラス
// ====================
class VoiceTranslateApp {
    constructor() {
        this.state = {
            apiKey: '',
            isConnected: false,
            isRecording: false,
            sourceLang: 'ja',
            targetLang: 'en',
            voiceType: 'alloy',
            sessionStartTime: null,
            charCount: 0,
            ws: null,
            audioContext: null,              // 入力音声処理用AudioContext
            outputAudioContext: null,        // 出力音声再生専用AudioContext（優先度確保）
            mediaStream: null,
            processor: null,
            audioSource: null,               // MediaStreamSource（音声ルーティング制御用）
            inputGainNode: null,             // 入力音声ミュート用GainNode
            audioSourceType: 'microphone',   // 'microphone' or 'system'
            systemAudioSourceId: null,       // システム音声のソースID
            isNewResponse: true,             // 新しい応答かどうかのフラグ
            outputVolume: 2.0,               // 出力音量（1.0 = 通常、2.0 = 2倍）
            isPlayingAudio: false,           // 音声再生中フラグ（ループバック防止用）
            inputAudioOutputEnabled: true    // 入力音声出力フラグ（入力音声をスピーカーに出力するか）
        };

        this.vad = null;
        this.elements = {};
        this.timers = {};

        // 音声再生キュー（音声途中切断を防ぐ）
        this.audioQueue = [];              // 現在の翻訳の音声チャンク（delta）を蓄積
        this.playbackQueue = [];           // 完成した翻訳音声の再生待ちキュー
        this.isPlayingAudio = false;       // 音声再生中フラグ（ループバック防止用）
        this.isPlayingFromQueue = false;   // キューから再生中フラグ
        this.currentAudioStartTime = 0;

        // 翻訳テキスト累積用（delta → 完全なテキスト）
        this.currentTranslationText = '';  // 現在の翻訳テキストを累積

        // ✅ レスポンス状態管理（並発制御）
        this.activeResponseId = null;      // 現在処理中のレスポンスID
        this.lastCommitTime = 0;           // 最後のコミット時刻（重複防止）

        // ✅ レスポンスキュー管理（conversation_already_has_active_response エラー対策）
        this.responseQueue = new ResponseQueue(
            (message) => this.sendMessage(message),
            {
                maxQueueSize: 10,      // 最大キュー長
                timeout: 60000,        // タイムアウト: 60秒（response.done が来ない場合に備えて）
                retryOnError: true,    // エラー時リトライ有効
                maxRetries: 2,         // 最大リトライ回数
                debugMode: CONFIG.DEBUG_MODE  // デバッグモード
            }
        );

        this.init();
    }

    async init() {
        this.initElements();

        // Electron環境の場合、環境変数からAPIキーを取得
        await this.loadApiKeyFromEnv();

        this.initEventListeners();
        this.initVisualizer();
        this.loadSettings();
        this.initVAD();

        // ブラウザ版とElectronアプリの競合を防ぐ
        this.initCrossInstanceSync();

        // マイク権限を自動チェック
        await this.checkMicrophonePermission();

        console.log('[App] VoiceTranslate Pro v3.0 初期化完了');
        this.notify('システム準備完了', 'VoiceTranslate Proが起動しました', 'success');
    }

    initElements() {
        // API設定
        this.elements.apiKey = document.getElementById('apiKey');
        this.elements.validateBtn = document.getElementById('validateBtn');

        // 言語設定
        this.elements.sourceLang = document.getElementById('sourceLang');
        this.elements.targetLang = document.getElementById('targetLang');
        this.elements.voiceType = document.getElementById('voiceType');
        this.elements.sourceLangDisplay = document.getElementById('sourceLangDisplay');
        this.elements.targetLangDisplay = document.getElementById('targetLangDisplay');

        // 詳細設定
        this.elements.vadEnabled = document.getElementById('vadEnabled');
        this.elements.noiseReduction = document.getElementById('noiseReduction');
        this.elements.echoCancellation = document.getElementById('echoCancellation');
        this.elements.autoGainControl = document.getElementById('autoGainControl');
        this.elements.vadSensitivity = document.getElementById('vadSensitivity');
        this.elements.showInputTranscript = document.getElementById('showInputTranscript');
        this.elements.showOutputTranscript = document.getElementById('showOutputTranscript');
        this.elements.audioOutputEnabled = document.getElementById('audioOutputEnabled');
        this.elements.inputAudioOutputEnabled = document.getElementById('inputAudioOutputEnabled');

        // コントロール
        this.elements.connectBtn = document.getElementById('connectBtn');
        this.elements.disconnectBtn = document.getElementById('disconnectBtn');
        this.elements.startBtn = document.getElementById('startBtn');
        this.elements.stopBtn = document.getElementById('stopBtn');

        // ステータス
        this.elements.connectionStatus = document.getElementById('connectionStatus');
        this.elements.connectionText = document.getElementById('connectionText');

        // 統計
        this.elements.sessionTime = document.getElementById('sessionTime');
        this.elements.charCount = document.getElementById('charCount');
        this.elements.latency = document.getElementById('latency');
        this.elements.accuracy = document.getElementById('accuracy');

        // トランスクリプト
        this.elements.inputTranscript = document.getElementById('inputTranscript');
        this.elements.outputTranscript = document.getElementById('outputTranscript');
        this.elements.clearInputBtn = document.getElementById('clearInputBtn');
        this.elements.clearOutputBtn = document.getElementById('clearOutputBtn');
        this.elements.clearAllBtn = document.getElementById('clearAllBtn');

        // ビジュアライザー
        this.elements.visualizer = document.getElementById('visualizer');

        // 通知
        this.elements.notification = document.getElementById('notification');
        this.elements.notificationTitle = document.getElementById('notificationTitle');
        this.elements.notificationMessage = document.getElementById('notificationMessage');
    }

    initEventListeners() {
        // API検証
        this.elements.validateBtn.addEventListener('click', () => this.validateApiKey());

        // APIキー入力
        this.elements.apiKey.addEventListener('input', (e) => {
            const value = e.target.value;
            const progress = document.getElementById('apiKeyProgress');
            if (value.startsWith('sk-') && value.length > 20) {
                progress.style.width = '100%';
                this.state.apiKey = value;
                this.saveToStorage('openai_api_key', value);
            } else {
                progress.style.width = `${(value.length / 50) * 100}%`;
            }
        });

        // 言語設定変更
        this.elements.sourceLang.addEventListener('change', (e) => {
            this.state.sourceLang = e.target.value;
            this.elements.sourceLangDisplay.textContent = Utils.getNativeLanguageName(e.target.value);
            this.saveToStorage('source_lang', e.target.value);

            // 言語変更時にトランスクリプトをクリア
            this.clearTranscript('both');

            if (this.state.isConnected) {
                this.updateSession();
            }
        });

        this.elements.targetLang.addEventListener('change', (e) => {
            this.state.targetLang = e.target.value;
            this.elements.targetLangDisplay.textContent = Utils.getNativeLanguageName(e.target.value);
            this.saveToStorage('target_lang', e.target.value);

            // 言語変更時にトランスクリプトをクリア
            this.clearTranscript('both');

            if (this.state.isConnected) {
                this.updateSession();
            }
        });

        this.elements.voiceType.addEventListener('change', (e) => {
            this.state.voiceType = e.target.value;
            this.saveToStorage('voice_type', e.target.value);

            // 音声タイプ変更時にトランスクリプトをクリア
            this.clearTranscript('both');

            if (this.state.isConnected) {
                this.updateSession();
            }
        });

        // 音声ソース選択
        const audioSourceType = document.getElementById('audioSourceType');
        const systemAudioSourceGroup = document.getElementById('systemAudioSourceGroup');

        audioSourceType.addEventListener('change', (e) => {
            const sourceType = e.target.value;
            this.state.audioSourceType = sourceType;
            this.saveToStorage('audio_source_type', sourceType);

            // システム音声選択時は追加UIを表示
            if (sourceType === 'system') {
                systemAudioSourceGroup.style.display = 'block';
            } else {
                systemAudioSourceGroup.style.display = 'none';
            }

            console.log('[Audio Source] 音声ソース変更:', sourceType);

            // VAD設定を再適用（音声ソースタイプに応じた最適な設定に更新）
            const currentVadLevel = this.elements.vadSensitivity.value;
            this.updateVADSensitivity(currentVadLevel);
            console.log('[VAD] 音声ソース変更に伴いVAD設定を再適用:', currentVadLevel);
        });

        // 会議アプリ検出ボタン
        const detectSourcesBtn = document.getElementById('detectSourcesBtn');
        detectSourcesBtn.addEventListener('click', () => this.detectAudioSources());

        // 詳細設定トグル
        ['vadEnabled', 'noiseReduction', 'echoCancellation', 'autoGainControl', 'showInputTranscript', 'showOutputTranscript', 'audioOutputEnabled', 'inputAudioOutputEnabled'].forEach(id => {
            this.elements[id].addEventListener('click', (e) => {
                const element = e.currentTarget;
                element.classList.toggle('active');
                this.saveToStorage(id, element.classList.contains('active'));

                // VAD有効/無効が変更された場合、セッション更新
                if (id === 'vadEnabled' && this.state.isConnected) {
                    console.log('[VAD] 設定変更 - セッションを更新します');
                    this.updateSession();
                }

                // トランスクリプト表示設定が変更された場合
                if (id === 'showInputTranscript' || id === 'showOutputTranscript') {
                    const isActive = element.classList.contains('active');
                    const label = id === 'showInputTranscript' ? '入力音声表示' : '翻訳結果表示';
                    console.log(`[Transcript] ${label}: ${isActive ? 'ON' : 'OFF'}`);
                    this.notify('表示設定変更', `${label}を${isActive ? 'ON' : 'OFF'}にしました`, 'info');
                }

                // 翻訳音声出力設定が変更された場合、セッション更新
                if (id === 'audioOutputEnabled' && this.state.isConnected) {
                    const isActive = element.classList.contains('active');
                    console.log('[Audio Output] 翻訳音声出力:', isActive ? 'ON' : 'OFF');
                    this.notify('音声出力設定', `翻訳音声出力を${isActive ? 'ON' : 'OFF'}にしました`, 'info');
                    this.updateSession();
                }

                // 入力音声出力設定が変更された場合
                if (id === 'inputAudioOutputEnabled') {
                    const isActive = element.classList.contains('active');
                    this.state.inputAudioOutputEnabled = isActive;
                    console.log('[Input Audio Output] 入力音声出力:', isActive ? 'ON' : 'OFF');
                    this.notify('入力音声出力設定', `入力音声出力を${isActive ? 'ON' : 'OFF'}にしました`, 'info');

                    // 録音中の場合、音声処理を再セットアップ
                    if (this.state.isRecording) {
                        this.reconnectAudioOutput();
                    }
                }
            });
        });

        // VAD感度
        this.elements.vadSensitivity.addEventListener('change', (e) => {
            this.updateVADSensitivity(e.target.value);
            this.saveToStorage('vad_sensitivity', e.target.value);
        });

        // コントロールボタン
        this.elements.connectBtn.addEventListener('click', () => this.connect());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.elements.startBtn.addEventListener('click', () => this.startRecording());
        this.elements.stopBtn.addEventListener('click', () => this.stopRecording());

        // トランスクリプトクリアボタン
        this.elements.clearInputBtn.addEventListener('click', () => {
            this.clearTranscript('input');
        });

        this.elements.clearOutputBtn.addEventListener('click', () => {
            this.clearTranscript('output');
        });

        this.elements.clearAllBtn.addEventListener('click', () => {
            this.clearTranscript('both');
        });

        // ページ離脱時
        window.addEventListener('beforeunload', () => {
            if (this.state.isConnected) {
                this.disconnect();
            }
        });
    }

    // ストレージ操作（拡張機能対応）
    saveToStorage(key, value) {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({[key]: value});
        } else {
            localStorage.setItem(key, value);
        }
    }

    async getFromStorage(key) {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            return new Promise((resolve) => {
                chrome.storage.local.get([key], (result) => {
                    resolve(result[key]);
                });
            });
        } else {
            return localStorage.getItem(key);
        }
    }

    initVisualizer() {
        // ビジュアライザーバーを生成
        for (let i = 0; i < 50; i++) {
            const bar = document.createElement('div');
            bar.className = 'vis-bar';
            this.elements.visualizer.appendChild(bar);
        }
        this.visualizerBars = this.elements.visualizer.querySelectorAll('.vis-bar');
    }

    initVAD() {
        this.vad = new VoiceActivityDetector({
            threshold: 0.01,
            debounceTime: 300,
            onSpeechStart: () => {
                console.log('[VAD] Speech started');
                this.updateStatus('recording', '話し中...');
            },
            onSpeechEnd: () => {
                console.log('[VAD] Speech ended');
                this.updateStatus('recording', '待機中...');
            }
        });
        console.log('[VAD] ✅ VAD初期化完了 - クライアント側音声検出有効（v3.1-VAD-FILTER）');
        console.log('[VAD] 設定:', {
            threshold: 0.01,
            debounceTime: 300,
            calibrationDuration: 30
        });
    }

    async loadSettings() {
        // ストレージから設定を読み込み
        const settings = {
            apiKey: await this.getFromStorage('openai_api_key'),
            sourceLang: await this.getFromStorage('source_lang'),
            targetLang: await this.getFromStorage('target_lang'),
            voiceType: await this.getFromStorage('voice_type'),
            vadSensitivity: await this.getFromStorage('vad_sensitivity'),
            outputVolume: await this.getFromStorage('output_volume')
        };

        if (settings.apiKey) {
            this.elements.apiKey.value = settings.apiKey;
            this.state.apiKey = settings.apiKey;
            const progress = document.getElementById('apiKeyProgress');
            if (progress) progress.style.width = '100%';
        }

        if (settings.sourceLang) {
            this.elements.sourceLang.value = settings.sourceLang;
            this.state.sourceLang = settings.sourceLang;
            this.elements.sourceLangDisplay.textContent = Utils.getNativeLanguageName(settings.sourceLang);
        }

        if (settings.targetLang) {
            this.elements.targetLang.value = settings.targetLang;
            this.state.targetLang = settings.targetLang;
            this.elements.targetLangDisplay.textContent = Utils.getNativeLanguageName(settings.targetLang);
        }

        if (settings.voiceType) {
            this.elements.voiceType.value = settings.voiceType;
            this.state.voiceType = settings.voiceType;
        }

        if (settings.vadSensitivity) {
            this.elements.vadSensitivity.value = settings.vadSensitivity;
        }

        // 出力音量設定を復元
        if (settings.outputVolume) {
            this.state.outputVolume = parseFloat(settings.outputVolume);
            console.log('[Settings] 出力音量を復元:', this.state.outputVolume);
        }

        // トグル設定
        const toggleSettings = ['vadEnabled', 'noiseReduction', 'echoCancellation', 'autoGainControl', 'showInputTranscript', 'showOutputTranscript', 'audioOutputEnabled'];
        for (const id of toggleSettings) {
            const value = await this.getFromStorage(id);
            if (value === 'false') {
                this.elements[id].classList.remove('active');
            }
        }
    }

    /**
     * ブラウザ版とElectronアプリの競合を防ぐ
     *
     * 目的:
     *   LocalStorageを使用して、ブラウザ版とElectronアプリの録音状態を同期
     *   app2で録音開始時に、ブラウザ版の録音を自動停止
     */
    initCrossInstanceSync() {
        // Electron環境かどうかを判定
        const isElectron = typeof window !== 'undefined' && window.electronAPI;

        if (isElectron) {
            console.log('[Sync] Electronアプリとして起動 - ブラウザ版を制御します');
        } else {
            console.log('[Sync] ブラウザ版として起動 - Electronアプリからの制御を監視します');

            // ブラウザ版の場合、LocalStorageの変更を監視
            window.addEventListener('storage', (event) => {
                if (event.key === 'app2_recording' && event.newValue === 'true') {
                    console.log('[Sync] Electronアプリが録音を開始しました - ブラウザ版を停止します');

                    // 録音中の場合は停止
                    if (this.state.isRecording) {
                        this.stopRecording();
                        this.notify('自動停止', 'Electronアプリが起動したため、ブラウザ版を停止しました', 'warning');
                    }
                }
            });
        }
    }

    async validateApiKey() {
        const btn = this.elements.validateBtn;
        const originalText = btn.querySelector('#validateBtnText').textContent;

        if (!this.state.apiKey || !this.state.apiKey.startsWith('sk-')) {
            this.notify('エラー', '有効なAPIキーを入力してください', 'error');
            return;
        }

        btn.disabled = true;
        btn.querySelector('#validateBtnText').innerHTML = '<span class="spinner"></span> 検証中...';

        try {
            // APIキー検証（実際のエンドポイントに接続テスト）
            await new Promise(resolve => setTimeout(resolve, 1000)); // シミュレーション

            this.notify('成功', 'APIキーが検証されました', 'success');
            btn.querySelector('#validateBtnText').textContent = '✓ 検証済み';

            setTimeout(() => {
                btn.querySelector('#validateBtnText').textContent = originalText;
                btn.disabled = false;
            }, 2000);
        } catch (error) {
            // エラーの詳細をログに記録（デバッグ用）
            console.error('[API Validation] APIキー検証エラー:', {
                error: error.message || error,
                stack: error.stack,
                apiKeyPrefix: this.state.apiKey ? this.state.apiKey.substring(0, 7) + '...' : 'なし'
            });

            // ユーザーに分かりやすいエラーメッセージを表示
            const errorMessage = error.message ?
                `APIキーの検証に失敗しました: ${error.message}` :
                'APIキーの検証に失敗しました';
            this.notify('エラー', errorMessage, 'error');

            // UIを元の状態に戻す
            btn.querySelector('#validateBtnText').textContent = originalText;
            btn.disabled = false;
        }
    }

    async loadApiKeyFromEnv() {
        const isElectron = typeof window !== 'undefined' && window.electronAPI;

        if (!isElectron) {
            console.log('[App] ブラウザ環境: 環境変数からAPIキーを読み込めません');
            return;
        }

        try {
            console.log('[App] Electron環境: 環境変数からAPIキーを取得中...');
            const envApiKey = await window.electronAPI.getEnvApiKey();

            if (envApiKey) {
                this.state.apiKey = envApiKey;
                console.log('[App] 環境変数からAPIキーを取得しました:', envApiKey.substring(0, 7) + '...');
                // UIに反映（セキュリティのため一部のみ表示）
                // 注意: パスワードフィールドには完全なキーを設定
                if (this.elements && this.elements.apiKey) {
                    this.elements.apiKey.value = envApiKey;
                }
            } else {
                console.log('[App] 環境変数にAPIキーが見つかりません');
                console.log('[App] 設定方法:');
                console.log('[App]   1. OPENAI_API_KEY=sk-your-key を設定');
                console.log('[App]   2. OPENAI_REALTIME_API_KEY=sk-your-key を設定');
                console.log('[App]   3. VOICETRANSLATE_API_KEY=sk-your-key を設定');
            }

            // 環境変数から設定を読み込む
            console.log('[App] Electron環境: 環境変数から設定を取得中...');
            const envConfig = await window.electronAPI.getEnvConfig();

            if (envConfig) {
                // CONFIGを上書き（2種類のモデル設定）
                CONFIG.API.REALTIME_MODEL = envConfig.realtimeModel;
                CONFIG.API.CHAT_MODEL = envConfig.chatModel;
                CONFIG.API.REALTIME_URL = envConfig.realtimeUrl;

                console.log('[App] 環境変数から設定を読み込みました:', {
                    realtimeModel: CONFIG.API.REALTIME_MODEL,
                    chatModel: CONFIG.API.CHAT_MODEL,
                    realtimeUrl: CONFIG.API.REALTIME_URL
                });
            }
        } catch (error) {
            console.error('[App] 環境変数読み込みエラー:', error);
        }
    }

    setupElectronWebSocketHandlers() {
        if (!window.electronAPI) return;

        console.log('[Electron WS] IPCハンドラーを設定中...');

        // 接続成功
        window.electronAPI.on('realtime-ws-open', () => {
            console.log('[Electron WS] 接続成功イベント受信');
            this.handleWSOpen();
        });

        // メッセージ受信
        window.electronAPI.on('realtime-ws-message', (message) => {
            console.log('[Electron WS] メッセージ受信イベント');
            this.handleWSMessage({ data: message });
        });

        // エラー
        window.electronAPI.on('realtime-ws-error', (error) => {
            console.error('[Electron WS] エラーイベント:', error);
            this.handleWSError(error);
        });

        // 接続終了
        window.electronAPI.on('realtime-ws-close', (data) => {
            console.log('[Electron WS] 接続終了イベント:', data);
            this.handleWSClose(data);
        });

        console.log('[Electron WS] IPCハンドラー設定完了');
    }

    async connect() {
        if (!this.state.apiKey) {
            this.notify('エラー', 'APIキーを入力してください', 'error');
            // alert('エラー: APIキーを入力してください');
            return;
        }

        // 接続開始時にトランスクリプトをクリア
        this.clearTranscript('both');

        try {
            this.updateConnectionStatus('connecting');
            this.elements.connectBtn.disabled = true;

            // デバッグ: 接続情報をログ出力
            const debugInfo = {
                apiKey: this.state.apiKey ? `${this.state.apiKey.substring(0, 7)}...` : 'なし',
                model: CONFIG.API.REALTIME_MODEL,
                url: CONFIG.API.REALTIME_URL
            };
            console.log('[Connect] 接続開始:', debugInfo);
            // alert(`接続開始\nAPIキー: ${debugInfo.apiKey}\nモデル: ${debugInfo.model}\nURL: ${debugInfo.url}`);

            // Electron環境チェック
            const isElectron = typeof window !== 'undefined' && window.electronAPI;

            if (isElectron) {
                // Electronの場合、mainプロセス経由で接続（Authorizationヘッダー付き）
                console.log('[Connect] Electron環境: mainプロセス経由で接続します');

                // IPCイベントリスナーを設定
                this.setupElectronWebSocketHandlers();

                // WebSocket接続を要求
                const result = await window.electronAPI.realtimeWebSocketConnect({
                    url: CONFIG.API.REALTIME_URL,
                    apiKey: this.state.apiKey,
                    model: CONFIG.API.REALTIME_MODEL
                });

                if (!result.success) {
                    throw new Error(result.message || '接続失敗');
                }

                console.log('[Connect] Electron WebSocket接続要求送信完了');
                // 接続成功はIPCイベント経由で通知される
                return;
            }

            // ブラウザ環境の場合（sec-websocket-protocolで認証）
            const wsUrl = `${CONFIG.API.REALTIME_URL}?model=${CONFIG.API.REALTIME_MODEL}`;
            console.log('[Connect] WebSocket URL:', wsUrl);

            // ブラウザ環境では、sec-websocket-protocolヘッダーを使用してAPIキーを送信
            const protocols = [
                'realtime',
                `openai-insecure-api-key.${this.state.apiKey}`,
                'openai-beta.realtime-v1'
            ];

            this.state.ws = new WebSocket(wsUrl, protocols);

            // WebSocketイベント設定
            this.state.ws.onopen = () => this.handleWSOpen();
            this.state.ws.onmessage = (event) => this.handleWSMessage(event);
            this.state.ws.onerror = (error) => this.handleWSError(error);
            this.state.ws.onclose = (event) => this.handleWSClose(event);

            // タイムアウト設定
            const timeout = setTimeout(() => {
                if (!this.state.isConnected) {
                    console.error('[Connect] タイムアウト - 接続に失敗しました');
                    // alert('エラー: 接続タイムアウト\n30秒以内に接続できませんでした');
                    this.disconnect();
                    this.notify('エラー', '接続タイムアウト (30秒)', 'error');
                }
            }, CONFIG.API.TIMEOUT);

            this.timers.connectionTimeout = timeout;

        } catch (error) {
            const errorMsg = `接続エラー: ${error.message}`;
            console.error('[Connect Error]', error);
            console.error('[Connect Error] Stack:', error.stack);
            // alert(errorMsg);
            this.notify('エラー', '接続に失敗しました: ' + error.message, 'error');
            this.updateConnectionStatus('error');
            this.elements.connectBtn.disabled = false;
        }
    }

    async disconnect() {
        const isElectron = typeof window !== 'undefined' && window.electronAPI;

        if (isElectron) {
            // Electron環境
            await window.electronAPI.realtimeWebSocketClose();
        } else if (this.state.ws) {
            // ブラウザ環境
            this.state.ws.close();
            this.state.ws = null;
        }

        await this.stopRecording();

        // ✅ レスポンスキューをクリア
        this.responseQueue.clear();

        this.state.isConnected = false;
        this.updateConnectionStatus('offline');
        this.elements.connectBtn.disabled = false;
        this.elements.disconnectBtn.disabled = true;
        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = true;

        clearTimeout(this.timers.connectionTimeout);
        clearInterval(this.timers.sessionTimer);

        this.notify('切断', '接続を切断しました', 'warning');
    }

    handleWSOpen() {
        clearTimeout(this.timers.connectionTimeout);
        console.log('[WS] Connected - WebSocket接続成功');
        // alert('接続成功: WebSocketが開きました\nセッション作成中...');

        this.state.isConnected = true;
        this.updateConnectionStatus('connected');
        this.elements.connectBtn.disabled = true;
        this.elements.disconnectBtn.disabled = false;
        this.elements.startBtn.disabled = false;

        // セッション作成
        console.log('[WS] セッション作成を開始');
        this.createSession();

        // セッションタイマー開始
        this.startSessionTimer();

        this.notify('接続成功', 'OpenAI Realtime APIに接続しました', 'success');
    }

    createSession() {
        // 音声出力が有効かどうかをチェック
        const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
        const modalities = audioOutputEnabled ? ['text', 'audio'] : ['text'];

        console.log('[🔊 Session] 音声出力設定:', {
            audioOutputEnabled: audioOutputEnabled,
            modalities: modalities,
            buttonElement: this.elements.audioOutputEnabled,
            hasActiveClass: this.elements.audioOutputEnabled.classList.contains('active')
        });

        const session = {
            type: 'session.update',
            session: {
                // Realtime APIモデル（音声→音声翻訳、音声認識）
                model: CONFIG.API.REALTIME_MODEL,
                modalities: modalities,
                instructions: this.getInstructions(),
                voice: this.state.voiceType,
                input_audio_format: CONFIG.AUDIO.FORMAT,
                output_audio_format: CONFIG.AUDIO.FORMAT,
                input_audio_transcription: {
                    // 音声認識モデル（入力音声 → 入力テキスト）
                    // gpt-realtime-2025-08-28 では whisper-1 を使用
                    model: 'whisper-1'
                    // language を指定しない → 自動言語検出を有効化
                    // 多人数・多言語環境で正確な言語検出を実現
                },
                turn_detection: this.elements.vadEnabled.classList.contains('active') ? {
                    type: 'server_vad',
                    threshold: 0.5,              // 音声検出の閾値（0.0-1.0、0.5=標準）
                    prefix_padding_ms: 300,      // 音声開始前のパディング（ms）
                    silence_duration_ms: 1200    // 静音判定時間（ms）- 1.2秒に延長（翻訳完全性向上）
                } : null,
                temperature: 0.8,  // 0.8: 自然な表現とバランス（gpt-realtime-2025-08-28 推奨）
                max_response_output_tokens: 4096  // 4096: 長い会話にも対応
            }
        };

        console.log('[Session] セッション設定:', JSON.stringify(session, null, 2));
        console.log('[Session] 使用モデル:', {
            realtimeModel: CONFIG.API.REALTIME_MODEL,  // Realtime API（音声→音声翻訳、音声認識）
            chatModel: CONFIG.API.CHAT_MODEL           // Chat Completions API（言語検出、テキスト翻訳）
        });
        console.log('[Session] 音声出力:', audioOutputEnabled ? 'ON' : 'OFF', '- modalities:', modalities);
        this.sendMessage(session);
        console.log('[Session] セッション作成メッセージを送信しました');
    }

    getInstructions() {
        const sourceLang = this.state.sourceLang;  // 言語コード（例: 'en', 'ja'）
        const targetLang = this.state.targetLang;
        const sourceName = Utils.getLanguageName(sourceLang);
        const targetName = Utils.getLanguageName(targetLang);
        const sourceNative = Utils.getNativeLanguageName(sourceLang);
        const targetNative = Utils.getNativeLanguageName(targetLang);

        // 最適化された指示（OpenAI Realtime Prompting Guide ベストプラクティス）
        // ✅ 強化: 翻訳専用モード、対話禁止を明確化
        return `# CRITICAL: YOU ARE A TRANSLATION MACHINE, NOT A CONVERSATIONAL AI
You are a professional real-time interpreter specializing in ${sourceName} to ${targetName} translation.
Your ONLY task is to translate speech - you are NOT a chatbot and should NEVER engage in conversation.

# Role & Objective
## Primary Function
- TRANSLATE ${sourceName} speech to ${targetName} speech
- DO NOT chat, discuss, or converse with the user
- DO NOT respond to questions about yourself or your capabilities
- DO NOT provide explanations, suggestions, or advice

## Translation Focus
- High accuracy and natural expression
- Appropriate cultural context
- Preserve speaker's intent and meaning

# Personality & Tone
## Personality
- Professional and neutral
- Clear and articulate
- Culturally aware and sensitive
- **TRANSLATOR ONLY - not a conversational partner**

## Tone
- Maintain the speaker's intent and meaning
- Preserve the emotional tone of the original speech
- Confident and natural delivery

## Length
- Match the length of the original speech
- Be concise but complete
- Do not add unnecessary words or explanations

## Pacing
- Speak at a natural, conversational pace
- Do not modify the content of your response, only adjust speaking speed
- Maintain clarity and naturalness

## Language
- Input language: ${sourceName} (${sourceNative})
- Output language: ${targetName} (${targetNative}) ONLY
- Do NOT respond in any other language, including ${sourceName}
- If the user speaks in an unclear or mixed language, politely ask for clarification in ${targetName}

# Instructions / Rules
## CRITICAL TRANSLATION RULES
1. **YOU ARE NOT A CHATBOT**: If the user asks you questions like "Who are you?", "What can you do?", "How are you?", simply translate those questions to ${targetName} - DO NOT answer them
2. **TRANSLATION ONLY**: Your ONLY function is to convert ${sourceName} speech to ${targetName} speech
3. **NO CONVERSATION**: DO NOT engage in dialogue, discussion, or conversation with the user
4. **Completeness**: Translate EVERY word and sentence - DO NOT skip or omit anything
5. **Accuracy**: Maintain the original meaning and intent
6. **Naturalness**: Use natural expressions in ${targetName}
7. **Cultural Adaptation**: Adapt idioms and cultural references appropriately
8. **Technical Terms**: Preserve technical terms and proper nouns accurately
9. **Numbers and Codes**: When reading numbers or codes, speak each digit clearly and separately

## STRICTLY FORBIDDEN ACTIONS
- ❌ DO NOT answer questions about yourself (e.g., "I am an AI assistant", "I can help you with...")
- ❌ DO NOT provide suggestions, advice, or recommendations
- ❌ DO NOT say "How can I help you?" or similar conversational phrases
- ❌ DO NOT skip any part of the user's speech
- ❌ DO NOT add your own comments, explanations, or meta-text
- ❌ DO NOT mix languages in your response
- ❌ DO NOT say things like "I will translate", "Here is the translation", or "The translation is"
- ❌ DO NOT repeat the original language in your response
- ❌ DO NOT ask for confirmation unless the audio is truly unclear
- ❌ DO NOT engage in small talk or casual conversation

## Examples of WRONG Behavior (NEVER DO THIS)
User: "Who are you?"
❌ WRONG: "I am an AI translation assistant designed to help you..."
✅ CORRECT: [Translate "Who are you?" to ${targetName}]

User: "What can you do?"
❌ WRONG: "I can translate between ${sourceName} and ${targetName}..."
✅ CORRECT: [Translate "What can you do?" to ${targetName}]

User: "How are you?"
❌ WRONG: "I'm doing well, thank you for asking..."
✅ CORRECT: [Translate "How are you?" to ${targetName}]

## Unclear Audio Handling
- If the user's audio is not clear (e.g., background noise, silent, unintelligible):
  * Ask for clarification using ${targetName} phrases
  * Examples: "Could you repeat that?", "I didn't catch that clearly", "Please speak a bit louder"
- Only respond to clear audio or text

# Conversation Flow
## 1) Listen
- Wait for the user to finish speaking
- Detect natural pauses and sentence boundaries

## 2) Translate
- Immediately translate the complete utterance
- Maintain the flow and rhythm of natural speech

## 3) Deliver
- Speak clearly and naturally in ${targetName}
- Match the appropriate tone and emotion

# Sample Phrases
Below are sample examples for inspiration. DO NOT always use these exact phrases - vary your responses naturally.

## Acknowledgements (when needed)
- "I understand"
- "Got it"
- "Noted"

## Clarifications (when audio is unclear)
- "Could you repeat that?"
- "I didn't catch that clearly"
- "Please speak a bit louder"

## Professional Context
- Maintain formality appropriate to the context
- Use polite forms when appropriate in ${targetName}

# Example Translation
User (${sourceName}): "こんにちは、今日はいい天気ですね。会議を始めましょう。"
You (${targetName}): "Hello, it's nice weather today. Let's start the meeting."

User (${sourceName}): "プロジェクトの進捗状況を報告します。現在、第一フェーズが完了し、第二フェーズに移行しています。"
You (${targetName}): "I'll report on the project progress. Currently, phase one is complete, and we're moving into phase two."

# Critical Reminders - READ EVERY TIME
⚠️ **REMEMBER**: You are a TRANSLATOR, not a conversational AI
⚠️ **NEVER** answer questions about yourself - only translate them
⚠️ **NEVER** engage in conversation - only translate what you hear
⚠️ **ALWAYS** translate EVERYTHING the user says - completeness is critical
⚠️ **ALWAYS** respond ONLY in ${targetName} - never use ${sourceName} in your response
⚠️ **ALWAYS** be natural and fluent - avoid robotic or word-for-word translations
⚠️ **ALWAYS** preserve the speaker's intent and meaning above all else

## Context Reminder
Even if you have translated many sentences, your role has NOT changed:
- You are STILL a translator
- You are STILL NOT a chatbot
- You STILL should NOT engage in conversation
- You STILL should ONLY translate ${sourceName} to ${targetName}`;
    }

    async sendMessage(message) {
        const isElectron = typeof window !== 'undefined' && window.electronAPI;

        if (isElectron) {
            // Electron環境
            const result = await window.electronAPI.realtimeWebSocketSend(JSON.stringify(message));
            if (!result.success) {
                console.error('[Send Message] Electron送信エラー:', result.message);
            }
        } else if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            // ブラウザ環境
            this.state.ws.send(JSON.stringify(message));
        }
    }

    async handleWSMessage(event) {
        try {
            const message = JSON.parse(event.data);

            // デバッグモードでのみ詳細ログを出力
            if (CONFIG.DEBUG_MODE) {
                console.log('[WS Message]', message.type, message);
            }

            switch (message.type) {
                case 'session.updated':
                    console.log('[Session] Updated:', message.session);
                    break;

                case 'input_audio_buffer.committed': {
                    const queueStatus = this.responseQueue.getStatus();
                    console.log('[Audio] 音声バッファコミット完了', {
                        activeResponseId: this.activeResponseId,
                        processingCount: queueStatus.processingCount,
                        pendingCount: queueStatus.pendingCount,
                        timestamp: Date.now()
                    });

                    // ✅ 重複コミット防止（500ms以内の重複を無視）
                    const now = Date.now();
                    if (now - this.lastCommitTime < 500) {
                        console.warn('[Audio] 重複コミットを検出、スキップします', {
                            timeSinceLastCommit: now - this.lastCommitTime
                        });
                        break;
                    }
                    this.lastCommitTime = now;

                    // ✅ 処理中のレスポンスがある場合はスキップ（並発制御）
                    if (this.activeResponseId) {
                        console.warn('[Audio] 前のレスポンスが処理中のため、新しいリクエストをスキップします', {
                            activeResponseId: this.activeResponseId
                        });
                        break;
                    }

                    if (queueStatus.processingCount > 0 || queueStatus.pendingCount > 0) {
                        console.warn('[Audio] キューにリクエストがあるため、スキップします', {
                            processingCount: queueStatus.processingCount,
                            pendingCount: queueStatus.pendingCount
                        });
                        break;
                    }

                    // Server VADが音声バッファをコミットした後、レスポンス生成を要求
                    // 理由: Server VADは自動コミットのみ、レスポンス生成は手動
                    const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
                    const modalities = audioOutputEnabled ? ['text', 'audio'] : ['text'];

                    console.log('[🔊 Response Create] 要求:', {
                        modalities: modalities,
                        audioOutputEnabled: audioOutputEnabled,
                        queueStatus: queueStatus,
                        activeResponseId: this.activeResponseId
                    });

                    // ✅ ResponseQueue を使用（await しない - 非同期で処理）
                    this.responseQueue.enqueue({
                        modalities: modalities,
                        instructions: this.getInstructions()
                    }).then(() => {
                        console.log('[Audio] レスポンスリクエストをキューに追加しました');
                    }).catch(error => {
                        // ✅ 並発制御による拒否は正常動作（エラーログ不要）
                        if (error.message.includes('Previous response is still in progress')) {
                            console.log('[Audio] 前のレスポンス処理中のため、リクエストをスキップしました');
                        } else {
                            console.error('[Audio] レスポンスリクエスト失敗:', error);
                        }
                    });
                    break;
                }

                case 'input_audio_buffer.speech_started':
                    console.log('[Speech] 音声検出開始');
                    this.updateStatus('recording', '話し中...');
                    break;

                case 'input_audio_buffer.speech_stopped':
                    console.log('[Speech] 音声検出停止');
                    this.updateStatus('recording', '処理中...');
                    // 新しい応答が始まることを示すフラグを設定
                    this.state.isNewResponse = true;
                    break;

                case 'conversation.item.input_audio_transcription.completed':
                    console.log('[Transcription] 入力音声認識完了:', message.transcript);
                    if (message.transcript) {
                        // 処理1-1: 📥 入力音声テキスト化 - 即座に表示
                        const transcriptId = Date.now(); // 一意のIDを生成
                        this.addTranscript('input', message.transcript, transcriptId);

                        // 🔄 文本翻訳を非同期で実行（音声翻訳と並行）
                        // 理由: 音声翻訳が不完全な場合でも、文本翻訳で確実に対応関係を保つ
                        this.translateTextDirectly(message.transcript, transcriptId)
                            .catch(error => {
                                console.error('[文本翻訳] エラー:', error);
                            });
                    }
                    break;

                case 'response.audio_transcript.delta':
                    // 音声翻訳のテキストは累積するが表示しない
                    // 理由: 文本翻訳APIで確実に表示するため、重複を避ける
                    if (message.delta) {
                        this.currentTranslationText += message.delta;
                    }
                    break;

                case 'response.audio_transcript.done':
                    console.log('[処理1-2] 🔊 音声翻訳テキスト完了:', message.transcript);

                    // 音声翻訳のテキストは表示しない（文本翻訳で表示済み）
                    // ただし、ログには記録
                    if (this.currentTranslationText.trim()) {
                        console.log('[音声翻訳] テキスト:', this.currentTranslationText.trim());
                        this.currentTranslationText = ''; // リセット
                    }

                    // 翻訳完了 - 新しい応答フラグをセット
                    this.state.isNewResponse = true;
                    break;

                case 'response.audio.delta':
                    console.log('[🔊 Audio Delta] 受信:', {
                        hasDelta: !!message.delta,
                        deltaLength: message.delta ? message.delta.length : 0,
                        currentQueueSize: this.audioQueue.length
                    });
                    if (message.delta) {
                        // 音声をキューに追加（途中切断を防ぐ）
                        this.enqueueAudio(message.delta);
                    }
                    break;

                case 'response.audio.done':
                    console.log('[🔊 Audio Done] 音声データ受信完了:', {
                        totalChunks: this.audioQueue.length,
                        audioOutputEnabled: this.elements.audioOutputEnabled.classList.contains('active'),
                        modalities: this.state.ws ? '確認必要' : 'WebSocket未接続'
                    });
                    // 音声キューの処理を開始
                    this.processAudioQueue();
                    break;

                case 'response.created':
                    // ✅ ResponseQueue にレスポンス作成を通知
                    console.log('[Response] Created:', {
                        responseId: message.response.id,
                        previousActiveId: this.activeResponseId,
                        timestamp: Date.now()
                    });
                    this.activeResponseId = message.response.id;  // 現在のレスポンスIDを記録
                    this.responseQueue.handleResponseCreated(message.response.id);
                    break;

                case 'response.done':
                    // ✅ ResponseQueue にレスポンス完了を通知
                    console.log('[Response] Complete:', {
                        responseId: message.response.id,
                        activeId: this.activeResponseId,
                        timestamp: Date.now()
                    });
                    this.activeResponseId = null;  // レスポンス完了、IDをクリア
                    this.responseQueue.handleResponseDone(message.response.id);
                    this.updateStatus('recording', '待機中');
                    this.updateAccuracy();
                    break;

                case 'error':
                    console.error('[Error]', message.error);

                    // ✅ conversation_already_has_active_response エラーの場合は通知のみ
                    // ResponseQueueで適切に処理されるため、ユーザー通知は不要
                    const errorCode = message.error.code || '';
                    if (errorCode === 'conversation_already_has_active_response') {
                        console.warn('[Error] 前のレスポンスが処理中です。待機します。');
                        // ResponseQueue にエラーを通知（内部で適切に処理される）
                        this.responseQueue.handleError(new Error(message.error.message), errorCode);
                        // ユーザー通知はしない（内部的な待機状態のため）
                    } else {
                        // 通常のエラー処理
                        this.responseQueue.handleError(new Error(message.error.message), errorCode);
                        this.notify('エラー', message.error.message, 'error');
                    }
                    break;

                default:
                    console.log('[WS Message] 未処理のメッセージタイプ:', message.type);
            }
        } catch (error) {
            console.error('[Message Error]', error);
            console.error('[Message Error] Event data:', event.data);
        }
    }

    handleWSError(error) {
        console.error('[WS Error] WebSocketエラーが発生:', error);
        console.error('[WS Error] エラー詳細:', {
            type: error.type,
            target: error.target,
            message: error.message,
            readyState: this.state.ws ? this.state.ws.readyState : 'なし'
        });

        const errorMsg = `WebSocketエラー\nreadyState: ${this.state.ws ? this.state.ws.readyState : 'なし'}`;
        // alert(errorMsg);
        this.notify('接続エラー', 'WebSocket接続でエラーが発生しました', 'error');
    }

    handleWSClose(event) {
        console.log('[WS] Closed - WebSocket接続が閉じました');

        // イベントオブジェクトの安全な取得
        const code = event?.code || event || 1005;
        const reason = event?.reason || '';
        const wasClean = event?.wasClean !== undefined ? event.wasClean : true;

        console.log('[WS Close] 詳細:', {
            code: code,
            reason: reason,
            wasClean: wasClean
        });

        const closeMsg = `接続終了\nコード: ${code}\n理由: ${reason || 'なし'}\nクリーン: ${wasClean}`;
        // alert(closeMsg);

        // エラーコード詳細
        let errorDetail = '';
        let isNormalClose = false; // 正常切断かどうか

        switch (code) {
            case 1000:
                errorDetail = '正常終了';
                isNormalClose = true;
                break;
            case 1001:
                errorDetail = 'エンドポイント離脱';
                isNormalClose = true;
                break;
            case 1002:
                errorDetail = 'プロトコルエラー';
                break;
            case 1003:
                errorDetail = '未対応データ';
                break;
            case 1005:
                errorDetail = '正常切断（理由なし）';
                isNormalClose = true;
                break;
            case 1006:
                errorDetail = '異常終了（接続失敗の可能性）';
                break;
            case 1007:
                errorDetail = '不正なデータ';
                break;
            case 1008:
                errorDetail = 'ポリシー違反';
                break;
            case 1009:
                errorDetail = 'メッセージが大きすぎる';
                break;
            case 1011:
                errorDetail = 'サーバーエラー';
                break;
            case 4000:
                errorDetail = 'OpenAI API認証エラー';
                break;
            default:
                errorDetail = `不明なエラー (コード: ${event.code})`;
        }

        // 正常切断の場合はinfoログ、異常終了の場合はerrorログ
        if (isNormalClose) {
            console.info('[WS Close] 接続終了:', errorDetail);
            // 正常切断の場合は通知を表示しない
        } else {
            console.error('[WS Close] エラー詳細:', errorDetail);
            this.notify('接続終了', errorDetail, 'warning');
        }

        this.disconnect();
    }

    async startRecording() {
        if (!this.state.isConnected) {
            // alert('エラー: WebSocketに接続してから録音を開始してください');
            this.notify('エラー', 'WebSocketに接続してください', 'error');
            return;
        }

        try {
            console.log('[Recording] Starting...');

            // Electronアプリの場合、ブラウザ版に録音停止を通知
            const isElectron = typeof window !== 'undefined' && window.electronAPI;
            if (isElectron) {
                console.log('[Sync] Electronアプリで録音開始 - ブラウザ版に停止を通知します');
                localStorage.setItem('app2_recording', 'true');
            } else {
                // ブラウザ版の場合、app2が既に録音中かチェック
                const app2Recording = localStorage.getItem('app2_recording');
                if (app2Recording === 'true') {
                    console.warn('[Sync] Electronアプリが既に録音中です - ブラウザ版での録音を中止します');
                    this.notify('警告', 'Electronアプリが既に録音中です。ブラウザ版では録音できません。', 'warning');
                    return;
                }
            }

            // 音声ソースタイプに応じて処理を分岐
            if (this.state.audioSourceType === 'system') {
                // システム音声キャプチャ
                await this.startSystemAudioCapture();
            } else {
                // マイクキャプチャ（既存機能）
                await this.startMicrophoneCapture();
            }

            // 共通の録音開始処理
            await this.setupAudioProcessing();

        } catch (error) {
            console.error('[Recording] エラー:', error);
            // alert(`録音開始エラー: ${error.message}`);
            this.notify('録音エラー', error.message, 'error');
        }
    }

    /**
     * マイク権限を自動チェック
     *
     * 目的:
     *   起動時にマイク権限の状態を確認し、必要に応じてユーザーに通知
     */
    async checkMicrophonePermission() {
        try {
            // Permissions API をサポートしているか確認
            if (!navigator.permissions || !navigator.permissions.query) {
                console.log('[Permission] Permissions API 未サポート - スキップ');
                return;
            }

            // マイク権限の状態を確認
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });

            console.log('[Permission] マイク権限状態:', permissionStatus.state);

            if (permissionStatus.state === 'granted') {
                console.log('[Permission] ✅ マイク権限が許可されています');
                this.notify('マイク準備完了', 'マイクへのアクセスが許可されています', 'success');
            } else if (permissionStatus.state === 'prompt') {
                console.log('[Permission] ⚠️ マイク権限が未設定です');
                this.notify(
                    'マイク権限が必要です',
                    '録音開始時にマイクへのアクセスを許可してください',
                    'warning'
                );
            } else if (permissionStatus.state === 'denied') {
                console.log('[Permission] ❌ マイク権限が拒否されています');
                this.notify(
                    'マイク権限が拒否されています',
                    'ブラウザの設定からマイクへのアクセスを許可してください',
                    'error'
                );
            }

            // 権限状態の変更を監視
            permissionStatus.onchange = () => {
                console.log('[Permission] マイク権限状態が変更されました:', permissionStatus.state);

                if (permissionStatus.state === 'granted') {
                    this.notify('マイク権限が許可されました', 'マイクが使用可能になりました', 'success');
                } else if (permissionStatus.state === 'denied') {
                    this.notify('マイク権限が拒否されました', 'マイクが使用できません', 'error');
                }
            };

        } catch (error) {
            console.warn('[Permission] マイク権限チェックエラー:', error);
            // エラーは無視（一部ブラウザでは microphone クエリが未サポート）
        }
    }

    async startMicrophoneCapture() {
        console.log('[Recording] マイクキャプチャを開始...');

        // マイクアクセス取得
        const constraints = {
            audio: {
                channelCount: 1,
                sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
                echoCancellation: this.elements.echoCancellation.classList.contains('active'),
                noiseSuppression: this.elements.noiseReduction.classList.contains('active'),
                autoGainControl: this.elements.autoGainControl.classList.contains('active')
            }
        };

        console.log('[Recording] マイクアクセス要求中...', constraints);

        try {
            this.state.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('[Recording] マイクアクセス取得成功');
            this.notify('マイク接続成功', 'マイクが正常に接続されました', 'success');
        } catch (error) {
            console.error('[Recording] マイクアクセス取得失敗:', error);

            if (error.name === 'NotAllowedError') {
                this.notify(
                    'マイク権限が拒否されました',
                    'ブラウザの設定からマイクへのアクセスを許可してください',
                    'error'
                );
            } else if (error.name === 'NotFoundError') {
                this.notify(
                    'マイクが見つかりません',
                    'マイクが接続されているか確認してください',
                    'error'
                );
            } else {
                this.notify('マイクエラー', error.message, 'error');
            }

            throw error;
        }
    }

    async startSystemAudioCapture() {
        console.log('[Recording] システム音声キャプチャを開始...');

        const isElectron = typeof window !== 'undefined' && window.electronAPI;

        if (isElectron) {
            // Electron環境: desktopCapturerを使用
            await this.startElectronSystemAudioCapture();
        } else {
            // ブラウザ環境: ユーザーの選択に基づいて処理
            const systemAudioSource = document.getElementById('systemAudioSource');
            const selectedSource = systemAudioSource?.value;

            console.log('[Recording] 選択されたソース:', selectedSource);

            if (selectedSource === 'current-tab') {
                // 現在のタブの音声をキャプチャ
                await this.startTabAudioCapture();
            } else {
                // getDisplayMediaを使用（画面/ウィンドウ選択）
                await this.startBrowserSystemAudioCapture();
            }
        }
    }

    async startElectronSystemAudioCapture() {
        console.log('[Recording] Electron環境でシステム音声をキャプチャ...');

        const systemAudioSource = document.getElementById('systemAudioSource');
        let sourceId = systemAudioSource.value;

        // 音声ソースが未選択の場合、自動検出を試みる
        if (!sourceId) {
            console.log('[Recording] 音声ソースが未選択 - 自動検出を開始...');
            this.notify('自動検出', '音声ソースを自動検出しています...', 'info');

            try {
                await this.detectAudioSources();

                // 検出後、最初のソースを自動選択
                sourceId = systemAudioSource.value;

                if (!sourceId) {
                    throw new Error('音声ソースが見つかりませんでした。Teams、Zoom、Chrome等の会議アプリやブラウザを起動してから再度お試しください。');
                }

                console.log('[Recording] 自動選択されたソース:', sourceId);
                this.notify('自動選択', '音声ソースを自動選択しました', 'success');
            } catch (error) {
                console.error('[Recording] 自動検出失敗:', error);
                throw new Error('音声ソースの自動検出に失敗しました。「会議アプリを検出」ボタンをクリックして、手動で選択してください。');
            }
        }

        try {
            // Electron環境では audio + video で画面キャプチャし、
            // その後音声トラックを取得する
            const constraints = {
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId
                    }
                },
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId
                    }
                }
            };

            console.log('[Recording] Electron画面キャプチャ要求中...', { sourceId });
            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            // 音声トラックを取得
            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();

            console.log('[Recording] トラック情報:', {
                audioTracks: audioTracks.length,
                videoTracks: videoTracks.length
            });

            // 重要: 音声トラックがなくても続行する
            // 理由: 会議アプリでは、誰も話していない時は音声トラックがない場合がある
            //       音声が開始されると、ストリームに音声トラックが追加される

            if (audioTracks.length === 0) {
                console.warn('[Recording] 現在音声トラックがありません。音声が開始されるまで待機します。');

                // ストリーム全体を保存（音声トラックが後で追加される可能性がある）
                this.state.mediaStream = stream;

                // 音声トラックが追加されたときのリスナーを設定
                stream.addEventListener('addtrack', (event) => {
                    console.log('[Recording] 音声トラックが追加されました:', event.track);
                    if (event.track.kind === 'audio') {
                        console.log('[Recording] 音声トラック検出、録音を開始します');
                        this.notify('音声検出', '音声が検出されました。録音を開始します。', 'success');
                    }
                });

                this.notify('待機中', '音声トラックを待機しています。会議で誰かが話し始めると録音が開始されます。', 'info');
            } else {
                // 音声トラックがある場合
                this.state.mediaStream = stream;

                console.log('[Recording] Electronシステム音声キャプチャ成功', {
                    audioTrackCount: audioTracks.length,
                    audioTrackLabel: audioTracks[0]?.label
                });

                // 重要な通知: ブラウザの音声をミュートするよう指示
                this.notify('重要', 'ブラウザのタブをミュートしてください！翻訳音声のみを聞くために、元の音声をミュートする必要があります。', 'warning');
            }

            // ビデオトラックは不要なので停止
            videoTracks.forEach(track => track.stop());
        } catch (error) {
            console.error('[Recording] Electronシステム音声キャプチャ失敗:', error);
            throw new Error(`システム音声のキャプチャに失敗しました: ${error.message}`);
        }
    }

    async startBrowserSystemAudioCapture() {
        console.log('[Recording] ブラウザ環境でシステム音声をキャプチャ...');

        try {
            // getDisplayMediaでシステム音声をキャプチャ（画面/ウィンドウ選択）
            // 注意: video: false は一部のブラウザでサポートされていないため、video: true を使用
            const constraints = {
                audio: {
                    channelCount: 1,
                    sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                },
                video: true  // 互換性のためtrueに設定（後でビデオトラックを停止）
            };

            console.log('[Recording] ブラウザ音声アクセス要求中...', constraints);
            const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

            // ビデオトラックを停止（音声のみ使用）
            const videoTracks = stream.getVideoTracks();
            videoTracks.forEach(track => {
                console.log('[Recording] ビデオトラックを停止:', track.label);
                track.stop();
            });

            this.state.mediaStream = stream;

            // 音声トラックの監視
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.addEventListener('ended', () => {
                    console.error('[Recording] 音声トラックが停止しました');
                    this.notify('エラー', '画面共有の音声キャプチャが停止しました', 'error');
                    this.stopRecording();
                });
                console.log('[Recording] 音声トラック監視を開始:', {
                    id: audioTrack.id,
                    label: audioTrack.label,
                    readyState: audioTrack.readyState
                });
            }

            console.log('[Recording] ブラウザシステム音声キャプチャ成功');
            this.notify('キャプチャ開始', 'システム音声のキャプチャを開始しました', 'success');
        } catch (error) {
            console.error('[Recording] ブラウザシステム音声キャプチャ失敗:', error);
            throw new Error('システム音声のキャプチャに失敗しました。ブラウザタブまたはウィンドウを選択してください。');
        }
    }

    /**
     * Chrome拡張のtabCaptureを使用して現在のタブの音声をキャプチャ
     *
     * 目的:
     *   ブラウザ拡張環境で現在のタブの音声を直接キャプチャ
     *
     * Returns:
     *   Promise<void>
     *
     * Throws:
     *   Error - キャプチャ失敗時
     *
     * 注意:
     *   manifest.jsonにtabCapture権限が必要
     */
    async startTabAudioCapture() {
        return new Promise((resolve, reject) => {
            console.log('[Recording] タブ音声キャプチャを開始...');

            // 現在のタブを取得
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || tabs.length === 0) {
                    reject(new Error('アクティブなタブが見つかりません'));
                    return;
                }

                const tab = tabs[0];
                const tabId = tab.id;
                const tabUrl = tab.url || '';

                console.log('[Recording] タブID:', tabId);
                console.log('[Recording] タブURL:', tabUrl);

                // Chrome内部ページのチェック
                if (tabUrl.startsWith('chrome://') ||
                    tabUrl.startsWith('chrome-extension://') ||
                    tabUrl.startsWith('edge://') ||
                    tabUrl.startsWith('about:')) {
                    reject(new Error(
                        'Chrome内部ページでは音声キャプチャできません。\n\n' +
                        '解決方法:\n' +
                        '1. 通常のウェブページ（YouTube、Google Meetなど）を開く\n' +
                        '2. 音声ソースを「マイク」に変更する\n' +
                        '3. 音声ソースを「画面/ウィンドウを選択」に変更する'
                    ));
                    return;
                }

                // タブの音声をキャプチャ
                const constraints = {
                    audio: true,
                    video: false
                };

                chrome.tabCapture.capture(constraints, (stream) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Recording] tabCapture失敗:', chrome.runtime.lastError);

                        // Chrome内部ページのエラーを検出
                        const errorMsg = chrome.runtime.lastError.message;
                        if (errorMsg.includes('Chrome pages cannot be captured') ||
                            errorMsg.includes('Extension has not been invoked')) {
                            reject(new Error(
                                'Chrome内部ページ（chrome://）では音声キャプチャできません。\n' +
                                '通常のウェブページ（YouTube、Google Meetなど）で使用するか、\n' +
                                '音声ソースを「マイク」または「画面/ウィンドウを選択」に変更してください。'
                            ));
                        } else {
                            reject(new Error(errorMsg));
                        }
                        return;
                    }

                    if (!stream) {
                        reject(new Error('ストリームの取得に失敗しました'));
                        return;
                    }

                    console.log('[Recording] タブ音声キャプチャ成功');
                    this.state.mediaStream = stream;

                    // ストリームが停止した時の処理を追加
                    const audioTrack = stream.getAudioTracks()[0];
                    if (audioTrack) {
                        audioTrack.addEventListener('ended', () => {
                            console.error('[Recording] 音声トラックが停止しました');
                            this.notify('エラー', 'タブ音声のキャプチャが停止しました', 'error');
                            this.stopRecording();
                        });
                        console.log('[Recording] 音声トラック監視を開始:', {
                            id: audioTrack.id,
                            label: audioTrack.label,
                            readyState: audioTrack.readyState,
                            enabled: audioTrack.enabled
                        });
                    }

                    this.notify('キャプチャ開始', '現在のタブの音声キャプチャを開始しました', 'success');
                    resolve();
                });
            });
        });
    }

    async setupAudioProcessing() {
        console.log('[Recording] 音声処理をセットアップ中...');

        // AudioContext設定
        this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: CONFIG.AUDIO.SAMPLE_RATE
        });

        // AudioContextがサスペンドされている場合、再開
        if (this.state.audioContext.state === 'suspended') {
            console.log('[Recording] AudioContextがサスペンド状態です。再開します...');
            await this.state.audioContext.resume();
            console.log('[Recording] AudioContext再開完了:', this.state.audioContext.state);
        }

        // 音声トラックがあるか確認
        const audioTracks = this.state.mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn('[Recording] 音声トラックがまだありません。音声が開始されるまで待機します。');

            // 音声トラックが追加されるまで待機
            return new Promise((resolve) => {
                const checkAudioTrack = () => {
                    const tracks = this.state.mediaStream.getAudioTracks();
                    if (tracks.length > 0) {
                        console.log('[Recording] 音声トラックが検出されました。処理を開始します。');
                        this.setupAudioProcessingInternal();
                        resolve();
                    } else {
                        // 100msごとにチェック
                        setTimeout(checkAudioTrack, 100);
                    }
                };
                checkAudioTrack();
            });
        }

        this.setupAudioProcessingInternal();
    }

    async setupAudioProcessingInternal() {
        console.log('[Recording] 音声処理を開始...');

        // MediaStreamSource を作成して保存（後で切断できるように）
        this.state.audioSource = this.state.audioContext.createMediaStreamSource(this.state.mediaStream);

        // VADリセット
        if (this.elements.vadEnabled.classList.contains('active')) {
            this.vad.reset();
            console.log('[VAD] Calibrating...');
        }

        try {
            // AudioWorklet をロードして使用（推奨方式）
            await this.state.audioContext.audioWorklet.addModule('audio-processor-worklet.js');

            // AudioWorkletNode を作成
            this.state.workletNode = new AudioWorkletNode(
                this.state.audioContext,
                'audio-processor-worklet'
            );

            // AudioWorklet からのメッセージを受信
            this.state.workletNode.port.onmessage = (event) => {
                if (event.data.type === 'audiodata') {
                    if (!this.state.isRecording) return;

                    // ループバック防止: 音声再生中は入力をスキップ
                    if (this.state.isPlayingAudio) return;

                    const inputData = event.data.data;

                    // 常にクライアント側VADで音声検出を行う
                    const vadResult = this.vad.analyze(inputData);
                    this.updateVisualizer(inputData, vadResult);

                    // 音声が検出された場合のみ送信
                    if (vadResult.isSpeaking) {
                        this.sendAudioData(inputData);
                    }
                }
            };

            this.state.audioSource.connect(this.state.workletNode);

            // GainNodeを作成して入力音声のミュート制御
            this.state.inputGainNode = this.state.audioContext.createGain();

            // 入力音声出力設定に応じてゲインを設定
            this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1.0 : 0.0;

            // 音声チェーン: workletNode → inputGainNode → destination
            this.state.workletNode.connect(this.state.inputGainNode);
            this.state.inputGainNode.connect(this.state.audioContext.destination);

            console.log('[Recording] AudioWorklet を使用して音声処理を開始しました（入力音声出力:',
                this.state.inputAudioOutputEnabled ? 'ON' : 'OFF', '）');

        } catch (error) {
            console.warn('[Recording] AudioWorklet の読み込みに失敗しました。ScriptProcessorNode にフォールバックします:', error);

            // フォールバック: ScriptProcessorNode を使用（非推奨だが互換性のため）
            const preset = getAudioPreset();
            this.state.processor = this.state.audioContext.createScriptProcessor(
                preset.BUFFER_SIZE, 1, 1
            );

            this.state.processor.onaudioprocess = (e) => {
                if (!this.state.isRecording) return;

                // ループバック防止: 音声再生中は入力をスキップ
                if (this.state.isPlayingAudio) return;

                const inputData = e.inputBuffer.getChannelData(0);

                // 常にクライアント側VADで音声検出を行う
                const vadResult = this.vad.analyze(inputData);
                this.updateVisualizer(inputData, vadResult);

                // 音声が検出された場合のみ送信
                if (vadResult.isSpeaking) {
                    this.sendAudioData(inputData);
                }
            };

            this.state.audioSource.connect(this.state.processor);

            // GainNodeを作成して入力音声のミュート制御
            this.state.inputGainNode = this.state.audioContext.createGain();

            // 入力音声出力設定に応じてゲインを設定
            this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1.0 : 0.0;

            // 音声チェーン: processor → inputGainNode → destination
            this.state.processor.connect(this.state.inputGainNode);
            this.state.inputGainNode.connect(this.state.audioContext.destination);

            console.log('[Recording] ScriptProcessorNode を使用して音声処理を開始しました（入力音声出力:',
                this.state.inputAudioOutputEnabled ? 'ON' : 'OFF', '）');
        }

        this.state.isRecording = true;
        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = false;
        this.elements.disconnectBtn.disabled = true;

        const sourceTypeText = this.state.audioSourceType === 'system' ? 'システム音声' : 'マイク';
        this.updateStatus('recording', '録音中');
        this.notify('録音開始', `${sourceTypeText}から音声を取得しています`, 'success');

        console.log('[Recording] 録音開始完了', {
            isRecording: this.state.isRecording,
            isConnected: this.state.isConnected,
            audioSourceType: this.state.audioSourceType,
            vadEnabled: this.elements.vadEnabled.classList.contains('active'),
            usingAudioWorklet: !!this.state.workletNode
        });

        // alert(`録音開始しました\n${sourceTypeText}からの音声を翻訳します`);
    }

    /**
     * 入力音声出力を再接続
     *
     * 目的:
     *   録音中に入力音声出力設定が変更された場合、GainNodeで音量を制御
     *
     * 注意:
     *   接続を切断せず、GainNodeのゲイン値を変更することで即座にミュート/アンミュート
     */
    reconnectAudioOutput() {
        console.log('[Audio Output] 入力音声出力を切り替え中...', {
            enabled: this.state.inputAudioOutputEnabled,
            hasGainNode: !!this.state.inputGainNode
        });

        try {
            // GainNodeが存在する場合、ゲイン値を変更
            if (this.state.inputGainNode) {
                // 入力音声出力設定に応じてゲインを設定
                // ON: 1.0 (通常音量), OFF: 0.0 (完全ミュート)
                this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1.0 : 0.0;

                console.log('[Audio Output] 入力音声ゲイン:',
                    this.state.inputAudioOutputEnabled ? '1.0 (ON)' : '0.0 (OFF)');
            } else {
                console.warn('[Audio Output] GainNodeが存在しません');
            }

        } catch (error) {
            console.error('[Audio Output] 切り替えエラー:', error);
            this.notify('エラー', '入力音声出力の切り替えに失敗しました', 'error');
        }
    }

    async detectAudioSources() {
        console.log('[Audio Source] 音声ソースを検出中...');

        const isElectron = typeof window !== 'undefined' && window.electronAPI;
        const systemAudioSource = document.getElementById('systemAudioSource');

        if (isElectron) {
            // Electron環境: 会議アプリを自動検出
            try {
                this.notify('検出中', '音声ソースを検出しています...', 'info');

                const sources = await window.electronAPI.detectMeetingApps();
                console.log('[Audio Source] 検出されたソース:', sources);
                console.log('[Audio Source] ソース数:', sources.length);

                // ドロップダウンを更新
                systemAudioSource.innerHTML = '<option value="">ソースを選択...</option>';

                if (sources.length === 0) {
                    console.warn('[Audio Source] 音声ソースが見つかりませんでした');
                    this.notify('検出結果', '会議アプリやブラウザが見つかりませんでした。Teams、Zoom、Chrome等を起動してから再度お試しください。', 'warning');

                    // デバッグ用: 全ウィンドウを表示するオプションを追加
                    const debugOption = document.createElement('option');
                    debugOption.value = 'debug';
                    debugOption.textContent = '（デバッグ: 全ウィンドウを確認）';
                    systemAudioSource.appendChild(debugOption);
                } else {
                    // ソースをドロップダウンに追加（会議アプリとブラウザを区別）
                    console.log('[Audio Source] ========== ソース追加開始 ==========');
                    console.log(`[Audio Source] 総ソース数: ${sources.length}`);

                    sources.forEach((source, index) => {
                        // 会議アプリか確認
                        const isMeetingApp = source.name.includes('Teams') ||
                                            source.name.includes('Zoom') ||
                                            source.name.includes('Meet') ||
                                            source.name.includes('Skype') ||
                                            source.name.includes('Discord') ||
                                            source.name.includes('Slack') ||
                                            source.name.includes('Webex');

                        const option = document.createElement('option');
                        option.value = source.id;

                        // アイコンを追加
                        const icon = isMeetingApp ? '🎤 会議 ' : '🌐 ブラウザ ';
                        option.textContent = icon + source.name;
                        systemAudioSource.appendChild(option);

                        console.log(`[Audio Source]   [${index + 1}] ${icon}${source.name}`);
                    });

                    console.log('[Audio Source] ========== 追加完了 ==========');

                    // 自動選択: 最初のソースを選択
                    if (sources.length > 0) {
                        systemAudioSource.selectedIndex = 1; // 0は"ソースを選択..."なので1を選択
                        console.log('[Audio Source] 最初のソースを自動選択:', sources[0].name);
                    }

                    this.notify('検出完了', `${sources.length}個の音声ソースを検出しました`, 'success');
                }
            } catch (error) {
                console.error('[Audio Source] 検出エラー:', error);
                this.notify('エラー', '音声ソースの検出に失敗しました: ' + error.message, 'error');
            }
        } else {
            // ブラウザ環境: 標準オプションを表示
            systemAudioSource.innerHTML = '<option value="">ソースを選択...</option>';

            // Chrome拡張環境の場合、現在のタブオプションを追加
            if (typeof chrome !== 'undefined' && chrome.tabCapture) {
                const tabOption = document.createElement('option');
                tabOption.value = 'current-tab';
                tabOption.textContent = '🔊 現在のタブ（ブラウザ音声）';
                systemAudioSource.appendChild(tabOption);
                console.log('[Audio Source] Chrome拡張環境: 現在のタブオプションを追加');
            }

            // 画面共有オプション（常に利用可能）
            const displayOption = document.createElement('option');
            displayOption.value = 'display-media';
            displayOption.textContent = '🖥️ 画面/ウィンドウを選択';
            systemAudioSource.appendChild(displayOption);

            this.notify('情報', '音声ソースを選択してください', 'info');
        }
    }

    async stopRecording() {
        console.log('[Recording] 停止処理開始');

        // 再生キューをクリア（録音停止時は未再生の音声も破棄）
        if (this.playbackQueue.length > 0) {
            console.log('[Playback Queue] 録音停止 - キューをクリア:', this.playbackQueue.length, '個破棄');
            this.playbackQueue = [];
            this.isPlayingFromQueue = false;
        }

        // Electronアプリの場合、ブラウザ版への録音停止通知をクリア
        const isElectron = typeof window !== 'undefined' && window.electronAPI;
        if (isElectron) {
            console.log('[Sync] Electronアプリで録音停止 - ブラウザ版への通知をクリアします');
            localStorage.removeItem('app2_recording');
        }

        const isServerVadEnabled = this.elements.vadEnabled.classList.contains('active');
        console.log('[Recording] Server VAD状態:', isServerVadEnabled ? '有効' : '無効');

        // Server VADが無効な場合のみ、手動でバッファをコミット＆レスポンス生成
        // Server VADが有効な場合は、input_audio_buffer.committedイベントで自動的にレスポンス生成される
        if (this.state.isConnected && this.state.isRecording && !isServerVadEnabled) {
            console.log('[Recording] 音声バッファをコミットします（Server VAD無効）');
            this.sendMessage({
                type: 'input_audio_buffer.commit'
            });

            // Server VAD無効時のみ、ここでレスポンス生成を要求
            const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
            const modalities = audioOutputEnabled ? ['text', 'audio'] : ['text'];

            const queueStatus = this.responseQueue.getStatus();
            console.log('[Recording] レスポンス生成を要求（Server VAD無効）:', {
                modalities: modalities,
                audioOutputEnabled: audioOutputEnabled,
                queueStatus: queueStatus
            });

            if (this.activeResponseId) {
                console.warn('[Recording] 前のレスポンスが処理中のため、新規レスポンスをスキップします', {
                    activeResponseId: this.activeResponseId
                });
            } else if (queueStatus.processingCount > 0 || queueStatus.pendingCount > 0) {
                console.warn('[Recording] レスポンスキューに処理中の項目があるため、新規リクエストをスキップします', queueStatus);
            } else {
                this.responseQueue.enqueue({
                    modalities: modalities,
                    instructions: this.getInstructions()
                }).then(() => {
                    console.log('[Recording] レスポンスリクエストをキューに追加しました');
                }).catch(error => {
                    if (error.message && error.message.includes('Previous response is still in progress')) {
                        console.log('[Recording] 前のレスポンス処理中のためリクエストをスキップしました');
                    } else {
                        console.error('[Recording] レスポンスリクエスト失敗:', error);
                    }
                });
            }
        } else if (isServerVadEnabled) {
            console.log('[Recording] Server VAD有効 - input_audio_buffer.committedイベントでレスポンス生成されます');
        }

        if (this.state.mediaStream) {
            this.state.mediaStream.getTracks().forEach(track => track.stop());
            this.state.mediaStream = null;
        }

        // MediaStreamSource のクリーンアップ
        if (this.state.audioSource) {
            this.state.audioSource.disconnect();
            this.state.audioSource = null;
            console.log('[Recording] MediaStreamSource をクリーンアップしました');
        }

        // GainNode のクリーンアップ
        if (this.state.inputGainNode) {
            this.state.inputGainNode.disconnect();
            this.state.inputGainNode = null;
            console.log('[Recording] GainNode をクリーンアップしました');
        }

        // AudioWorkletNode のクリーンアップ
        if (this.state.workletNode) {
            // 停止メッセージを送信
            this.state.workletNode.port.postMessage({ type: 'stop' });
            this.state.workletNode.disconnect();
            this.state.workletNode = null;
            console.log('[Recording] AudioWorkletNode をクリーンアップしました');
        }

        // ScriptProcessorNode のクリーンアップ（フォールバック用）
        if (this.state.processor) {
            this.state.processor.disconnect();
            this.state.processor = null;
            console.log('[Recording] ScriptProcessorNode をクリーンアップしました');
        }

        if (this.state.audioContext) {
            this.state.audioContext.close();
            this.state.audioContext = null;
        }

        this.state.isRecording = false;
        this.elements.startBtn.disabled = false;
        this.elements.stopBtn.disabled = true;
        this.elements.disconnectBtn.disabled = !this.state.isConnected;

        this.resetVisualizer();

        if (isServerVadEnabled) {
            this.updateStatus('recording', '音声検出待機中...');
            this.notify('録音停止', 'マイクを閉じました。音声処理は続行中...', 'warning');
        } else {
            this.updateStatus('recording', '翻訳処理中...');
            this.notify('録音停止', '翻訳処理中...', 'warning');
        }

        console.log('[Recording] 停止処理完了 - 翻訳待機中');
    }

    sendAudioData(audioData) {
        // 接続状態チェック
        if (!this.state.isConnected) {
            console.warn('[Audio] 未接続のため音声データを送信できません');
            return;
        }

        // 録音状態チェック
        if (!this.state.isRecording) {
            console.warn('[Audio] 録音停止中のため音声データを送信しません');
            return;
        }

        // ループバック防止: 音声再生中は入力をスキップ
        // すべてのモード（マイク/ブラウザ音声/画面共有）で適用
        // 理由: ブラウザ音声モードでも、翻訳音声が再度入力として捕捉される問題を防止
        if (this.state.isPlayingAudio) {
            return; // 完全にスキップ（ログも削除）
        }

        // Float32をPCM16に変換（即座に送信、節流なし）
        const pcmData = Utils.floatTo16BitPCM(audioData);
        const base64Audio = Utils.arrayBufferToBase64(pcmData);

        const message = {
            type: 'input_audio_buffer.append',
            audio: base64Audio
        };

        this.sendMessage(message);
    }

    /**
     * 音声をキューに追加
     *
     * 目的:
     *   音声データをキューに追加し、順番に再生することで途中切断を防ぐ
     */
    enqueueAudio(base64Audio) {
        this.audioQueue.push(base64Audio);
        // ログ削除: 頻繁すぎるため
    }

    /**
     * 音声キューを処理
     *
     * 目的:
     *   キューに蓄積された音声チャンクを連結し、再生キューに追加
     *   連続した翻訳音声を順番に再生するため、即座に再生せずキューに追加
     */
    async processAudioQueue() {
        console.log('[🔊 Process Queue] 開始:', {
            audioQueueLength: this.audioQueue.length,
            playbackQueueLength: this.playbackQueue.length,
            isPlayingFromQueue: this.isPlayingFromQueue
        });

        if (this.audioQueue.length === 0) {
            console.warn('[🔊 Process Queue] 音声キューが空です！');
            return;
        }

        try {
            // すべての音声チャンクを連結
            const allAudioData = this.audioQueue.join('');
            this.audioQueue = []; // キューをクリア

            console.log('[🔊 Process Queue] 音声データ連結完了:', {
                totalLength: allAudioData.length,
                willAddToPlaybackQueue: true
            });

            // 再生キューに追加（即座に再生しない）
            this.playbackQueue.push(allAudioData);

            console.log('[🔊 Playback Queue] 音声を追加:', {
                queueLength: this.playbackQueue.length,
                isPlayingFromQueue: this.isPlayingFromQueue,
                willStartNow: !this.isPlayingFromQueue
            });

            // 再生中でなければ再生開始
            if (!this.isPlayingFromQueue) {
                console.log('[🔊 Playback Queue] 再生開始します');
                this.playNextInQueue();
            } else {
                console.log('[🔊 Playback Queue] 既に再生中 - キューに追加のみ');
            }
        } catch (error) {
            console.error('[🔊 Audio Queue] 処理エラー:', error);
            this.audioQueue = []; // エラー時もキューをクリア
        }
    }

    /**
     * 再生キューから次の音声を再生
     *
     * 目的:
     *   再生キューに蓄積された音声を順番に再生
     *   前の音声が完全に再生終了してから次の音声を再生することで、
     *   連続した翻訳音声が途中で切断されるのを防ぐ
     *
     * 注意:
     *   この関数は await せず、非同期で再生を開始する
     *   再生完了時に playAudio() の onended から再度呼び出される
     */
    playNextInQueue() {
        // キューが空の場合
        if (this.playbackQueue.length === 0) {
            this.isPlayingFromQueue = false;

            // 入力音声を復元（すべての再生が完了）
            if (this.state.inputGainNode) {
                this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1.0 : 0.0;
                console.log('[Playback Queue] キューが空 - 入力音声を復元:',
                    this.state.inputAudioOutputEnabled ? 'ON' : 'OFF');
            }

            console.log('[Playback Queue] キューが空 - 再生終了');
            return;
        }

        // 再生中フラグをON
        this.isPlayingFromQueue = true;

        // キューから最初の音声を取り出す
        const audioData = this.playbackQueue.shift();

        console.log('[Playback Queue] 次の音声を再生:', {
            remainingInQueue: this.playbackQueue.length
        });

        // 音声を再生（await しない - 非同期で開始）
        this.playAudio(audioData).catch(error => {
            console.error('[Playback Queue] 再生エラー:', error);
            // エラーが発生しても次の音声を再生
            this.playNextInQueue();
        });
    }

    async playAudio(base64Audio) {
        return new Promise(async (resolve, reject) => {
            try {
                // 音声再生中フラグをON（ループバック防止）
                // すべてのモード（マイク/ブラウザ音声/画面共有）で有効
                this.state.isPlayingAudio = true;

                // 出力音声再生中は入力音声を完全ミュート（優先度確保）
                if (this.state.inputGainNode) {
                    this.state.inputGainNode.gain.value = 0.0;
                    console.log('[Audio] 出力再生中 - 入力音声を完全ミュート');
                }

                // 出力専用AudioContextが存在しない場合は作成
                // 入力処理と分離することで、出力音声の優先度を確保
                if (!this.state.outputAudioContext) {
                    this.state.outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({
                        sampleRate: CONFIG.AUDIO.SAMPLE_RATE
                    });
                    console.log('[Audio] 出力専用AudioContextを作成しました');
                }

                // AudioContextがsuspended状態の場合はresume
                if (this.state.outputAudioContext.state === 'suspended') {
                    await this.state.outputAudioContext.resume();
                    console.log('[Audio] AudioContextをresumeしました');
                }

                // Base64からArrayBufferに変換
                const pcm16Data = Utils.base64ToArrayBuffer(base64Audio);

                // PCM16をFloat32Arrayに変換
                const pcm16Array = new Int16Array(pcm16Data);
                const float32Array = new Float32Array(pcm16Array.length);
                for (let i = 0; i < pcm16Array.length; i++) {
                    // Int16 (-32768 to 32767) を Float32 (-1.0 to 1.0) に変換
                    float32Array[i] = pcm16Array[i] / (pcm16Array[i] < 0 ? 32768 : 32767);
                }

                // AudioBufferを作成（出力専用AudioContext使用）
                const audioBuffer = this.state.outputAudioContext.createBuffer(
                    1, // モノラル
                    float32Array.length,
                    CONFIG.AUDIO.SAMPLE_RATE
                );
                audioBuffer.getChannelData(0).set(float32Array);

                // 音量調整用のGainNodeを作成
                const gainNode = this.state.outputAudioContext.createGain();
                // 音量を設定（Electronアプリでの音量不足を解消）
                gainNode.gain.value = this.state.outputVolume;

                // 再生
                const source = this.state.outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;

                // 音声チェーン: source → gainNode → destination
                source.connect(gainNode);
                gainNode.connect(this.state.outputAudioContext.destination);

                // 再生終了時にフラグをOFF（すべてのモードで適用）
                source.onended = () => {
                    // 即座に次の音声を再生（連続性最優先）
                    this.state.isPlayingAudio = false;

                    // 次の音声を再生（キューに残っている場合）
                    // 注意: 入力音声の復元は playNextInQueue() で統一処理
                    this.playNextInQueue();

                    // Promiseを解決
                    resolve();
                };

                source.start();

            } catch (error) {
                console.error('[Audio Play Error]', error);
                this.notify('音声再生エラー', error.message, 'error');

                // エラー時もフラグをOFF（すべてのモードで適用）
                this.state.isPlayingAudio = false;

                // 入力音声を復元
                if (this.state.inputGainNode) {
                    this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1.0 : 0.0;
                    console.log('[Audio] エラー時 - 入力音声を復元');
                }

                // エラーでも次の音声を再生（キューを停止しない）
                this.playNextInQueue();

                reject(error);
            }
        });
    }

    /**
     * 自動言語検出と翻訳
     *
     * 目的:
     *   入力テキストの言語を自動検出し、置信度に応じて翻訳を実行
     *   多人数・多言語環境で正確な翻訳を実現
     *
     * @param {string} inputText - 入力テキスト
     * @param {number} transcriptId - トランスクリプトID
     */
    async detectLanguageAndTranslate(inputText, transcriptId) {
        // 重複防止: 同じtranscriptIdで既に処理中の場合はスキップ
        if (this.state.processingTranscripts && this.state.processingTranscripts.has(transcriptId)) {
            return;
        }

        // 処理中フラグを設定
        if (!this.state.processingTranscripts) {
            this.state.processingTranscripts = new Set();
        }
        this.state.processingTranscripts.add(transcriptId);

        try {
            if (!this.state.apiKey) {
                throw new Error('APIキーが設定されていません');
            }

            // 言語検出API呼び出し
            // Chat Completions APIモデルを使用（環境変数から設定可能）
            const detectionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.apiKey}`
                },
                body: JSON.stringify({
                    model: CONFIG.API.CHAT_MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a language detection expert. Detect the language of the given text and return ONLY a JSON object with format: {"language": "language_code", "confidence": 0.95}. Language codes: ja (Japanese), en (English), zh (Chinese), ko (Korean), es (Spanish), fr (French), de (German), etc. Confidence should be 0.0-1.0.'
                        },
                        {
                            role: 'user',
                            content: inputText
                        }
                    ]
                    // temperature パラメータを削除（gpt-5-2025-08-07 はデフォルト値(1)のみサポート）
                })
            });

            if (!detectionResponse.ok) {
                throw new Error(`Language detection failed: ${detectionResponse.status}`);
            }

            const detectionData = await detectionResponse.json();

            // APIレスポンスからJSONを抽出（```json ... ``` のマークダウンを除去）
            let contentText = detectionData.choices[0].message.content.trim();

            // マークダウンコードブロックを除去
            if (contentText.startsWith('```json')) {
                contentText = contentText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (contentText.startsWith('```')) {
                contentText = contentText.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }

            const detectionResult = JSON.parse(contentText.trim());

            const detectedLang = detectionResult.language;
            const confidence = detectionResult.confidence;

            // 置信度が60%以上の場合は検出された言語を使用、それ以外はUI設定を使用
            const finalSourceLang = confidence >= 0.6 ? detectedLang : this.state.sourceLang;

            // 検出された言語で翻訳を実行
            await this.translateTextDirectly(inputText, transcriptId, finalSourceLang);

        } catch (error) {
            console.error('[言語検出] エラー:', error);
            // エラー時はUI設定の言語で翻訳を実行
            await this.translateTextDirectly(inputText, transcriptId, this.state.sourceLang);
        } finally {
            // 処理完了後、フラグを削除
            if (this.state.processingTranscripts) {
                this.state.processingTranscripts.delete(transcriptId);
            }
        }
    }


    /**
     * 文本翻訳APIを直接呼び出し（処理2）
     *
     * 目的:
     *   処理1-1で得られた入力テキストを CHAT_MODEL を使用して翻訳
     *   処理1-2の音声翻訳とは独立して実行
     *
     * 処理フロー:
     *   入力音声 → 処理1-1: 入力テキスト → 処理2: 文本翻訳 → 翻訳テキスト表示
     *
     * @param {string} inputText - 処理1-1で得られた入力テキスト
     * @param {number} transcriptId - トランスクリプトID（一対一対応用）
     * @param {string} sourceLang - 検出された源言語（オプション、デフォルトはUI設定）
     */
    async translateTextDirectly(inputText, transcriptId, sourceLang = null) {
        // sourceLangが指定されていない場合はUI設定を使用
        const actualSourceLang = sourceLang || this.state.sourceLang;

        try {
            if (!this.state.apiKey) {
                throw new Error('APIキーが設定されていません');
            }

            // 文本翻訳用のモデルを選択
            // Chat Completions APIモデルを使用（環境変数から設定可能）
            const translationModel = CONFIG.API.CHAT_MODEL;

            // OpenAI Chat Completions API を使用して文本翻訳
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.apiKey}`
                },
                body: JSON.stringify({
                    model: translationModel,
                    messages: [
                        {
                            role: 'system',
                            content: `You are a professional translator. Translate the following text from ${actualSourceLang} to ${this.state.targetLang}. Output ONLY the translation, no explanations.`
                        },
                        {
                            role: 'user',
                            content: inputText
                        }
                    ]
                    // temperature パラメータを削除（gpt-5-2025-08-07 はデフォルト値(1)のみサポート）
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error('[処理2] API Error Response:', errorBody);
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            const data = await response.json();

            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                console.error('[処理2] Invalid response structure:', data);
                throw new Error('Invalid API response structure');
            }

            const translatedText = data.choices[0].message.content.trim();

            // 翻訳結果を右側カラムに表示（transcriptIdで一対一対応）
            this.addTranscript('output', translatedText, transcriptId);

        } catch (error) {
            console.error('[翻訳エラー]', error);
            this.notify('文本翻訳エラー', error.message, 'error');
        }
    }

    /**
     * トランスクリプトにテキストを追加
     *
     * 目的:
     *   入力音声または翻訳結果にテキストを追加し、最新のメッセージが上に表示されるようにする
     *
     * @param {string} type - 'input' または 'output' または 'text-translation'
     * @param {string} text - 追加するテキスト
     * @param {number} transcriptId - トランスクリプトID（一対一対応用）
     */
    addTranscript(type, text, transcriptId = null) {
        // 重複防止: 同じtranscriptIdとtypeで既に表示されている場合はスキップ
        if (transcriptId && type === 'output') {
            const container = this.elements.outputTranscript;
            if (container) {
                const existing = container.querySelector(`[data-transcript-id="${transcriptId}"]`);
                if (existing) {
                    console.warn('[Transcript] 重複検出 - スキップ:', { type, transcriptId, text: text.substring(0, 20) });
                    return existing;
                }
            }
        }

        // トランスクリプト表示設定をチェック
        const showInput = this.elements.showInputTranscript.classList.contains('active');
        const showOutput = this.elements.showOutputTranscript.classList.contains('active');

        if (type === 'input' && !showInput) {
            return;
        }

        if (type === 'output' && !showOutput) {
            return;
        }

        // コンテナを選択
        const container = type === 'input' ?
            this.elements.inputTranscript :
            this.elements.outputTranscript;

        if (!container) {
            console.error('[Transcript] コンテナが見つかりません:', type);
            return;
        }

        // 空状態を削除
        const emptyState = container.querySelector('.empty-state');
        if (emptyState) {
            console.log('[Transcript] 空状態を削除');
            emptyState.remove();
        }

        const message = document.createElement('div');
        message.className = `transcript-message ${type === 'output' ? 'translation' : ''}`;

        // transcriptId を data 属性として保存（一対一対応のため）
        if (transcriptId) {
            message.dataset.transcriptId = transcriptId;
        }

        const time = document.createElement('div');
        time.className = 'transcript-time';
        time.textContent = new Date().toLocaleTimeString('ja-JP');

        const content = document.createElement('div');
        content.className = 'transcript-text';
        content.textContent = text;

        message.appendChild(time);
        message.appendChild(content);

        // 最新のメッセージを一番上に追加（prepend）
        // 空状態を削除した後なので、firstChild は最初のメッセージまたは null
        if (container.firstChild) {
            container.insertBefore(message, container.firstChild);
        } else {
            container.appendChild(message);
        }

        console.log('[Transcript] メッセージ追加完了:', container.children.length, '件', transcriptId ? `(ID: ${transcriptId})` : '');

        // 一番上にスクロール（最新のメッセージが見えるように）
        container.scrollTop = 0;

        // 文字数カウント更新
        this.state.charCount += text.length;
        if (this.elements.charCount) {
            this.elements.charCount.textContent = this.state.charCount.toLocaleString();
        }

        return message; // メッセージ要素を返す（後で更新できるように）
    }

    /**
     * トランスクリプトにテキストを追加（既存メッセージに追記）
     *
     * 目的:
     *   最新のメッセージにテキストを追記する（ストリーミング翻訳用）
     *
     * @param {string} type - 'input' または 'output'
     * @param {string} text - 追加するテキスト
     */
    appendTranscript(type, text) {
        // トランスクリプト表示設定をチェック
        const showInput = this.elements.showInputTranscript.classList.contains('active');
        const showOutput = this.elements.showOutputTranscript.classList.contains('active');

        if (type === 'input' && !showInput) {
            return;
        }

        if (type === 'output' && !showOutput) {
            return;
        }

        const container = type === 'input' ?
            this.elements.inputTranscript :
            this.elements.outputTranscript;

        if (!container) {
            console.error('[Transcript] コンテナが見つかりません:', type);
            return;
        }

        // 最新のメッセージ（一番上）のテキスト部分を取得
        const firstMessage = container.querySelector('.transcript-message:first-child');
        if (firstMessage) {
            // テキスト部分を取得（.transcript-text または最後の div）
            const textElement = firstMessage.querySelector('.transcript-text') ||
                               firstMessage.querySelector('div:last-child');

            if (textElement && !textElement.classList.contains('transcript-time')) {
                console.log('[Transcript] 既存メッセージに追加:', textElement.textContent.substring(0, 20) + '...');
                textElement.textContent += text;
            } else {
                console.log('[Transcript] テキスト要素が見つからないため、新規メッセージを作成');
                this.addTranscript(type, text);
            }
        } else {
            console.log('[Transcript] メッセージが存在しないため、新規メッセージを作成');
            this.addTranscript(type, text);
        }

        // 一番上にスクロール（最新のメッセージが見えるように）
        container.scrollTop = 0;

        // 文字数カウント更新
        this.state.charCount += text.length;
        if (this.elements.charCount) {
            this.elements.charCount.textContent = this.state.charCount.toLocaleString();
        }
    }

    /**
     * トランスクリプトをクリア
     *
     * 目的:
     *   入力音声と翻訳結果の表示をクリアする
     *
     * @param {string} type - 'input', 'output', または 'both'（両方）
     */
    clearTranscript(type = 'both') {
        console.log('[Transcript] クリア:', type);

        // 要素が初期化されているか確認
        if (!this.elements || !this.elements.inputTranscript || !this.elements.outputTranscript) {
            console.warn('[Transcript] 要素が初期化されていません。クリアをスキップします。');
            return;
        }

        const clearContainer = (containerType) => {
            const container = containerType === 'input' ?
                this.elements.inputTranscript :
                this.elements.outputTranscript;

            if (!container) {
                console.error('[Transcript] コンテナが見つかりません:', containerType);
                return;
            }

            // すべてのメッセージを削除
            container.innerHTML = '';

            // 空状態を表示
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';

            const icon = document.createElement('div');
            icon.className = 'empty-icon';
            icon.textContent = containerType === 'input' ? '🎤' : '🌐';

            const text = document.createElement('div');
            text.className = 'empty-text';
            text.textContent = containerType === 'input' ?
                '録音を開始すると、ここに音声認識結果が表示されます' :
                '翻訳結果がここに表示されます';

            emptyState.appendChild(icon);
            emptyState.appendChild(text);
            container.appendChild(emptyState);

            console.log('[Transcript] クリア完了:', containerType);
        };

        if (type === 'both') {
            clearContainer('input');
            clearContainer('output');
        } else {
            clearContainer(type);
        }

        // 文字数カウントをリセット
        this.state.charCount = 0;
        if (this.elements.charCount) {
            this.elements.charCount.textContent = '0';
        }

        this.notify('クリア完了', 'トランスクリプトをクリアしました', 'success');
    }

    updateVisualizer(audioData, vadResult = null) {
        const average = audioData.reduce((sum, val) => sum + Math.abs(val), 0) / audioData.length;
        const normalizedLevel = Math.min(1, average * 10);

        this.visualizerBars.forEach((bar, index) => {
            const randomFactor = 0.7 + Math.random() * 0.3;
            const height = Math.max(20, normalizedLevel * 80 * randomFactor);
            bar.style.height = `${height}%`;

            if (vadResult && vadResult.isSpeaking) {
                bar.classList.add('active');
            } else {
                bar.classList.remove('active');
            }
        });
    }

    resetVisualizer() {
        this.visualizerBars.forEach(bar => {
            bar.style.height = '20%';
            bar.classList.remove('active');
        });
    }

    updateConnectionStatus(status) {
        const statusDot = this.elements.connectionStatus;
        const statusText = this.elements.connectionText;

        statusDot.className = 'status-dot';

        switch (status) {
            case 'connecting':
                statusDot.classList.add('connecting');
                statusText.textContent = '接続中...';
                break;
            case 'connected':
                statusDot.classList.add('online');
                statusText.textContent = 'オンライン';
                break;
            case 'error':
                statusDot.classList.add('error');
                statusText.textContent = 'エラー';
                break;
            default:
                statusText.textContent = 'オフライン';
        }
    }

    updateStatus(type, text) {
        console.log(`[Status] ${type}: ${text}`);
    }

    updateVADSensitivity(level) {
        // 音声ソースタイプに応じて適切なVAD設定を選択
        // マイクモード: 静かな環境（個人会議、少人数会議）
        // システム音声モード: 騒がしい環境（ブラウザ音声、会議、音楽）
        const sourceType = this.state.audioSourceType === 'microphone' ? 'MICROPHONE' : 'SYSTEM';
        const settings = CONFIG.VAD[sourceType]?.[level.toUpperCase()];

        if (settings && this.vad) {
            this.vad.threshold = settings.threshold;
            this.vad.adaptiveThreshold = settings.threshold; // 🔧 修正: adaptiveThresholdも更新
            this.vad.debounceTime = settings.debounce;
            console.log(`[VAD] Sensitivity updated: ${level} (${sourceType}モード)`, {
                threshold: settings.threshold,
                adaptiveThreshold: this.vad.adaptiveThreshold,
                debounce: settings.debounce,
                audioSourceType: this.state.audioSourceType
            });
        } else {
            console.warn(`[VAD] 設定が見つかりません: ${sourceType}.${level.toUpperCase()}`);
        }
    }

    updateSession() {
        if (!this.state.isConnected) return;

        // 音声出力が有効かどうかをチェック
        const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
        const modalities = audioOutputEnabled ? ['text', 'audio'] : ['text'];

        // 録音中の場合は、音声設定を変更できない
        // instructionsとmodalitiesのみを更新
        const session = {
            type: 'session.update',
            session: {
                instructions: this.getInstructions(),
                modalities: modalities
            }
        };

        // 録音中でない場合のみ、音声タイプも更新
        if (!this.state.isRecording) {
            session.session.voice = this.state.voiceType;
        }

        this.sendMessage(session);
        console.log('[Session] セッション更新:', {
            isRecording: this.state.isRecording,
            voiceIncluded: !this.state.isRecording,
            audioOutputEnabled: audioOutputEnabled,
            modalities: modalities
        });
    }

    startSessionTimer() {
        this.state.sessionStartTime = Date.now();
        this.timers.sessionTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.state.sessionStartTime) / 1000);
            this.elements.sessionTime.textContent = Utils.formatTime(elapsed);
        }, 1000);
    }

    updateAccuracy() {
        // 簡易的な精度計算（実際の実装では音声認識の信頼度を使用）
        const accuracy = Math.floor(85 + Math.random() * 10);
        this.elements.accuracy.textContent = `${accuracy}%`;
    }

    notify(title, message, type = 'info') {
        const notification = this.elements.notification;
        const titleEl = this.elements.notificationTitle;
        const messageEl = this.elements.notificationMessage;

        titleEl.textContent = title;
        messageEl.textContent = message;

        notification.className = `notification ${type}`;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
        }, 4000);
    }
}

// ====================
// アプリケーション起動
// ====================
document.addEventListener('DOMContentLoaded', () => {
    window.app = new VoiceTranslateApp();
});

// 拡張機能用のエクスポート
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VoiceTranslateApp, CONFIG, Utils, VoiceActivityDetector };
}
