/**
 * VoiceTranslate Pro 2.0 - State Manager
 *
 * 目的:
 *   アプリケーション状態の一元管理
 *   状態変更の監視とイベント発行
 *   設定の永続化
 *
 * 職責:
 *   - アプリケーション状態の保持と更新
 *   - 状態変更の通知（Observer パターン）
 *   - localStorage との同期
 *   - 設定の検証
 */

class StateManager {
    constructor() {
        // アプリケーション状態
        this.state = {
            // 接続状態
            apiKey: '',
            isConnected: false,
            isRecording: false,

            // 言語設定
            sourceLang: null, // 自動検出
            targetLang: 'en',
            voiceType: 'alloy',

            // 音声ソース
            audioSourceType: 'microphone', // 'microphone' | 'system'
            systemAudioSourceId: null,

            // 音声設定
            outputVolume: 2,
            inputAudioOutputEnabled: true,

            // セッション情報
            sessionStartTime: null,
            charCount: 0,

            // フラグ
            isPlayingAudio: false,
            isNewResponse: true
        };

        // WebSocket/AudioContext などのリソース
        this.resources = {
            ws: null,
            audioContext: null,
            outputAudioContext: null,
            mediaStream: null,
            processor: null,
            audioSource: null,
            inputGainNode: null
        };

        // レスポンス管理
        this.responseState = {
            activeResponseId: null,
            pendingResponseId: null,
            lastCommitTime: 0
        };

        // VAD バッファ管理
        this.vadBuffer = {
            speechStartTime: null,
            silenceConfirmTimer: null,
            minSpeechDuration: 1000,
            silenceConfirmDelay: 500
        };

        // 音声バッファ
        this.audioBuffer = {
            chunks: [],
            startTime: null,
            isBuffering: false
        };

        // 再生キュー
        this.playbackQueue = {
            queue: [],
            isPlaying: false,
            isPlayingFromQueue: false,
            currentAudioStartTime: 0
        };

        // 翻訳テキスト累積
        this.translationState = {
            currentText: '',
            currentTranscriptId: null
        };

        // 音声源トラッキング
        this.audioSourceTracker = {
            outputStartTime: null,
            outputEndTime: null,
            bufferWindow: 2000,
            playbackTokens: new Set()
        };

        // モード状態管理
        this.modeState = {
            currentMode: null,
            modeStartTime: null,
            lastModeChange: null,
            modeChangeTimeout: 1000,
            globalLockKey: 'global_capture_mode_v2'
        };

        // 状態変更リスナー
        this.listeners = new Map();

        console.info('[StateManager] 初期化完了');
    }

    /**
     * 状態を取得
     *
     * @param {string} key - 状態キー（ドット記法対応: 'state.isConnected'）
     * @returns {any} 状態値
     */
    get(key) {
        const keys = key.split('.');

        // Traverse the path functionally without assigning `this` to a standalone variable.
        const result = keys.reduce((acc, k) => {
            if (acc && typeof acc === 'object' && k in acc) {
                return acc[k];
            }
            return undefined;
        }, this);

        return result;
    }

    /**
     * 状態を設定
     *
     * @param {string} key - 状態キー（ドット記法対応）
     * @param {any} value - 新しい値
     * @param {boolean} notify - リスナーに通知するか（デフォルト: true）
     */
    set(key, value, notify = true) {
        const keys = key.split('.');
        const lastKey = keys.pop();

        // ネストされたオブジェクトを関数的に辿る（`this` を直接代入しない）
        const parent = keys.reduce((acc, k) => {
            if (acc && typeof acc === 'object' && k in acc) {
                return acc[k];
            }
            return undefined;
        }, this);

        if (!parent || typeof parent !== 'object' || !(lastKey in parent)) {
            console.error('[StateManager] 無効なキー:', key);
            return;
        }

        // 値を設定
        const oldValue = parent[lastKey];
        parent[lastKey] = value;

        // リスナーに通知
        if (notify && oldValue !== value) {
            this.notifyListeners(key, value, oldValue);
        }

        console.info(`[StateManager] 状態更新: ${key} =`, value);
    }

    /**
     * 複数の状態を一括設定
     *
     * @param {Object} updates - 更新する状態のマップ
     */
    setMultiple(updates) {
        for (const [key, value] of Object.entries(updates)) {
            this.set(key, value, false);
        }

        // 一括通知
        this.notifyListeners('*', updates);
    }

    /**
     * 状態変更リスナーを登録
     *
     * @param {string} key - 監視する状態キー（'*' で全変更を監視）
     * @param {Function} callback - コールバック関数 (newValue, oldValue, key) => void
     * @returns {Function} リスナー解除関数
     */
    on(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }

        this.listeners.get(key).push(callback);

        // リスナー解除関数を返す
        return () => {
            const callbacks = this.listeners.get(key);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        };
    }

    /**
     * リスナーに通知
     *
     * @private
     * @param {string} key - 変更されたキー
     * @param {any} newValue - 新しい値
     * @param {any} oldValue - 古い値
     */
    notifyListeners(key, newValue, oldValue) {
        // 特定キーのリスナーに通知
        if (this.listeners.has(key)) {
            for (const callback of this.listeners.get(key)) {
                try {
                    callback(newValue, oldValue, key);
                } catch (error) {
                    console.error('[StateManager] リスナーエラー:', error);
                }
            }
        }

        // 全変更監視リスナーに通知
        if (key !== '*' && this.listeners.has('*')) {
            for (const callback of this.listeners.get('*')) {
                try {
                    callback(newValue, oldValue, key);
                } catch (error) {
                    console.error('[StateManager] リスナーエラー:', error);
                }
            }
        }
    }

    /**
     * 設定を localStorage に保存
     *
     * @param {string} key - 保存キー
     * @param {any} value - 保存する値
     */
    saveToStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            console.info(`[StateManager] localStorage に保存: ${key}`);
        } catch (error) {
            console.error('[StateManager] localStorage 保存エラー:', error);
        }
    }

    /**
     * 設定を localStorage から読み込み
     *
     * @param {string} key - 読み込みキー
     * @param {any} defaultValue - デフォルト値
     * @returns {any} 読み込んだ値
     */
    loadFromStorage(key, defaultValue = null) {
        try {
            const value = localStorage.getItem(key);
            if (value !== null) {
                return JSON.parse(value);
            }
        } catch (error) {
            console.error('[StateManager] localStorage 読み込みエラー:', error);
        }
        return defaultValue;
    }

    /**
     * 状態をリセット
     */
    reset() {
        // 接続状態のみリセット
        this.set('state.isConnected', false);
        this.set('state.isRecording', false);
        this.set('state.isPlayingAudio', false);
        this.set('state.sessionStartTime', null);
        this.set('state.charCount', 0);

        // リソースをクリア
        this.resources.ws = null;
        this.resources.audioContext = null;
        this.resources.outputAudioContext = null;
        this.resources.mediaStream = null;
        this.resources.processor = null;
        this.resources.audioSource = null;
        this.resources.inputGainNode = null;

        // レスポンス状態をリセット
        this.responseState.activeResponseId = null;
        this.responseState.pendingResponseId = null;

        // バッファをクリア
        this.audioBuffer.chunks = [];
        this.audioBuffer.isBuffering = false;

        // 再生キューをクリア
        this.playbackQueue.queue = [];
        this.playbackQueue.isPlaying = false;
        this.playbackQueue.isPlayingFromQueue = false;

        console.info('[StateManager] 状態リセット完了');
    }
}

// 将来の統合用にエクスポート（現在は未使用）
const _StateManager = StateManager;
