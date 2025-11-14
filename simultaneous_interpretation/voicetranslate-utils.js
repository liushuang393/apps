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
                console.warn('[ResponseQueue] キューが満杯:', {
                    processing: this.processingQueue.length,
                    pending: this.pendingQueue.length,
                    maxSize: this.config.maxQueueSize
                });
                reject(error);
                return;
            }

            // ✅ 修正: 処理中のリクエストがある場合は警告するが、キューに追加する
            if (this.processingQueue.length > 0) {
                console.warn(
                    '[ResponseQueue] 処理中のリクエストがあるため、ペンディングキューに追加:',
                    {
                        processing: this.processingQueue.length,
                        pending: this.pendingQueue.length + 1
                    }
                );
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
                console.info('[ResponseQueue] 生産:', {
                    pending: this.pendingQueue.length,
                    processing: this.processingQueue.length
                });
            }

            this.consume();
        });
    }

    consume() {
        if (this.processingQueue.length > 0) {
            if (this.config.debugMode) {
                console.info('[ResponseQueue] 処理中のリクエストがあるため待機:', {
                    processing: this.processingQueue.length
                });
            }
            return;
        }

        if (this.pendingQueue.length === 0) {
            if (this.config.debugMode) {
                console.info('[ResponseQueue] 未送信キューが空です');
            }
            return;
        }

        const item = this.pendingQueue.shift();
        if (!item) {
            return;
        }

        this.processingQueue.push(item);

        if (this.config.debugMode) {
            console.info('[ResponseQueue] 消費開始:', {
                pending: this.pendingQueue.length,
                processing: this.processingQueue.length,
                timestamp: Date.now()
            });
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
                console.info('[ResponseQueue] リクエスト送信完了:', {
                    processing: this.processingQueue.length
                });
            }
        } catch (error) {
            console.error('[ResponseQueue] 送信失敗:', error);
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
            console.info('[ResponseQueue] レスポンス作成:', responseId);
        }

        if (this.processingQueue.length > 0) {
            const item = this.processingQueue[0];
            item.responseId = responseId;

            if (this.config.debugMode) {
                console.info('[ResponseQueue] Response ID記録:', {
                    responseId: responseId,
                    timestamp: Date.now()
                });
            }
        }
    }

    handleResponseDone(responseId) {
        if (this.config.debugMode) {
            console.info('[ResponseQueue] 消費完了:', responseId);
        }

        if (this.processingQueue.length > 0) {
            const item = this.processingQueue[0];

            if (item.responseId && item.responseId !== responseId) {
                console.warn('[ResponseQueue] Response ID不一致:', {
                    expected: item.responseId,
                    received: responseId
                });
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
            console.info('[ResponseQueue] 次のリクエストを自動送信:', {
                pending: this.pendingQueue.length
            });
        }
        this.consume();
    }

    handleError(error, code) {
        console.error('[ResponseQueue] Error:', error);

        const errorCode = code || '';
        const errorMessage = error.message || '';
        const isActiveResponseError =
            errorCode === 'conversation_already_has_active_response' ||
            errorMessage.includes('conversation_already_has_active_response') ||
            errorMessage.includes('active response in progress');

        if (isActiveResponseError) {
            console.warn('[ResponseQueue] Active response still in progress - waiting for response.done.', {
                code: errorCode || 'N/A',
                pending: this.pendingQueue.length,
                processing: this.processingQueue.length
            });

            this.clearTimeoutTimer();

            // ✅ プル型アーキテクチャ: 処理中のリクエストをpendingキューに戻す
            const item = this.processingQueue.shift();

            if (item) {
                // ✅ 重要: reject ではなく pending キューに戻す
                // これによって サーバー側の response.done イベント後に
                // 自動的にリトライされる（プル型）
                this.pendingQueue.unshift(item); // 先頭に戻す（優先度確保）

                if (this.config.debugMode) {
                    console.info('[ResponseQueue] リクエストを保留キューに戻しました（response.done 後に自動再送信）:', {
                        pending: this.pendingQueue.length,
                        processing: this.processingQueue.length
                    });
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
            console.error('[ResponseQueue] タイムアウト - processingQueueをクリアします');

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
            console.info('[ResponseQueue] キューをクリア');
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
const CONFIG = {
    DEBUG_MODE: false,

    API: {
        REALTIME_URL: 'wss://api.openai.com/v1/realtime',
        REALTIME_MODEL: 'gpt-realtime-2025-08-28',
        CHAT_MODEL: 'gpt-5-2025-08-07',
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

    getLanguageName(code) {
        const languages = {
            ja: '日本語',
            en: 'English',
            zh: '简体中文',
            ko: '한국어',
            es: 'Español',
            fr: 'Français',
            de: 'Deutsch',
            it: 'Italiano',
            pt: 'Português',
            ru: 'Русский'
        };
        return languages[code] || code;
    },

    getNativeLanguageName(code) {
        const nativeNames = {
            ja: '日本語',
            en: 'English',
            zh: '简体中文',
            ko: '한국어',
            es: 'Español',
            fr: 'Français',
            de: 'Deutsch',
            it: 'Italiano',
            pt: 'Português',
            ru: 'Русский'
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
        console.info('[VAD] キャリブレーション完了:', {
            average: avg.toFixed(6),
            stdDev: stdDev.toFixed(6),
            noiseFloor: this.noiseFloor.toFixed(6)
        });
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
