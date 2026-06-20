/**
 * VoiceTranslateCore.ts
 *
 * 目的: VoiceTranslate Pro のコアロジック
 *
 * 注意:
 *   - このファイルは voicetranslate-pro.js (Line 264-3044) から抽出
 *   - ブラウザ拡張機能とElectronアプリで共有
 *   - DOM操作は IPlatformAdapter を通じて抽象化（段階的移行）
 */

import { VoiceActivityDetector } from './VAD';
import { ResponseStateManager } from './ResponseStateManager';
import { ImprovedResponseQueue } from './ImprovedResponseQueue';
import { CONFIG } from './Config';
import { WebSocketManager } from './WebSocketManager';
import { AudioManager } from './AudioManager';
import { UIManager } from './UIManager';
import type { AppState, NotificationType } from '../interfaces/ICoreTypes';

/**
 * 設定の永続化に使用する localStorage キー
 *
 * 注意: HTML/JS版 (voicetranslate-pro.js) と同一のキー・生文字列保存形式を踏襲し、
 *       両実装間で設定を相互利用できるようにする
 */
const STORAGE_KEYS = {
    apiKey: 'openai_api_key',
    targetLang: 'target_lang',
    voiceType: 'voice_type',
    realtimeModel: 'realtime_model',
    chatModel: 'chat_model',
    vadSensitivity: 'vad_sensitivity'
} as const;

/** APIキーの接頭辞 */
const API_KEY_PREFIX = 'sk-';
/** APIキーとして有効とみなす最小長 */
const API_KEY_MIN_LENGTH = 20;
/** APIキー入力進捗バーの分母 (length / 50 で割合を算出) */
const API_KEY_PROGRESS_DENOMINATOR = 50;
/** APIキー検証のシミュレーション待機時間 (ミリ秒) */
const VALIDATE_SIMULATION_MS = 1000;
/** APIキー検証成功表示を元に戻すまでの時間 (ミリ秒) */
const VALIDATE_RESET_MS = 2000;

/**
 * DOM要素の参照
 */
interface DOMElements {
    // API設定
    apiKey: HTMLInputElement | null;
    validateBtn: HTMLButtonElement | null;

    // 言語設定
    sourceLang: HTMLSelectElement | null;
    targetLang: HTMLSelectElement | null;
    voiceType: HTMLSelectElement | null;
    sourceLangDisplay: HTMLElement | null;
    targetLangDisplay: HTMLElement | null;

    // モデル設定
    realtimeModel: HTMLSelectElement | null;
    chatModel: HTMLSelectElement | null;

    // 詳細設定
    vadEnabled: HTMLElement | null;
    noiseReduction: HTMLElement | null;
    echoCancellation: HTMLElement | null;
    autoGainControl: HTMLElement | null;
    vadSensitivity: HTMLSelectElement | null;
    showInputTranscript: HTMLElement | null;
    showOutputTranscript: HTMLElement | null;
    audioOutputEnabled: HTMLElement | null;
    inputAudioOutputEnabled: HTMLElement | null;

    // コントロール
    connectBtn: HTMLButtonElement | null;
    disconnectBtn: HTMLButtonElement | null;
    startBtn: HTMLButtonElement | null;
    stopBtn: HTMLButtonElement | null;

    // ステータス
    connectionStatus: HTMLElement | null;
    connectionText: HTMLElement | null;

    // 統計
    sessionTime: HTMLElement | null;
    charCount: HTMLElement | null;
    latency: HTMLElement | null;
    accuracy: HTMLElement | null;

    // トランスクリプト
    inputTranscript: HTMLElement | null;
    outputTranscript: HTMLElement | null;
    clearInputBtn: HTMLButtonElement | null;
    clearOutputBtn: HTMLButtonElement | null;
    clearAllBtn: HTMLButtonElement | null;

    // ビジュアライザー
    visualizer: HTMLCanvasElement | null;

    // 通知
    notification: HTMLElement | null;
    notificationTitle: HTMLElement | null;
    notificationMessage: HTMLElement | null;
}

