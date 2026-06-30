/**
 * VoiceTranslate Pro 2.0 - ユーティリティモジュール
 *
 * 目的:
 *   共通ユーティリティ関数とヘルパークラスを提供
 *
 * 内容:
 *   - ResponseQueue: レスポンスキュー管理
 *   - VoiceActivityDetector: 音声検出
 *   - 設定とプリセット
 *   - データ変換関数
 */

/**
 * レスポンスキュー管理クラス
 *
 * 目的:
 *   OpenAI Realtime APIのレスポンス生成リクエストを管理
 *   並発制御とタイムアウト処理を実装
 */
class ResponseQueue {
    constructor(sendMessageFn, options = {}) {
        this.sendMessage = sendMessageFn;
        this.onRequestSending = options.onRequestSending || null;
        this.config = {
            maxQueueSize: options.maxQueueSize || 10,
            timeout: options.timeout || 60000,
            debugMode: options.debugMode !== undefined ? options.debugMode : false
        };

        this.pendingQueue = [];
        this.processingQueue = [];
        this.timeoutTimer = null;

        this.stats = {
            totalRequests: 0,
            completedRequests: 0,
            failedRequests: 0
        };
    }

    enqueue(request) {
        return new Promise((resolve, reject) => {
            // ✅ 修正: キューが満杯でない限り、リクエストを受け入れる
            // 処理中のリクエストがあっても、ペンディングキューに追加する
            const totalInQueue = this.pendingQueue.length + this.processingQueue.length;
            if (totalInQueue >= this.config.maxQueueSize) {
                const error = new Error('Queue is full');
                reject(error);
                return;
            }

            // ✅ 修正: 処理中のリクエストがある場合は警告するが、キューに追加する
            if (this.processingQueue.length > 0) {
            }

            const item = {
                request: request,
                resolve: resolve,
                reject: reject,
                timestamp: Date.now()
            };

            this.pendingQueue.push(item);
            this.stats.totalRequests++;

            if (this.config.debugMode) {
            }

            this.consume();
        });
    }

    consume() {
        if (this.processingQueue.length > 0) {
            if (this.config.debugMode) {
            }
            return;
        }

        if (this.pendingQueue.length === 0) {
            if (this.config.debugMode) {
            }
            return;
        }

        const item = this.pendingQueue.shift();
        if (!item) {
            return;
        }

        this.processingQueue.push(item);

        if (this.config.debugMode) {
        }

        this.startTimeoutTimer();

        try {
            // ✅ リクエスト送信前にコールバックを呼び出す（レース条件対策）
            if (this.onRequestSending) {
                this.onRequestSending();
            }

            this.sendMessage({
                type: 'response.create',
                response: item.request
            });

            if (this.config.debugMode) {
            }
        } catch (error) {
            this.clearTimeoutTimer();
            this.processingQueue.shift();
            if (item.reject) {
                item.reject(error);
            }
            this.stats.failedRequests++;
            this.consume();
        }
    }

    handleResponseCreated(responseId) {
        if (this.config.debugMode) {
        }

        if (this.processingQueue.length > 0) {
            const item = this.processingQueue[0];
            item.responseId = responseId;

            if (this.config.debugMode) {
            }
        }
    }

    handleResponseDone(responseId) {
        if (this.config.debugMode) {
        }

        if (this.processingQueue.length > 0) {
            const item = this.processingQueue[0];

            if (item.responseId && item.responseId !== responseId) {
                return;
            }
        }

        this.clearTimeoutTimer();

        const item = this.processingQueue.shift();

        if (item) {
            if (item.resolve) {
                item.resolve(responseId);
            }
            this.stats.completedRequests++;
        }

        // ✅ プル型アーキテクチャ: response.done 後に自動的に次のリクエストを送信
        // これにより、activeResponseId/pendingResponseId の管理が不要になる
        if (this.config.debugMode) {
        }
        this.consume();
    }

    handleError(error, code) {
        const errorCode = code || '';
        const errorMessage = error.message || '';
        const isActiveResponseError =
            errorCode === 'conversation_already_has_active_response' ||
            errorMessage.includes('conversation_already_has_active_response') ||
            errorMessage.includes('active response in progress');

        if (isActiveResponseError) {
            this.clearTimeoutTimer();

            // ✅ プル型アーキテクチャ: 処理中のリクエストをpendingキューに戻す
            const item = this.processingQueue.shift();

            if (item) {
                // ✅ 重要: reject ではなく pending キューに戻す
                // これによって サーバー側の response.done イベント後に
                // 自動的にリトライされる（プル型）
                this.pendingQueue.unshift(item); // 先頭に戻す（優先度確保）

                if (this.config.debugMode) {
                }
            }

            // ✅ 注意: consume() を呼ばない
            // 理由: サーバー側の response.done イベントで自動的に consume() が呼ばれる
            // これにより、activeResponseId/pendingResponseId の管理が不要になる
            return;
        }

        this.clearTimeoutTimer();
        const item = this.processingQueue.shift();

        if (item) {
            if (item.reject) {
                item.reject(error);
            }
            this.stats.failedRequests++;
        }

        this.consume();
    }

