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
import type { AppState } from '../interfaces/ICoreTypes';

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
     * プレースホルダーメソッド（後続のパートで実装）
     */
    async loadApiKeyFromEnv(): Promise<void> {
        // Part 2 で実装
    }

    initEventListeners(): void {
        // Part 1 の続きで実装
    }

    initVisualizer(): void {
        // Part 3 で実装
    }

    loadSettings(): void {
        // Part 2 で実装
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

    notify(
        _title: string,
        _message: string,
        _type: 'success' | 'error' | 'warning' | 'info'
    ): void {
        // Part 5 で実装
    }

    sendMessage(_message: unknown): void {
        // Part 2 で実装
    }
}