/**
 * タイマーの参照
 */
interface Timers {
    sessionTime?: number;
    [key: string]: number | undefined;
}

/**
 * VoiceTranslateCore クラス
 *
 * 目的: リアルタイム音声翻訳のコアロジック
 */
export class VoiceTranslateCore {
    // 状態管理
    state: AppState;

    // VAD
    vad: VoiceActivityDetector | null;

    // マネージャー
    wsManager: WebSocketManager;
    audioManager: AudioManager;
    uiManager: UIManager;

    // DOM要素
    elements: DOMElements;

    // タイマー
    timers: Timers;

    // 音声再生キュー
    audioQueue: string[];
    playbackQueue: string[];
    isPlayingAudio: boolean;
    isPlayingFromQueue: boolean;
    currentAudioStartTime: number;

    // 翻訳テキスト累積
    currentTranslationText: string;

    // レスポンス状態管理（新アーキテクチャ）
    responseStateManager: ResponseStateManager;
    responseQueue: ImprovedResponseQueue;
    lastCommitTime: number;

    /**
     * コンストラクタ
     */
    constructor() {
        // 状態初期化
        this.state = {
            apiKey: '',
            isConnected: false,
            isRecording: false,
            sourceLang: null, // ✅ 修正: 自動検出に変更、初期値は null
            targetLang: 'en',
            voiceType: 'alloy',
            sessionStartTime: null,
            charCount: 0,
            ws: null,
            audioSourceType: 'microphone',
            systemAudioSourceId: null,
            outputVolume: 2.0,
            isPlayingAudio: false,
            inputAudioOutputEnabled: true
        };

        // VAD初期化
        this.vad = null;

        // マネージャー初期化
        this.wsManager = new WebSocketManager();
        this.audioManager = new AudioManager();
        this.uiManager = new UIManager();

        // DOM要素初期化
        this.elements = {} as DOMElements;

        // タイマー初期化
        this.timers = {};

        // 音声再生キュー初期化
        this.audioQueue = [];
        this.playbackQueue = [];
        this.isPlayingAudio = false;
        this.isPlayingFromQueue = false;
        this.currentAudioStartTime = 0;

        // 翻訳テキスト累積初期化
        this.currentTranslationText = '';

        // レスポンス状態管理初期化（新アーキテクチャ）
        this.responseStateManager = new ResponseStateManager();
        this.responseQueue = new ImprovedResponseQueue(this.responseStateManager, {
            timeout: 30000, // 30秒タイムアウト
            processingDelay: 100, // 100ms処理遅延
            debugMode: CONFIG.DEBUG_MODE
        });
        this.lastCommitTime = 0;

        // レスポンスキューの送信関数を設定
        this.responseQueue.setSendFunction((message) => {
            this.sendMessage(message);
        });

        // 初期化
        this.init();
    }

    /**
     * 初期化
     */
    async init(): Promise<void> {
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

        console.info('[App] VoiceTranslate Pro v3.0 初期化完了');
        this.notify('システム準備完了', 'VoiceTranslate Proが起動しました', 'success');
    }