    startTimeoutTimer() {
        this.clearTimeoutTimer();

        this.timeoutTimer = setTimeout(() => {
            const item = this.processingQueue.shift();

            if (item) {
                if (item.reject) {
                    item.reject(new Error('Response timeout'));
                }
                this.stats.failedRequests++;
            }

            this.consume();
        }, this.config.timeout);
    }

    clearTimeoutTimer() {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
    }

    clear() {
        if (this.config.debugMode) {
        }

        this.clearTimeoutTimer();

        [...this.pendingQueue, ...this.processingQueue].forEach((item) => {
            if (item.reject) {
                item.reject(new Error('Queue cleared'));
            }
        });

        this.pendingQueue = [];
        this.processingQueue = [];
    }

    getStats() {
        return {
            ...this.stats,
            pendingCount: this.pendingQueue.length,
            processingCount: this.processingQueue.length
        };
    }

    getStatus() {
        return this.getStats();
    }
}

/**
 * グローバル設定
 */
// OpenAI エンドポイントの正準URL。CONFIG.API.* は設定で書き換わりうるため、
// 復旧/フォールバック時の基準として別途 const で保持する(ハードコード重複の排除)。
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_REALTIME_TRANSLATION_URL = 'wss://api.openai.com/v1/realtime/translations';

const CONFIG = {
    DEBUG_MODE: false,

    API: {
        // リアルタイム音声翻訳の経路: /v1/realtime/translations + gpt-realtime-translate。
        // 音声入力中に翻訳音声/字幕をストリーム返却し、response.create は使わない。
        REALTIME_URL: OPENAI_REALTIME_TRANSLATION_URL,
        REALTIME_MODEL: 'gpt-realtime-translate',
        // ↓ モデル名は .env (OPENAI_*_MODEL) で設定・上書きする。ここは env 未読込時のフォールバック既定値。
        CHAT_MODEL: 'gpt-5.5',
        // テキスト翻訳・言語検出に使う Chat Completions エンドポイント。
        CHAT_URL: OPENAI_CHAT_COMPLETIONS_URL,
        // ライブ入力音声の並行STT用モデル（低遅延ストリーミング）。
        TRANSCRIBE_MODEL: 'gpt-realtime-whisper',
        TIMEOUT: 30000
    },

    AUDIO_PRESET: 'BALANCED',

    AUDIO_PRESETS: {
        BALANCED: {
            BUFFER_SIZE: 6000,
            MIN_SPEECH_MS: 500,
            VAD_DEBOUNCE: 400,
            DESCRIPTION: '精度と遅延のバランス - 推奨設定'
        },
        AGGRESSIVE: {
            BUFFER_SIZE: 8000,
            MIN_SPEECH_MS: 800,
            VAD_DEBOUNCE: 500,
            DESCRIPTION: '最高精度、ネットワーク負荷最小 - 遅延やや大'
        },
        LOW_LATENCY: {
            BUFFER_SIZE: 4800,
            MIN_SPEECH_MS: 400,
            VAD_DEBOUNCE: 250,
            DESCRIPTION: '最低遅延 - VAD精度やや低'
        },
        SERVER_VAD: {
            BUFFER_SIZE: 4800,
            MIN_SPEECH_MS: 0,
            VAD_DEBOUNCE: 0,
            DESCRIPTION: 'OpenAI Server VAD使用 - 最高精度、ネットワーク負荷大'
        }
    },

    AUDIO: {
        SAMPLE_RATE: 24000,
        CHUNK_SIZE: 4800,
        FORMAT: 'pcm16'
    },

    /**
     * 翻訳の区切り（ターン検出）方式の既定値
     *
     * @description
     * リアルタイムLLMの特性を活かし、文脈を保った高精度翻訳を行うための設定。
     * ブラウザ/拡張機能は .env を読めないため、ここが既定値として効く。
     * Electron では .env の TRANSLATION_* で上書きされる（voicetranslate-pro.js の loadEnvConfig）。
     *
     * @property {string} TURN_MODE - 'grouped'（整文1-3句をまとめて翻訳。既定・推奨）| 'immediate'（従来の無音区切り即時翻訳）
     * @property {string} VAD_TYPE - 'semantic_vad'（意味的完結で区切る公式機能。既定）| 'server_vad'（従来の無音検出）
     * @property {string} SEMANTIC_EAGERNESS - semantic_vad の区切り積極性 'medium'（既定・品質/遅延の均衡）| 'low' | 'high' | 'auto'
     * @property {number} MIN_COMPLETE_SENTENCES - 翻訳を開始できる最小の完全文数（既定1）
     * @property {number} MAX_SENTENCES - グルーピングの最大文数（既定3）
     * @property {number} POST_SENTENCE_HOLD_MS - 1文完結後に追加発話を待つ短い猶予（既定500ms）
     * @property {number} MAX_BUFFER_MS - グルーピングの最大蓄積時間ms（既定6000）。無限待機を防ぐ上限
     */
    TRANSLATION: {
        TURN_MODE: 'grouped',
        VAD_TYPE: 'semantic_vad',
        SEMANTIC_EAGERNESS: 'medium',
        MIN_COMPLETE_SENTENCES: 1,
        MAX_SENTENCES: 1,
        // 1文完結後にポーズ（次発話の有無）を見極める猶予。日中語の文間ポーズは
        // 概ね 300-500ms。短くするほど「1文＝即送信」に近づき実時性が上がる。
        POST_SENTENCE_HOLD_MS: 150,
        MAX_BUFFER_MS: 2500
    },

    VAD: {
        MICROPHONE: {
            LOW: { threshold: 0.008, debounce: 600 }, // ✅ 400 → 600ms (音声結巴を防ぐ)
            MEDIUM: { threshold: 0.004, debounce: 500 }, // ✅ 250 → 500ms (音声結巴を防ぐ)
            HIGH: { threshold: 0.002, debounce: 300 } // ✅ 150 → 300ms (音声結巴を防ぐ)
        },
        SYSTEM: {
            LOW: { threshold: 0.015, debounce: 700 }, // ✅ 500 → 700ms (音声結巴を防ぐ)
            MEDIUM: { threshold: 0.01, debounce: 600 }, // ✅ 350 → 600ms (音声結巴を防ぐ)
            HIGH: { threshold: 0.006, debounce: 400 } // ✅ 250 → 400ms (音声結巴を防ぐ)
        }
    }
};