    /**
     * DOM要素を初期化
     */
    initElements(): void {
        // API設定
        this.elements.apiKey = document.getElementById('apiKey') as HTMLInputElement;
        this.elements.validateBtn = document.getElementById('validateBtn') as HTMLButtonElement;

        // 言語設定
        this.elements.sourceLang = document.getElementById('sourceLang') as HTMLSelectElement;
        this.elements.targetLang = document.getElementById('targetLang') as HTMLSelectElement;
        this.elements.voiceType = document.getElementById('voiceType') as HTMLSelectElement;
        this.elements.sourceLangDisplay = document.getElementById('sourceLangDisplay');
        this.elements.targetLangDisplay = document.getElementById('targetLangDisplay');

        // モデル設定
        this.elements.realtimeModel = document.getElementById('realtimeModel') as HTMLSelectElement;
        this.elements.chatModel = document.getElementById('chatModel') as HTMLSelectElement;

        // 詳細設定
        this.elements.vadEnabled = document.getElementById('vadEnabled');
        this.elements.noiseReduction = document.getElementById('noiseReduction');
        this.elements.echoCancellation = document.getElementById('echoCancellation');
        this.elements.autoGainControl = document.getElementById('autoGainControl');
        this.elements.vadSensitivity = document.getElementById(
            'vadSensitivity'
        ) as HTMLSelectElement;
        this.elements.showInputTranscript = document.getElementById('showInputTranscript');
        this.elements.showOutputTranscript = document.getElementById('showOutputTranscript');
        this.elements.audioOutputEnabled = document.getElementById('audioOutputEnabled');
        this.elements.inputAudioOutputEnabled = document.getElementById('inputAudioOutputEnabled');

        // コントロール
        this.elements.connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
        this.elements.disconnectBtn = document.getElementById('disconnectBtn') as HTMLButtonElement;
        this.elements.startBtn = document.getElementById('startBtn') as HTMLButtonElement;
        this.elements.stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;

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
        this.elements.clearInputBtn = document.getElementById('clearInputBtn') as HTMLButtonElement;
        this.elements.clearOutputBtn = document.getElementById(
            'clearOutputBtn'
        ) as HTMLButtonElement;
        this.elements.clearAllBtn = document.getElementById('clearAllBtn') as HTMLButtonElement;

        // ビジュアライザー
        this.elements.visualizer = document.getElementById('visualizer') as HTMLCanvasElement;

        // 通知
        this.elements.notification = document.getElementById('notification');
        this.elements.notificationTitle = document.getElementById('notificationTitle');
        this.elements.notificationMessage = document.getElementById('notificationMessage');
    }

    /**
     * 環境変数から APIキー・モデル設定を読み込む
     *
     * 目的:
     *   Electron環境では preload (electronAPI) 経由で main プロセスの
     *   環境変数を取得し、APIキーと CONFIG (Realtime/Chatモデル, URL) を初期化する。
     *   ブラウザ環境では electronAPI が存在しないため何もしない。
     *
     * 注意:
     *   ここで設定した CONFIG 値は、後続の loadSettings() による
     *   UI保存値で上書きされる場合がある (UI保存値を優先)。
     */
    async loadApiKeyFromEnv(): Promise<void> {
        const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
        if (api === undefined) {
            return;
        }

        try {
            const envApiKey = await api.getEnvApiKey();
            if (envApiKey !== null && envApiKey !== '') {
                this.state.apiKey = envApiKey;
                if (this.elements.apiKey !== null) {
                    this.elements.apiKey.value = envApiKey;
                }
            }

            const envConfig = await api.getEnvConfig();
            if (envConfig !== null) {
                CONFIG.API.REALTIME_MODEL = envConfig.realtimeModel;
                CONFIG.API.CHAT_MODEL = envConfig.chatModel;
                CONFIG.API.REALTIME_URL = envConfig.realtimeUrl;
            }
        } catch (error) {
            console.error('[App] 環境変数読み込みエラー:', error);
        }
    }