const SUPPORTED_LANGUAGE_CODES = Object.freeze(['ja', 'zh', 'en', 'vi']);
const VIETNAMESE_MARK_RE =
    /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;
const JAPANESE_KANA_RE = /[\u3040-\u309F\u30A0-\u30FF]/;
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]/;
const SIMPLIFIED_CHINESE_HINT_RE = /[这们汉语吗没过说让对会后发现为国个来]/;
const LATIN_RE = /[A-Za-z]/;

/**
 * 現在のプリセット設定を取得
 */
function getAudioPreset() {
    return CONFIG.AUDIO_PRESETS[CONFIG.AUDIO_PRESET] || CONFIG.AUDIO_PRESETS.BALANCED;
}

/**
 * データ変換ユーティリティ
 */
const AudioUtils = {
    SUPPORTED_LANGUAGE_CODES,

    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return globalThis.btoa(binary);
    },

    base64ToArrayBuffer(base64) {
        const binaryString = globalThis.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    },

    floatTo16BitPCM(float32Array) {
        const buffer = new ArrayBuffer(float32Array.length * 2);
        const view = new DataView(buffer);
        let offset = 0;
        for (let i = 0; i < float32Array.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return buffer;
    },

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    },

    /**
     * 翻訳出力からアシスタント定型句を除去する防御的後処理（多層防御）。
     *
     * プロンプトで「翻訳のみ」を強制しているが、稀にモデルが定型句を出すため、
     * 表示前の最終ガードとして使う。誤って正当な翻訳を捨てないよう **保守的** に判定する:
     *   - 先頭の「Here is the translation:」「翻訳:」等のメタ接頭辞のみ除去
     *   - 全文がモデルの自己言及/拒否（"I'm an AI assistant" 等）の場合のみ空文字を返す
     * 上記以外の本文は一切変更しない。
     *
     * @param {string} text - モデル出力（trim 済みを想定）
     * @returns {string} 整形後テキスト。破棄すべき場合は ''（空文字）
     */
    stripAssistantBoilerplate(text) {
        if (typeof text !== 'string') {
            return '';
        }
        let out = text.trim();

        // 先頭のメタ接頭辞を除去（例: "Here is the translation: ..." → "..."）
        out = out.replace(
            /^(here is|here'?s)\s+(the\s+|your\s+)?(translation|translated text)\s*[:：]?\s*/i,
            ''
        );
        out = out.replace(/^(translation|translated text|翻訳|訳)\s*[:：]\s*/i, '');
        out = out.trim();

        // 全文がモデルの自己言及/拒否の場合のみ破棄（正当な翻訳本文は残す）
        const selfReference = [
            /^i(?:'?m| am)\s+(?:an?\s+)?(?:ai|assistant|language model)\b/i,
            /^i\s+(?:can(?:'?t|not)|am unable to)\s+(?:translate|help|assist)\b/i,
            /^sorry,?\s+i\s+(?:can(?:'?t|not)|misunderstood|didn'?t)\b/i,
            /^as an ai\b/i
        ];
        if (selfReference.some((re) => re.test(out))) {
            return '';
        }

        return out;
    },

    isSupportedLanguage(code) {
        return SUPPORTED_LANGUAGE_CODES.includes(code);
    },

    normalizeLanguageCode(code, fallback = 'en') {
        if (this.isSupportedLanguage(code)) {
            return code;
        }
        return this.isSupportedLanguage(fallback) ? fallback : 'en';
    },

    detectSupportedLanguageFromText(text, fallback = 'en') {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            return null;
        }

        if (JAPANESE_KANA_RE.test(trimmed)) {
            return 'ja';
        }
        if (VIETNAMESE_MARK_RE.test(trimmed)) {
            return 'vi';
        }
        if (CJK_RE.test(trimmed)) {
            if (SIMPLIFIED_CHINESE_HINT_RE.test(trimmed)) {
                return 'zh';
            }
            // Four-language mode must not return auto. Han-only text is closest to Chinese.
            return 'zh';
        }
        if (LATIN_RE.test(trimmed)) {
            return 'en';
        }

        return this.normalizeLanguageCode(fallback, 'en');
    },

    getLanguageName(code) {
        const languages = {
            ja: 'Japanese',
            en: 'English',
            zh: 'Simplified Chinese',
            vi: 'Vietnamese'
        };
        return languages[code] || code;
    },

    getNativeLanguageName(code) {
        const nativeNames = {
            ja: '日本語',
            en: 'English',
            zh: '简体中文',
            vi: 'Tiếng Việt'
        };
        return nativeNames[code] || code;
    }
};

/**
 * 音声検出クラス
 */
class VoiceActivityDetector {
    constructor(options = {}) {
        this.threshold = options.threshold || 0.01;
        this.debounce = options.debounce || 300;
        this.energyHistory = [];
        this.historySize = 10;
        this.isSpeaking = false;
        this.lastSpeechTime = 0;
        this.calibrationSamples = [];
        this.calibrationComplete = false;
        this.noiseFloor = 0;
    }

    analyze(audioData) {
        const energy = this.calculateEnergy(audioData);
        this.energyHistory.push(energy);
        if (this.energyHistory.length > this.historySize) {
            this.energyHistory.shift();
        }

        if (!this.calibrationComplete && this.calibrationSamples.length < 30) {
            this.calibrationSamples.push(energy);
            if (this.calibrationSamples.length === 30) {
                this.completeCalibration();
            }
            return { isSpeaking: false, energy: energy, calibrating: true };
        }

        const smoothedEnergy = this.getSmoothedEnergy();
        const adjustedThreshold = Math.max(this.threshold, this.noiseFloor * 2);
        const now = Date.now();

        if (smoothedEnergy > adjustedThreshold) {
            this.lastSpeechTime = now;
            this.isSpeaking = true;
        } else if (this.isSpeaking && now - this.lastSpeechTime > this.debounce) {
            this.isSpeaking = false;
        }

        return {
            isSpeaking: this.isSpeaking,
            energy: smoothedEnergy,
            threshold: adjustedThreshold,
            calibrating: false
        };
    }

    calculateEnergy(data) {
        let sum = 0;
        for (const value of data) {
            sum += value * value;
        }
        return Math.sqrt(sum / data.length);
    }

    getSmoothedEnergy() {
        if (this.energyHistory.length === 0) {
            return 0;
        }
        const sum = this.energyHistory.reduce((a, b) => a + b, 0);
        return sum / this.energyHistory.length;
    }

    completeCalibration() {
        this.calibrationComplete = true;
        const sum = this.calibrationSamples.reduce((a, b) => a + b, 0);
        const avg = sum / this.calibrationSamples.length;
        const variance =
            this.calibrationSamples.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) /
            this.calibrationSamples.length;
        const stdDev = Math.sqrt(variance);
        this.noiseFloor = avg + stdDev;
    }

    reset() {
        this.energyHistory = [];
        this.isSpeaking = false;
        this.lastSpeechTime = 0;
        this.calibrationSamples = [];
        this.calibrationComplete = false;
        this.noiseFloor = 0;
    }
}

/**
 * モジュールエクスポート
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ResponseQueue,
        VoiceActivityDetector,
        CONFIG,
        getAudioPreset,
        AudioUtils
    };
}