    /**
     * 設定UIのイベントリスナーを登録する
     *
     * 対象: APIキー入力・検証、ターゲット言語、翻訳音色、
     *       Realtimeモデル、Chatモデル、VAD感度。
     *
     * 注意:
     *   接続中のセッション再同期 (updateSession) やトランスクリプト消去は
     *   接続サブシステム未移植のため本層では扱わない。
     */
    initEventListeners(): void {
        this.elements.validateBtn?.addEventListener('click', () => {
            void this.validateApiKey();
        });

        this.elements.apiKey?.addEventListener('input', () => {
            this.handleApiKeyInput();
        });

        this.elements.targetLang?.addEventListener('change', () => {
            const select = this.elements.targetLang;
            if (select === null) {
                return;
            }
            this.state.targetLang = select.value;
            this.updateTargetLangDisplay(select.value);
            this.saveToStorage(STORAGE_KEYS.targetLang, select.value);
        });

        this.elements.voiceType?.addEventListener('change', () => {
            const select = this.elements.voiceType;
            if (select === null) {
                return;
            }
            this.state.voiceType = select.value;
            this.saveToStorage(STORAGE_KEYS.voiceType, select.value);
        });

        // Realtimeモデル変更 (次回接続時に反映)
        this.elements.realtimeModel?.addEventListener('change', () => {
            const select = this.elements.realtimeModel;
            if (select === null) {
                return;
            }
            CONFIG.API.REALTIME_MODEL = select.value;
            this.saveToStorage(STORAGE_KEYS.realtimeModel, select.value);
            if (this.state.isConnected) {
                this.notify('モデル変更', 'Realtimeモデルは次回「接続」時に反映されます', 'info');
            }
        });

        // Chatモデル変更 (即時反映)
        this.elements.chatModel?.addEventListener('change', () => {
            const select = this.elements.chatModel;
            if (select === null) {
                return;
            }
            CONFIG.API.CHAT_MODEL = select.value;
            this.saveToStorage(STORAGE_KEYS.chatModel, select.value);
        });

        this.elements.vadSensitivity?.addEventListener('change', () => {
            const select = this.elements.vadSensitivity;
            if (select === null) {
                return;
            }
            this.saveToStorage(STORAGE_KEYS.vadSensitivity, select.value);
        });
    }

    initVisualizer(): void {
        // Part 3 で実装
    }

    /**
     * 永続化された設定を localStorage から復元し、UI と CONFIG に反映する
     *
     * モデル設定の優先順位:
     *   UI保存値 (localStorage) > 環境変数/既定値 (CONFIG)
     *   未保存の場合は現在の CONFIG 値をセレクトに反映し、表示と実使用値を一致させる。
     *
     * 注意: loadApiKeyFromEnv() の後に呼び出すこと (env既定値を上書きするため)。
     */
    loadSettings(): void {
        const apiKey = this.getFromStorage(STORAGE_KEYS.apiKey);
        const targetLang = this.getFromStorage(STORAGE_KEYS.targetLang);
        const voiceType = this.getFromStorage(STORAGE_KEYS.voiceType);
        const realtimeModel = this.getFromStorage(STORAGE_KEYS.realtimeModel);
        const chatModel = this.getFromStorage(STORAGE_KEYS.chatModel);
        const vadSensitivity = this.getFromStorage(STORAGE_KEYS.vadSensitivity);

        if (apiKey !== null && apiKey !== '') {
            this.state.apiKey = apiKey;
            if (this.elements.apiKey !== null) {
                this.elements.apiKey.value = apiKey;
            }
            const progress = document.getElementById('apiKeyProgress');
            if (progress !== null) {
                progress.style.width = '100%';
            }
        }

        if (targetLang !== null && targetLang !== '') {
            this.state.targetLang = targetLang;
            if (this.elements.targetLang !== null) {
                this.elements.targetLang.value = targetLang;
            }
            this.updateTargetLangDisplay(targetLang);
        }

        if (voiceType !== null && voiceType !== '') {
            this.state.voiceType = voiceType;
            if (this.elements.voiceType !== null) {
                this.elements.voiceType.value = voiceType;
            }
        }

        // モデル設定 (UI保存値を優先、未保存なら現在の CONFIG 値を表示)
        if (realtimeModel !== null && realtimeModel !== '') {
            CONFIG.API.REALTIME_MODEL = realtimeModel;
        }
        if (this.elements.realtimeModel !== null) {
            this.elements.realtimeModel.value = CONFIG.API.REALTIME_MODEL;
        }

        if (chatModel !== null && chatModel !== '') {
            CONFIG.API.CHAT_MODEL = chatModel;
        }
        if (this.elements.chatModel !== null) {
            this.elements.chatModel.value = CONFIG.API.CHAT_MODEL;
        }

        if (
            vadSensitivity !== null &&
            vadSensitivity !== '' &&
            this.elements.vadSensitivity !== null
        ) {
            this.elements.vadSensitivity.value = vadSensitivity;
        }
    }

    initVAD(): void {
        // Part 3 で実装
    }

    initCrossInstanceSync(): void {
        // Part 2 で実装
    }

    async checkMicrophonePermission(): Promise<void> {
        // Part 3 で実装
    }

    /**
     * 通知を表示する (UIManager へ委譲)
     *
     * @param title - タイトル
     * @param message - メッセージ本文
     * @param type - 通知タイプ
     */
    notify(title: string, message: string, type: NotificationType): void {
        this.uiManager.notify({ title, message, type });
    }

    sendMessage(_message: unknown): void {
        // Part 2 で実装
    }

    /**
     * APIキーを検証する
     *
     * 注意: 実ネットワーク検証は接続サブシステム側で行うため、
     *       ここでは HTML/JS版と同一の擬似検証 (待機 + 形式チェック) を行う。
     */
    async validateApiKey(): Promise<void> {
        const btn = this.elements.validateBtn;
        if (btn === null) {
            return;
        }
        const textEl = btn.querySelector('#validateBtnText');
        const originalText = textEl?.textContent ?? '';

        if (this.state.apiKey === '' || !this.state.apiKey.startsWith(API_KEY_PREFIX)) {
            this.notify('エラー', '有効なAPIキーを入力してください', 'error');
            return;
        }

        btn.disabled = true;
        if (textEl !== null) {
            textEl.innerHTML = '<span class="spinner"></span> 検証中...';
        }

        try {
            await new Promise<void>((resolve) => setTimeout(resolve, VALIDATE_SIMULATION_MS));

            this.notify('成功', 'APIキーが検証されました', 'success');
            if (textEl !== null) {
                textEl.textContent = '✓ 検証済み';
            }

            setTimeout(() => {
                if (textEl !== null) {
                    textEl.textContent = originalText;
                }
                btn.disabled = false;
            }, VALIDATE_RESET_MS);
        } catch (error) {
            console.error('[API Validation] APIキー検証エラー:', error);
            this.notify('エラー', 'APIキーの検証に失敗しました', 'error');
            if (textEl !== null) {
                textEl.textContent = originalText;
            }
            btn.disabled = false;
        }
    }

    /**
     * APIキー入力欄の input イベント処理 (進捗バー更新 + 保存)
     */
    private handleApiKeyInput(): void {
        const input = this.elements.apiKey;
        if (input === null) {
            return;
        }
        const value = input.value;
        const progress = document.getElementById('apiKeyProgress');

        if (value.startsWith(API_KEY_PREFIX) && value.length > API_KEY_MIN_LENGTH) {
            if (progress !== null) {
                progress.style.width = '100%';
            }
            this.state.apiKey = value;
            this.saveToStorage(STORAGE_KEYS.apiKey, value);
        } else if (progress !== null) {
            progress.style.width = `${(value.length / API_KEY_PROGRESS_DENOMINATOR) * 100}%`;
        }
    }

    /**
     * ターゲット言語表示を更新する
     *
     * @param lang - 言語コード
     */
    private updateTargetLangDisplay(lang: string): void {
        const display = this.elements.targetLangDisplay;
        if (display === null) {
            return;
        }
        const select = this.elements.targetLang;
        const option =
            select !== null
                ? Array.from(select.options).find((opt) => opt.value === lang)
                : undefined;
        display.textContent = option !== undefined ? option.text : lang;
    }

    /**
     * 設定値を localStorage に保存する (HTML/JS版と同じ生文字列形式)
     *
     * @param key - 保存キー
     * @param value - 保存する値
     */
    private saveToStorage(key: string, value: string): void {
        try {
            localStorage.setItem(key, value);
        } catch (error) {
            console.error('[App] localStorage 保存エラー:', error);
        }
    }

    /**
     * 設定値を localStorage から読み込む
     *
     * @param key - 読み込みキー
     * @returns 保存値 (未保存・エラー時は null)
     */
    private getFromStorage(key: string): string | null {
        try {
            return localStorage.getItem(key);
        } catch (error) {
            console.error('[App] localStorage 読み込みエラー:', error);
            return null;
        }
    }
}
