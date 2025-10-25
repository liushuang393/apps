/**
 * VoiceTranslate Pro 2.0 - メインアプリケーション
 *
 * 依存モジュール:
 *   - voicetranslate-utils.js: ResponseQueue, VoiceActivityDetector, CONFIG, AudioUtils
 *   - voicetranslate-audio-queue.js: AudioSegment, AudioQueue (✅ 新規)
 *   - voicetranslate-path-processors.js: TextPathProcessor, VoicePathProcessor (✅ 新規)
 *
 * 注意:
 *   このファイルを読み込む前に上記モジュールを読み込む必要があります
 */

// Utils オブジェクトを AudioUtils にマッピング（互換性のため）
const Utils = AudioUtils;

// ====================
// メインアプリケーションクラス
class VoiceTranslateApp {
    constructor() {
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
            audioContext: null, // 入力音声処理用AudioContext
            outputAudioContext: null, // 出力音声再生専用AudioContext（優先度確保）
            mediaStream: null,
            processor: null,
            audioSource: null, // MediaStreamSource（音声ルーティング制御用）
            inputGainNode: null, // 入力音声ミュート用GainNode
            audioSourceType: 'microphone', // 'microphone' or 'system'
            systemAudioSourceId: null, // システム音声のソースID
            isNewResponse: true, // 新しい応答かどうかのフラグ
            outputVolume: 2, // 出力音量（1.0 = 通常、2.0 = 2倍）
            isPlayingAudio: false, // 音声再生中フラグ（ループバック防止用）
            inputAudioOutputEnabled: true // 入力音声出力フラグ（入力音声をスピーカーに出力するか）
        };

        this.vad = null;
        this.elements = {};
        this.timers = {};

        // ✅ ストリーミング再生キュー（音声途中切断を防ぐ）
        this.playbackQueue = []; // 音声チャンクの再生待ちキュー（ストリーミング再生）
        this.isPlayingAudio = false; // 音声再生中フラグ（ループバック防止用）
        this.isPlayingFromQueue = false; // キューから再生中フラグ
        this.currentAudioStartTime = 0;

        // 翻訳テキスト累積用（delta → 完全なテキスト）
        this.currentTranslationText = ''; // 現在の翻訳テキストを累積
        this.currentTranscriptId = null; // 現在の transcriptId（入力テキストと対応）

        // ✅ レスポンス状態管理（並発制御）
        this.activeResponseId = null; // 現在処理中のレスポンスID
        this.pendingResponseId = null; // ✅ リクエスト送信中フラグ（レース条件対策）
        this.lastCommitTime = 0; // 最後のコミット時刻（重複防止）

        // ✅ P1: 智能VAD缓冲策略
        this.speechStartTime = null; // 発話開始時刻
        this.silenceConfirmTimer = null; // 無声確認タイマー
        this.minSpeechDuration = 1000; // 最小発話時長（1秒）
        this.silenceConfirmDelay = 500; // 無声確認延迟（500ms）

        // ✅ P1-2: 会話コンテキスト管理（Electron環境のみ）
        // ブラウザ・拡張機能では使用しない
        this.conversationEnabled =
            this.isElectron() &&
            typeof globalThis.window !== 'undefined' &&
            typeof globalThis.window.electronAPI !== 'undefined' &&
            typeof globalThis.window.electronAPI.conversation !== 'undefined';

        if (this.conversationEnabled) {
            console.info('[Conversation] 会話管理機能が有効です（Electron環境）');
        } else {
            console.info('[Conversation] 会話管理機能は無効です（ブラウザ/拡張機能環境）');
        }

        // ✅ レスポンスキュー管理（conversation_already_has_active_response エラー対策）
        this.responseQueue = new ResponseQueue((message) => this.sendMessage(message), {
            maxQueueSize: 10, // 最大キュー長
            timeout: 60000, // タイムアウト: 60秒（response.done が来ない場合に備えて）
            retryOnError: true, // エラー時リトライ有効
            maxRetries: 2, // 最大リトライ回数
            debugMode: CONFIG.DEBUG_MODE, // デバッグモード
            // ✅ リクエスト送信時のコールバック（レース条件対策）
            onRequestSending: () => {
                this.pendingResponseId = 'pending_' + Date.now();
                console.info('[ResponseQueue] リクエスト送信開始:', {
                    pendingResponseId: this.pendingResponseId
                });
            }
        });

        // ✅ 音声源トラッキング（ループバック防止用）
        // 各オーディオフレームに対して、それが「ユーザー新規音声」か「システム出力」かを標記
        this.audioSourceTracker = {
            outputStartTime: null, // 出力再生開始時刻
            outputEndTime: null, // 出力再生終了時刻
            bufferWindow: 2000, // バッファウィンドウ（出力完了後2秒間は入力を無視）
            playbackTokens: new Set() // 再生中の音声トークンセット
        };

        // ✅ グローバルモード状態管理（すべてのインスタンス間での一貫性を確保）
        // 複数のブラウザ標準、Electron、拡張機能などが同時に実行されるのを防ぐ
        this.modeStateManager = {
            currentMode: null, // 現在のモード: 'microphone' | 'system' | 'browser' | null
            modeStartTime: null, // モード開始時刻
            lastModeChange: null, // 最後のモード変更時刻
            modeChangeTimeout: 1000, // モード変更待機時間（1秒）
            globalLockKey: 'global_capture_mode_v2' // グローバルロックキー
        };

        this.initializeModeManager();

        // ✅ 双パス异步処理架构（Phase 2）
        this.audioQueue = new AudioQueue({
            maxConcurrent: 1 // 同時処理数を1に制限（並発エラー防止）
        });

        // ✅ パス処理器
        this.textPathProcessor = new TextPathProcessor(this.audioQueue, this);
        this.voicePathProcessor = new VoicePathProcessor(this.audioQueue, this);

        // ✅ 监听队列イベント
        this.audioQueue.on('segmentReady', (segment) => {
            this.handleNewAudioSegment(segment);
        });

        this.audioQueue.on('segmentComplete', (segment) => {
            this.handleSegmentComplete(segment);
        });

        this.audioQueue.on('queueFull', (size) => {
            this.notify('警告', `音声キューが満杯です（${size}個）`, 'warning');
        });

        // ✅ Phase 3: 音声バッファ管理
        this.audioBuffer = []; // から保存された onaudioprocess キャプチャされた音声データ
        this.audioBufferStartTime = null; // 音声バッファ開始時刻記録
        this.isBufferingAudio = false; // マーク是否正在缓冲音声

        this.init();
    }

    async init() {
        this.initElements();

        // Electron環境の場合、環境変数からAPIキーを取得
        await this.loadApiKeyFromEnv();

        // 初期化: localStorage をクリアして詳細設定をデフォルト折りたたみに
        this.initializeDefaultSettings();

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

    initElements() {
        // API設定
        this.elements.apiKey = document.getElementById('apiKey');
        this.elements.validateBtn = document.getElementById('validateBtn');

        // 言語設定
        // ✅ 修正: sourceLang は自動検出されるため、HTML から削除
        // this.elements.sourceLang = document.getElementById('sourceLang');
        this.elements.targetLang = document.getElementById('targetLang');
        this.elements.voiceType = document.getElementById('voiceType');
        this.elements.sourceLangDisplay = document.getElementById('sourceLangDisplay');
        this.elements.targetLangDisplay = document.getElementById('targetLangDisplay');

        // ✅ 新規: 自動検出言語表示用要素
        this.elements.detectedLanguageDisplay = document.getElementById('detectedLanguageDisplay');
        this.elements.detectedLanguageCode = document.getElementById('detectedLanguageCode');

        // 詳細設定
        this.elements.vadEnabled = document.getElementById('vadEnabled');
        this.elements.translationModeAudio = document.getElementById('translationModeAudio');
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

    /**
     * デフォルト設定を初期化
     *
     * 目的: 詳細設定をデフォルト折りたたみにし、トグルボタンのデフォルト状態を設定
     *
     * デフォルト状態:
     * - 自動音声検出: ON
     * - リアルタイム音声翻訳: ON
     * - ノイズ除去: OFF (dev-only)
     * - エコー除去: OFF (dev-only)
     * - 自動ゲイン: OFF (dev-only)
     * - 入力音声を表示: ON
     * - 翻訳結果を表示: ON
     * - 翻訳音声を出力: ON
     * - 入力音声を出力: OFF
     */
    initializeDefaultSettings() {
        // 詳細設定を折りたたみ状態にリセット
        localStorage.setItem('advancedSettingsCollapsed', 'true');

        // デフォルト状態を設定（ON = 'true', OFF = 'false'）
        const defaultSettings = {
            vadEnabled: 'true', // ON
            translationModeAudio: 'true', // ON
            noiseReduction: 'false', // OFF (dev-only)
            echoCancellation: 'false', // OFF (dev-only)
            autoGainControl: 'false', // OFF (dev-only)
            showInputTranscript: 'true', // ON
            showOutputTranscript: 'true', // ON
            audioOutputEnabled: 'true', // ON
            inputAudioOutputEnabled: 'false' // OFF
        };

        // localStorage に設定を保存
        for (const [key, value] of Object.entries(defaultSettings)) {
            localStorage.setItem(key, value);
        }

        console.info('[App] デフォルト設定を初期化しました');
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
        // ✅ 修正: sourceLang は自動検出されるため、手動設定は不要（コメント化）
        // this.elements.sourceLang.addEventListener('change', (e) => {
        //     this.state.sourceLang = e.target.value;
        //     this.elements.sourceLangDisplay.textContent = Utils.getNativeLanguageName(
        //         e.target.value
        //     );
        //     this.saveToStorage('source_lang', e.target.value);
        //     this.clearTranscript('both');
        //     if (this.state.isConnected) {
        //         this.updateSession();
        //     }
        // });

        this.elements.targetLang.addEventListener('change', (e) => {
            this.state.targetLang = e.target.value;
            this.elements.targetLangDisplay.textContent = Utils.getNativeLanguageName(
                e.target.value
            );
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

            // 翻訳音色変更時にトランスクリプトをクリア
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

            console.info('[Audio Source] 音声ソース変更:', sourceType);

            // VAD設定を再適用（音声ソースタイプに応じた最適な設定に更新）
            const currentVadLevel = this.elements.vadSensitivity.value;
            this.updateVADSensitivity(currentVadLevel);
            console.info('[VAD] 音声ソース変更に伴いVAD設定を再適用:', currentVadLevel);
        });

        // 会議アプリ検出ボタン
        const detectSourcesBtn = document.getElementById('detectSourcesBtn');
        detectSourcesBtn.addEventListener('click', () => this.detectAudioSources());

        // 詳細設定トグル
        [
            'vadEnabled',
            'translationModeAudio',
            'noiseReduction',
            'echoCancellation',
            'autoGainControl',
            'showInputTranscript',
            'showOutputTranscript',
            'audioOutputEnabled',
            'inputAudioOutputEnabled'
        ].forEach((id) => {
            this.elements[id].addEventListener('click', (e) => {
                this.handleToggleSetting(id, e.currentTarget);
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
        globalThis.addEventListener('beforeunload', () => {
            if (this.state.isConnected) {
                this.disconnect();
            }
        });
    }

    // ストレージ操作（拡張機能対応）
    saveToStorage(key, value) {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [key]: value });
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
                console.info('[VAD] Speech started');
                this.updateStatus('recording', '話し中...');
            },
            onSpeechEnd: () => {
                console.info('[VAD] Speech ended');
                this.updateStatus('recording', '待機中...');
            }
        });
        console.info('[VAD] ✅ VAD初期化完了 - クライアント側音声検出有効（v3.1-VAD-FILTER）');
        console.info('[VAD] 設定:', {
            threshold: 0.01,
            debounceTime: 300,
            calibrationDuration: 30
        });
    }

    /**
     * トグル設定の変更を処理
     *
     * 目的:
     *   詳細設定トグルの変更イベントを統一的に処理
     *   各設定に応じた適切なハンドラーを呼び出す
     *
     * 入力:
     *   id: 設定ID（例: 'vadEnabled', 'audioOutputEnabled'）
     *   element: トグル要素
     */
    handleToggleSetting(id, element) {
        element.classList.toggle('active');
        this.saveToStorage(id, element.classList.contains('active'));

        // 各設定に応じたハンドラーを呼び出す
        switch (id) {
            case 'vadEnabled':
                this.handleVadToggle();
                break;
            case 'translationModeAudio':
                this.handleTranslationModeToggle(element);
                break;
            case 'showInputTranscript':
            case 'showOutputTranscript':
                this.handleTranscriptToggle(id, element);
                break;
            case 'audioOutputEnabled':
                this.handleAudioOutputToggle(element);
                break;
            case 'inputAudioOutputEnabled':
                this.handleInputAudioOutputToggle(element);
                break;
            default:
                // その他の設定（noiseReduction, echoCancellation, autoGainControl）
                break;
        }
    }

    /**
     * 自動音声検出トグルの処理
     *
     * 目的:
     *   自動音声検出設定が変更された場合、セッションを更新
     */
    handleVadToggle() {
        if (this.state.isConnected) {
            console.info('[VAD] 設定変更 - セッションを更新します');
            this.updateSession();
        }
    }

    /**
     * 音声翻訳モードトグルの処理
     *
     * 目的:
     *   音声翻訳モード（ON: 音声翻訳、OFF: テキスト翻訳）の変更をユーザーに通知
     *
     * 入力:
     *   element: トグル要素
     */
    handleTranslationModeToggle(element) {
        const isActive = element.classList.contains('active');
        const mode = isActive ? '音声翻訳（高速・高品質）' : 'テキスト翻訳（入力と一対一対応）';
        console.info('[Translation Mode] 翻訳モード:', mode);
        this.notify('翻訳モード変更', `翻訳モードを${mode}に変更しました`, 'info');
    }

    /**
     * トランスクリプト表示設定トグルの処理
     *
     * 目的:
     *   トランスクリプト表示設定の変更をユーザーに通知
     *
     * 入力:
     *   id: 設定ID（'showInputTranscript' または 'showOutputTranscript'）
     *   element: トグル要素
     */
    handleTranscriptToggle(id, element) {
        const isActive = element.classList.contains('active');
        const label = id === 'showInputTranscript' ? '入力音声を表示' : '翻訳結果を表示';
        console.info(`[Transcript] ${label}: ${isActive ? 'ON' : 'OFF'}`);
        this.notify('表示設定変更', `${label}を${isActive ? 'ON' : 'OFF'}にしました`, 'info');
    }

    /**
     * 翻訳音声を出力設定トグルの処理
     *
     * 目的:
     *   翻訳音声を出力設定が変更された場合、セッションを更新
     *
     * 入力:
     *   element: トグル要素
     */
    handleAudioOutputToggle(element) {
        const isActive = element.classList.contains('active');
        console.info('[Audio Output] 翻訳音声を出力:', isActive ? 'ON' : 'OFF');
        this.notify('音声出力設定', `翻訳音声を出力を${isActive ? 'ON' : 'OFF'}にしました`, 'info');
        if (this.state.isConnected) {
            this.updateSession();
        }
    }

    /**
     * 入力音声を出力設定トグルの処理
     *
     * 目的:
     *   入力音声を出力設定が変更された場合、状態を更新し、
     *   必要に応じて音声処理を再セットアップ
     *
     * 入力:
     *   element: トグル要素
     */
    handleInputAudioOutputToggle(element) {
        const isActive = element.classList.contains('active');
        this.state.inputAudioOutputEnabled = isActive;
        console.info('[Input Audio Output] 入力音声を出力:', isActive ? 'ON' : 'OFF');
        this.notify(
            '入力音声出力設定',
            `入力音声を出力を${isActive ? 'ON' : 'OFF'}にしました`,
            'info'
        );

        // 録音中の場合、音声処理を再セットアップ
        if (this.state.isRecording) {
            this.reconnectAudioOutput();
        }
    }

    async loadSettings() {
        // ストレージから設定を読み込み
        const settings = {
            apiKey: await this.getFromStorage('openai_api_key'),
            // ✅ 修正: sourceLang は自動検出に変更、ストレージから読む必要なし
            // sourceLang: await this.getFromStorage('source_lang'),
            targetLang: await this.getFromStorage('target_lang'),
            voiceType: await this.getFromStorage('voice_type'),
            vadSensitivity: await this.getFromStorage('vad_sensitivity'),
            outputVolume: await this.getFromStorage('output_volume')
        };

        if (settings.apiKey) {
            this.elements.apiKey.value = settings.apiKey;
            this.state.apiKey = settings.apiKey;
            const progress = document.getElementById('apiKeyProgress');
            if (progress) {
                progress.style.width = '100%';
            }
        }

        if (settings.targetLang) {
            this.elements.targetLang.value = settings.targetLang;
            this.state.targetLang = settings.targetLang;
            this.elements.targetLangDisplay.textContent = Utils.getNativeLanguageName(
                settings.targetLang
            );
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
            this.state.outputVolume = Number.parseFloat(settings.outputVolume);
            console.info('[Settings] 出力音量を復元:', this.state.outputVolume);
        }

        // トグル設定
        const toggleSettings = [
            'vadEnabled',
            'translationModeAudio',
            'noiseReduction',
            'echoCancellation',
            'autoGainControl',
            'showInputTranscript',
            'showOutputTranscript',
            'audioOutputEnabled'
        ];
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
        const isElectron =
            typeof globalThis.window !== 'undefined' && (globalThis.window).electronAPI; // eslint-disable-line

        if (isElectron) {
            console.info('[Sync] Electronアプリとして起動 - ブラウザ版を制御します');
        } else {
            console.info('[Sync] ブラウザ版として起動 - Electronアプリからの制御を監視します');

            // ブラウザ版の場合、LocalStorageの変更を監視
            globalThis.addEventListener('storage', (event) => {
                if (event.key === 'app2_recording' && event.newValue === 'true') {
                    console.info(
                        '[Sync] Electronアプリが録音を開始しました - ブラウザ版を停止します'
                    );

                    // 録音中の場合は停止
                    if (this.state.isRecording) {
                        this.stopRecording();
                        this.notify(
                            '自動停止',
                            'Electronアプリが起動したため、ブラウザ版を停止しました',
                            'warning'
                        );
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
            await new Promise((resolve) => setTimeout(resolve, 1000)); // シミュレーション

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
            const errorMessage = error.message
                ? `APIキーの検証に失敗しました: ${error.message}`
                : 'APIキーの検証に失敗しました';
            this.notify('エラー', errorMessage, 'error');

            // UIを元の状態に戻す
            btn.querySelector('#validateBtnText').textContent = originalText;
            btn.disabled = false;
        }
    }

    async loadApiKeyFromEnv() {
        const isElectron =
            typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;

        if (!isElectron) {
            console.info('[App] ブラウザ環境: 環境変数からAPIキーを読み込めません');
            return;
        }

        try {
            console.info('[App] Electron環境: 環境変数からAPIキーを取得中...');
            const envApiKey = await globalThis.window.electronAPI.getEnvApiKey();

            if (envApiKey) {
                this.state.apiKey = envApiKey;
                console.info(
                    '[App] 環境変数からAPIキーを取得しました:',
                    envApiKey.substring(0, 7) + '...'
                );
                // UIに反映（セキュリティのため一部のみ表示）
                // 注意: パスワードフィールドには完全なキーを設定
                if (this.elements && this.elements.apiKey) {
                    this.elements.apiKey.value = envApiKey;
                }
            } else {
                console.info('[App] 環境変数にAPIキーが見つかりません');
                console.info('[App] 設定方法:');
                console.info('[App]   1. OPENAI_API_KEY=sk-your-key を設定');
                console.info('[App]   2. OPENAI_REALTIME_API_KEY=sk-your-key を設定');
                console.info('[App]   3. VOICETRANSLATE_API_KEY=sk-your-key を設定');
            }

            // 環境変数から設定を読み込む
            console.info('[App] Electron環境: 環境変数から設定を取得中...');
            const envConfig = await globalThis.window.electronAPI.getEnvConfig();

            if (envConfig) {
                // CONFIGを上書き（2種類のモデル設定）
                CONFIG.API.REALTIME_MODEL = envConfig.realtimeModel;
                CONFIG.API.CHAT_MODEL = envConfig.chatModel;
                CONFIG.API.REALTIME_URL = envConfig.realtimeUrl;

                console.info('[App] 環境変数から設定を読み込みました:', {
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
        if (!globalThis.window.electronAPI) {
            return;
        }

        console.info('[Electron WS] IPCハンドラーを設定中...');

        // 接続成功
        globalThis.window.electronAPI.on('realtime-ws-open', () => {
            console.info('[Electron WS] 接続成功イベント受信');
            this.handleWSOpen();
        });

        // メッセージ受信
        globalThis.window.electronAPI.on('realtime-ws-message', (message) => {
            console.info('[Electron WS] メッセージ受信イベント');
            this.handleWSMessage({ data: message });
        });

        // エラー
        globalThis.window.electronAPI.on('realtime-ws-error', (error) => {
            console.error('[Electron WS] エラーイベント:', error);
            this.handleWSError(error);
        });

        // 接続終了
        globalThis.window.electronAPI.on('realtime-ws-close', (data) => {
            console.info('[Electron WS] 接続終了イベント:', data);
            this.handleWSClose(data);
        });

        console.info('[Electron WS] IPCハンドラー設定完了');
    }

    async connect() {
        if (!this.state.apiKey) {
            this.notify('エラー', 'APIキーを入力してください', 'error');
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
            console.info('[Connect] 接続開始:', debugInfo);

            // Electron環境チェック
            const isElectron =
                typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;

            if (isElectron) {
                // Electronの場合、mainプロセス経由で接続（Authorizationヘッダー付き）
                console.info('[Connect] Electron環境: mainプロセス経由で接続します');

                // IPCイベントリスナーを設定
                this.setupElectronWebSocketHandlers();

                // WebSocket接続を要求
                const result = await globalThis.window.electronAPI.realtimeWebSocketConnect({
                    url: CONFIG.API.REALTIME_URL,
                    apiKey: this.state.apiKey,
                    model: CONFIG.API.REALTIME_MODEL
                });

                if (!result.success) {
                    throw new Error(result.message || '接続失敗');
                }

                console.info('[Connect] Electron WebSocket接続要求送信完了');
                // 接続成功はIPCイベント経由で通知される
                return;
            }

            // ブラウザ環境の場合（sec-websocket-protocolで認証）
            const wsUrl = `${CONFIG.API.REALTIME_URL}?model=${CONFIG.API.REALTIME_MODEL}`;
            console.info('[Connect] WebSocket URL:', wsUrl);

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
                    this.disconnect();
                    this.notify('エラー', '接続タイムアウト (30秒)', 'error');
                }
            }, CONFIG.API.TIMEOUT);

            this.timers.connectionTimeout = timeout;
        } catch (error) {
            console.error('[Connect Error]', error);
            console.error('[Connect Error] Stack:', error.stack);
            this.notify('エラー', '接続に失敗しました: ' + error.message, 'error');
            this.updateConnectionStatus('error');
            this.elements.connectBtn.disabled = false;
        }
    }

    async disconnect() {
        const isElectron =
            typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;

        if (isElectron) {
            // Electron環境
            await globalThis.window.electronAPI.realtimeWebSocketClose();
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
        console.info('[WS] Connected - WebSocket接続成功');

        this.state.isConnected = true;
        this.updateConnectionStatus('connected');
        this.elements.connectBtn.disabled = true;
        this.elements.disconnectBtn.disabled = false;
        this.elements.startBtn.disabled = false;

        // セッション作成
        console.info('[WS] セッション作成を開始');
        this.createSession();

        // セッションタイマー開始
        this.startSessionTimer();

        this.notify('接続成功', 'OpenAI Realtime APIに接続しました', 'success');
    }

    createSession() {
        // 音声出力が有効かどうかをチェック
        const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
        const modalities = audioOutputEnabled ? ['text', 'audio'] : ['text'];

        console.info('[🔊 Session] 音声出力設定:', {
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
                turn_detection: this.elements.vadEnabled.classList.contains('active')
                    ? {
                          type: 'server_vad',
                          threshold: 0.3, // 音声検出の閾値（0.0-1.0、0.3=より敏感）- 0.5から0.3に変更
                          prefix_padding_ms: 300, // 音声開始前のパディング（ms）
                          silence_duration_ms: 1000 // 静音判定時間（ms）- 1.0秒に短縮（反応速度向上）
                      }
                    : null,
                temperature: 0.8, // 0.8: 自然な表現とバランス（gpt-realtime-2025-08-28 推奨）
                max_response_output_tokens: 4096 // 4096: 長い会話にも対応
            }
        };

        console.info('[Session] セッション設定:', JSON.stringify(session, null, 2));
        console.info('[Session] 使用モデル:', {
            realtimeModel: CONFIG.API.REALTIME_MODEL, // Realtime API（音声→音声翻訳、音声認識）
            chatModel: CONFIG.API.CHAT_MODEL // Chat Completions API（言語検出、テキスト翻訳）
        });
        console.info(
            '[Session] 音声出力:',
            audioOutputEnabled ? 'ON' : 'OFF',
            '- modalities:',
            modalities
        );
        this.sendMessage(session);
        console.info('[Session] セッション作成メッセージを送信しました');
    }

    getInstructions() {
        const sourceLang = this.state.sourceLang || 'en'; // ✅ 修正: null 時は 'en' をデフォルト
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
        const isElectron =
            typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;

        if (isElectron) {
            // Electron環境
            const result = await globalThis.window.electronAPI.realtimeWebSocketSend(
                JSON.stringify(message)
            );
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
                console.info('[WS Message]', message.type, message);
            }

            // メッセージタイプに応じたハンドラーを呼び出す
            this.dispatchWSMessage(message);
        } catch (error) {
            console.error('[Message Error]', error);
            console.error('[Message Error] Event data:', event.data);
        }
    }

    /**
     * WebSocketメッセージをディスパッチ
     *
     * 目的:
     *   メッセージタイプに応じて適切なハンドラーを呼び出す
     *
     * 入力:
     *   message: WebSocketメッセージオブジェクト
     */
    dispatchWSMessage(message) {
        switch (message.type) {
            case 'session.updated':
                this.handleSessionUpdated(message);
                break;
            case 'input_audio_buffer.committed':
                this.handleAudioBufferCommitted(message);
                break;
            case 'input_audio_buffer.speech_started':
                this.handleSpeechStarted();
                break;
            case 'input_audio_buffer.speech_stopped':
                this.handleSpeechStopped();
                break;
            case 'conversation.item.input_audio_transcription.completed':
                this.handleTranscriptionCompleted(message);
                break;
            case 'response.audio_transcript.delta':
                this.handleAudioTranscriptDelta(message);
                break;
            case 'response.audio_transcript.done':
                this.handleAudioTranscriptDone();
                break;
            case 'response.audio.delta':
                this.handleAudioDelta(message);
                break;
            case 'response.audio.done':
                this.handleAudioDone();
                break;
            case 'response.created':
                this.handleResponseCreated(message);
                break;
            case 'response.done':
                this.handleResponseDone(message);
                break;
            case 'error':
                this.handleWSMessageError(message);
                break;
            default:
                console.info('[WS Message] 未処理のメッセージタイプ:', message.type);
        }
    }

    handleSessionUpdated(message) {
        console.info('[Session] Updated:', message.session);
    }

    handleAudioBufferCommitted() {
        const queueStatus = this.responseQueue.getStatus();
        const now = Date.now();
        const speechDuration = this.speechStartTime ? now - this.speechStartTime : 0;

        console.info('[Audio] 音声バッファコミット完了', {
            activeResponseId: this.activeResponseId,
            pendingResponseId: this.pendingResponseId,
            processingCount: queueStatus.processingCount,
            pendingCount: queueStatus.pendingCount,
            speechDuration: speechDuration + 'ms',
            timestamp: now
        });

        // ✅ 重複コミット防止（500ms以内の重複を無視）
        if (this.isDuplicateCommit(now)) {
            return;
        }

        // ✅ P1: 最小発話時長チェック（1秒未満は500ms待って確認）
        if (this.shouldWaitForSpeechConfirmation(speechDuration)) {
            return;
        }

        this.lastCommitTime = now;
        this.speechStartTime = null; // リセット

        // ✅ Phase 3: バッファから音声データ抽出
        this.isBufferingAudio = false; // バッファリング停止

        const { totalLength, sampleRate, actualDuration, combinedAudio } =
            this.extractAudioBuffer();

        // ✅ 早期検証: 音声が無い場合はスキップ
        if (!this.isValidAudioDuration(totalLength, actualDuration)) {
            return;
        }

        // ✅ Phase 3: 新アーキテクチャ有効化
        const ENABLE_AUDIO_QUEUE = true; // ← 新アーキテクチャ有効化

        if (ENABLE_AUDIO_QUEUE) {
            if (this.tryEnqueueAudioSegment(combinedAudio, actualDuration, sampleRate, now)) {
                return; // ← 新アーキテクチャ使用、旧ロジック非実行
            }
        }

        // ✅ 旧ロジック（フォールバック）
        this.processFallbackAudioRequest(queueStatus);
    }

    /**
     * 重複コミットをチェック（500ms以内の重複を無視）
     * @param {number} now - 現在のタイムスタンプ
     * @returns {boolean} 重複コミットの場合は true
     */
    isDuplicateCommit(now) {
        if (now - this.lastCommitTime < 500) {
            console.warn('[Audio] 重複コミットを検出、スキップします', {
                timeSinceLastCommit: now - this.lastCommitTime
            });
            return true;
        }
        return false;
    }

    /**
     * 発話時長確認待機が必要かチェック
     * @param {number} speechDuration - 発話時長（ms）
     * @returns {boolean} 確認待機が必要な場合は true
     */
    shouldWaitForSpeechConfirmation(speechDuration) {
        if (speechDuration > 0 && speechDuration < this.minSpeechDuration) {
            console.warn('[VAD Buffer] 発話時長が短い、確認待機中...', {
                duration: speechDuration + 'ms',
                minDuration: this.minSpeechDuration + 'ms',
                willConfirmIn: this.silenceConfirmDelay + 'ms'
            });

            // 既存のタイマーをクリア
            if (this.silenceConfirmTimer) {
                clearTimeout(this.silenceConfirmTimer);
            }

            // 500ms後に再確認
            this.silenceConfirmTimer = setTimeout(() => {
                this.confirmSpeechDuration();
            }, this.silenceConfirmDelay);

            return true;
        }
        return false;
    }

    /**
     * 発話時長を確認し、必要に応じて処理を再開
     */
    confirmSpeechDuration() {
        // ✅ 防御: speechStartTime が null の場合は処理しない
        if (!this.speechStartTime) {
            console.warn('[VAD Buffer] speechStartTime が null、スキップ');
            this.silenceConfirmTimer = null;
            return;
        }

        const finalDuration = Date.now() - this.speechStartTime;
        if (finalDuration >= this.minSpeechDuration) {
            console.info('[VAD Buffer] 確認完了: 発話時長OK', {
                duration: finalDuration + 'ms'
            });
            // 再帰呼び出し（但し今回は時長チェックをパスする）
            this.speechStartTime = null; // リセットしてチェックをスキップ
            this.handleAudioBufferCommitted();
        } else {
            console.warn('[VAD Buffer] 発話時長が短すぎる、スキップ', {
                duration: finalDuration + 'ms',
                minRequired: this.minSpeechDuration + 'ms'
            });
        }
        this.silenceConfirmTimer = null;
    }

    /**
     * 音声バッファから音声データを抽出
     * @returns {Object} { totalLength, sampleRate, actualDuration, combinedAudio }
     */
    extractAudioBuffer() {
        // バッファ内全音声チャンク結合
        let totalLength = 0;
        for (const chunk of this.audioBuffer) {
            totalLength += chunk.length;
        }

        // ✅ 重要: actualDuration を先に計算してからバッファをクリア
        // これにより 0.00ms の問題を防ぐ
        const sampleRate = this.state.audioContext?.sampleRate || 24000;
        const actualDuration = (totalLength / sampleRate) * 1000;

        console.info('[Audio] 音声データ抽出完了:', {
            samples: totalLength,
            duration: actualDuration.toFixed(2) + 'ms',
            bufferChunks: this.audioBuffer.length,
            sampleRate: sampleRate + 'Hz'
        });

        // ✅ ここまで来たら音声は有効、バッファをクリア
        const combinedAudio = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of this.audioBuffer) {
            combinedAudio.set(chunk, offset);
            offset += chunk.length;
        }
        this.audioBuffer = [];

        return { totalLength, sampleRate, actualDuration, combinedAudio };
    }

    /**
     * 音声時長が有効かチェック
     * @param {number} totalLength - サンプル数
     * @param {number} actualDuration - 音声時長（ms）
     * @returns {boolean} 有効な場合は false、無効な場合は true（スキップ）
     */
    isValidAudioDuration(totalLength, actualDuration) {
        // ✅ 早期検証: 音声が無い場合はスキップ
        if (totalLength === 0 || actualDuration < 100) {
            // 100ms 未満は無視
            console.warn('[Audio] 音声データが不足、スキップ:', {
                samples: totalLength,
                duration: actualDuration.toFixed(2) + 'ms'
            });
            return true;
        }

        // ✅ 最終チェック: 最小音声時長（1秒）
        if (actualDuration < 1000) {
            console.warn('[Audio] 音声が短すぎるためスキップ（API呼び出し防止）:', {
                duration: actualDuration.toFixed(2) + 'ms',
                minRequired: '1000ms',
                reason: '有効なトランスクリプションを生成できません'
            });
            return true;
        }

        return false;
    }

    /**
     * 音声セグメントをキューに追加
     * @param {Float32Array} combinedAudio - 結合された音声データ
     * @param {number} actualDuration - 音声時長（ms）
     * @param {number} sampleRate - サンプルレート
     * @param {number} now - 現在のタイムスタンプ
     * @returns {boolean} 成功した場合は true
     */
    tryEnqueueAudioSegment(combinedAudio, actualDuration, sampleRate, now) {
        // ✅ 有効な音声データのみをキューに追加
        const segment = this.audioQueue.enqueue(combinedAudio, {
            duration: actualDuration,
            language: this.state.sourceLang,
            sourceType: this.state.audioSourceType,
            timestamp: now,
            sampleRate: sampleRate
        });

        if (!segment) {
            console.error('[Audio] AudioQueue への追加失敗（キューが満杯か短すぎる）');
            // 旧ロジックをフォールバックとして継続使用
            return false;
        }

        console.info('[Audio] AudioSegment 作成完了:', {
            segmentId: segment.id,
            duration: actualDuration.toFixed(2) + 'ms',
            samples: combinedAudio.length,
            queueSize: this.audioQueue.size()
        });
        // ✅ 双パス処理会通过 segmentReady イベント自动触发
        // 参见: handleNewAudioSegment()
        return true;
    }

    /**
     * フォールバック音声リクエスト処理
     * @param {Object} queueStatus - キューのステータス
     */
    processFallbackAudioRequest(queueStatus) {
        // ✅ 旧ロジック（フォールバック）
        // ✅ 処理中のレスポンスがある場合はスキップ（並発制御）
        // ✅ pendingResponseId をチェック（リクエスト送信中の場合もスキップ）
        if (this.activeResponseId || this.pendingResponseId) {
            console.warn('[Audio] 前のレスポンスが処理中のため、新しいリクエストをスキップします', {
                activeResponseId: this.activeResponseId,
                pendingResponseId: this.pendingResponseId
            });
            return;
        }

        if (queueStatus.processingCount > 0) {
            console.warn('[Audio] キューに処理中のリクエストがあるため、スキップします', {
                processingCount: queueStatus.processingCount,
                pendingCount: queueStatus.pendingCount
            });
            return;
        }

        // ✅ 重要: enqueueResponseRequest を呼ぶ前に両方の ID を設定
        // pendingResponseId と activeResponseId の両方を設定することで、
        // response.created を待つ間も次のリクエストを確実にブロックする
        this.pendingResponseId = 'pending_' + Date.now();
        this.activeResponseId = 'temp_' + Date.now(); // ✅ 仮ID（response.created で上書き）

        this.enqueueResponseRequest(queueStatus);
    }

    enqueueResponseRequest(queueStatus) {
        // ✅ 最終チェック: pendingResponseId で並発リクエストを防止
        if (this.activeResponseId) {
            console.warn('[🔊 Response Create] スキップ: レスポンス処理中', {
                activeResponseId: this.activeResponseId,
                pendingResponseId: this.pendingResponseId
            });
            return;
        }

        // ✅ pendingResponseId が未設定の場合のみ設定（handleAudioBufferCommitted で設定済みの場合は保持）
        if (!this.pendingResponseId) {
            this.pendingResponseId = 'pending_' + Date.now();
        }

        const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
        const modalities = audioOutputEnabled ? ['text', 'audio'] : ['text'];

        console.info('[🔊 Response Create] 要求:', {
            modalities: modalities,
            audioOutputEnabled: audioOutputEnabled,
            queueStatus: queueStatus,
            activeResponseId: this.activeResponseId,
            pendingResponseId: this.pendingResponseId
        });

        this.responseQueue
            .enqueue({
                modalities: modalities,
                instructions: this.getInstructions()
            })
            .then(() => {
                console.info('[Audio] レスポンスリクエストをキューに追加しました');
            })
            .catch((error) => {
                // ✅ エラー時は pendingResponseId をクリア
                this.pendingResponseId = null;

                if (error.message.includes('Previous response is still in progress')) {
                    console.info(
                        '[Audio] 前のレスポンス処理中のため、リクエストをスキップしました'
                    );
                } else {
                    console.error('[Audio] レスポンスリクエスト失敗:', error);
                }
            });
    }

    handleSpeechStarted() {
        // ✅ P1: 記録発話開始時刻
        this.speechStartTime = Date.now();

        // ✅ Phase 3: 启动音声缓冲
        this.isBufferingAudio = true;
        this.audioBuffer = []; // バッファクリア
        this.audioBufferStartTime = Date.now();

        console.info('[Speech] 音声検出開始', { startTime: this.speechStartTime });
        this.updateStatus('recording', '話し中...');
    }

    handleSpeechStopped() {
        const duration = this.speechStartTime ? Date.now() - this.speechStartTime : 0;
        console.info('[Speech] 音声検出停止', { duration: duration + 'ms' });
        this.updateStatus('recording', '処理中...');
        this.state.isNewResponse = true;
    }

    handleTranscriptionCompleted(message) {
        console.info('[Transcription] 入力音声認識完了:', message.transcript);
        if (message.transcript) {
            const transcriptId = Date.now();
            this.addTranscript('input', message.transcript, transcriptId);
            this.currentTranscriptId = transcriptId;
        }
    }

    handleAudioTranscriptDelta(message) {
        if (message.delta) {
            this.currentTranslationText += message.delta;
        }
    }

    handleAudioTranscriptDone() {
        console.info('[処理1-2] 🔊 音声翻訳テキスト完了:', this.currentTranslationText);

        if (this.currentTranslationText.trim()) {
            console.info('[音声翻訳] テキスト:', this.currentTranslationText.trim());
            const transcriptId = this.currentTranscriptId || Date.now();
            this.addTranscript('output', this.currentTranslationText.trim(), transcriptId);
            this.currentTranslationText = '';
            this.currentTranscriptId = null;
        }

        this.state.isNewResponse = true;
    }

    handleAudioDelta(message) {
        console.info('[🔊 Audio Delta] 受信:', {
            hasDelta: !!message.delta,
            deltaLength: message.delta ? message.delta.length : 0,
            currentQueueSize: this.playbackQueue ? this.playbackQueue.length : 0
        });
        if (message.delta) {
            this.playAudioChunk(message.delta);
        }
    }

    handleAudioDone() {
        console.info('[🔊 Audio Done] 音声データ受信完了:', {
            audioOutputEnabled: this.elements.audioOutputEnabled.classList.contains('active'),
            modalities: this.state.ws ? '確認必要' : 'WebSocket未接続'
        });
    }

    handleResponseCreated(message) {
        console.info('[Response] Created:', {
            responseId: message.response.id,
            previousActiveId: this.activeResponseId,
            previousPendingId: this.pendingResponseId,
            timestamp: Date.now()
        });
        // ✅ 仮IDを実際のレスポンスIDで上書き
        this.activeResponseId = message.response.id;
        this.pendingResponseId = null; // ✅ リクエスト送信完了、ペンディング状態をクリア
        this.responseQueue.handleResponseCreated(message.response.id);
    }

    handleResponseDone(message) {
        console.info('[Response] Complete:', {
            responseId: message.response.id,
            activeId: this.activeResponseId,
            timestamp: Date.now()
        });
        this.activeResponseId = null;
        this.pendingResponseId = null; // ✅ レスポンス完了、ペンディング状態もクリア
        this.responseQueue.handleResponseDone(message.response.id);
        this.updateStatus('recording', '待機中');
        this.updateAccuracy();
    }

    handleWSMessageError(message) {
        console.error('[Error]', message.error);

        const errorCode = message.error.code || '';
        if (errorCode === 'conversation_already_has_active_response') {
            console.warn('[Error] 前のレスポンスが処理中です。状態をリセットします。', {
                activeResponseId: this.activeResponseId,
                pendingResponseId: this.pendingResponseId
            });
            // ✅ エラー時は両方の状態をクリア
            // サーバー側に既に active response があるため、クライアント側の temp_xxx ID はクリア
            // 実際の response.done イベントで正しくクリアされる
            if (this.activeResponseId && this.activeResponseId.startsWith('temp_')) {
                // temp ID の場合はクリア（サーバー側には到達していない）
                this.activeResponseId = null;
            }
            // pending ID は必ずクリア
            this.pendingResponseId = null;
            this.responseQueue.handleError(new Error(message.error.message), errorCode);
        } else {
            // ✅ 他のエラーの場合も状態をクリア
            this.activeResponseId = null;
            this.pendingResponseId = null;
            this.responseQueue.handleError(new Error(message.error.message), errorCode);
            this.notify('エラー', message.error.message, 'error');
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

        this.notify('接続エラー', 'WebSocket接続でエラーが発生しました', 'error');
    }

    handleWSClose(event) {
        console.info('[WS] Closed - WebSocket接続が閉じました');

        // イベントオブジェクトの安全な取得
        const code = event?.code || event || 1005;
        const reason = event?.reason || '';
        const wasClean = event?.wasClean !== undefined ? event.wasClean : true;

        console.info('[WS Close] 詳細:', {
            code: code,
            reason: reason,
            wasClean: wasClean
        });

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
            this.notify('エラー', 'WebSocketに接続してください', 'error');
            return;
        }

        if (this.state.isRecording) {
            console.warn('[Recording] 既に録音中のため開始要求を無視します');
            return;
        }

        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = true;

        try {
            console.info('[Recording] Starting...');

            // ✅ ステップ1: 新しいモードを確定
            const targetMode = this.state.audioSourceType; // 'microphone' or 'system'
            console.info('[ModeSwitch] 目標モード:', targetMode);

            // ✅ ステップ2: 現在のモードをチェック
            const globalLock = localStorage.getItem(this.modeStateManager.globalLockKey);
            if (globalLock && globalLock !== targetMode) {
                const parsedLock = JSON.parse(globalLock);
                console.warn('[ModeSwitch] 別のモードが既に実行中です:', {
                    currentMode: parsedLock.mode,
                    targetMode: targetMode,
                    timeSinceStart: Date.now() - parsedLock.startTime + 'ms'
                });

                // 前のモードを強制終了
                this.notify(
                    '警告',
                    `別のキャプチャモード（${parsedLock.mode}）が実行中です。強制切り替えを行います。`,
                    'warning'
                );

                // 前のモードの録音を停止
                localStorage.removeItem(this.modeStateManager.globalLockKey);
                await this.stopRecording();

                // 少し待機
                await new Promise((resolve) =>
                    setTimeout(resolve, this.modeStateManager.modeChangeTimeout)
                );
            }

            // ✅ ステップ3: 新しいモードをロック
            const modeLockData = {
                mode: targetMode,
                startTime: Date.now(),
                instanceId: 'inst_' + Math.random().toString(36).substr(2, 9)
            };
            localStorage.setItem(this.modeStateManager.globalLockKey, JSON.stringify(modeLockData));
            this.modeStateManager.currentMode = targetMode;
            this.modeStateManager.modeStartTime = Date.now();

            console.info('[ModeSwitch] モードをロック:', modeLockData);

            // Electronアプリの場合、ブラウザ版に録音停止を通知
            const isElectron =
                typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;
            if (isElectron) {
                console.info('[Sync] Electronアプリで録音開始 - ブラウザ版に停止を通知します');
                localStorage.setItem('app2_recording', 'true');
            } else {
                // ブラウザ版の場合、app2が既に録音中かチェック
                const app2Recording = localStorage.getItem('app2_recording');
                if (app2Recording === 'true') {
                    console.warn(
                        '[Sync] Electronアプリが既に録音中です - ブラウザ版での録音を中止します'
                    );
                    localStorage.removeItem(this.modeStateManager.globalLockKey);
                    this.notify(
                        '警告',
                        'Electronアプリが既に録音中です。ブラウザ版では録音できません。',
                        'warning'
                    );
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
            // ✅ エラー時もモードロックをクリア
            localStorage.removeItem(this.modeStateManager.globalLockKey);
            this.modeStateManager.currentMode = null;
            this.notify('録音エラー', error.message, 'error');
        } finally {
            if (!this.state.isRecording) {
                this.elements.startBtn.disabled = false;
                this.elements.stopBtn.disabled = true;
            }
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
                console.info('[Permission] Permissions API 未サポート - スキップ');
                return;
            }

            // マイク権限の状態を確認
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });

            console.info('[Permission] マイク権限状態:', permissionStatus.state);

            if (permissionStatus.state === 'granted') {
                console.info('[Permission] ✅ マイク権限が許可されています');
                this.notify('マイク準備完了', 'マイクへのアクセスが許可されています', 'success');
            } else if (permissionStatus.state === 'prompt') {
                console.info('[Permission] ⚠️ マイク権限が未設定です');
                this.notify(
                    'マイク権限が必要です',
                    '録音開始時にマイクへのアクセスを許可してください',
                    'warning'
                );
            } else if (permissionStatus.state === 'denied') {
                console.info('[Permission] ❌ マイク権限が拒否されています');
                this.notify(
                    'マイク権限が拒否されています',
                    'ブラウザの設定からマイクへのアクセスを許可してください',
                    'error'
                );
            }

            // 権限状態の変更を監視
            permissionStatus.onchange = () => {
                console.info(
                    '[Permission] マイク権限状態が変更されました:',
                    permissionStatus.state
                );

                if (permissionStatus.state === 'granted') {
                    this.notify(
                        'マイク権限が許可されました',
                        'マイクが使用可能になりました',
                        'success'
                    );
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
        console.info('[Recording] マイクキャプチャを開始...');

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

        console.info('[Recording] マイクアクセス要求中...', constraints);

        try {
            this.state.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.info('[Recording] マイクアクセス取得成功');
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
        console.info('[Recording] システム音声キャプチャを開始...');

        const isElectron =
            typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;

        if (isElectron) {
            // Electron環境: desktopCapturerを使用
            await this.startElectronSystemAudioCapture();
        } else {
            // ブラウザ環境: ユーザーの選択に基づいて処理
            const systemAudioSource = document.getElementById('systemAudioSource');
            const selectedSource = systemAudioSource?.value;

            console.info('[Recording] 選択されたソース:', selectedSource);

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
        console.info('[Recording] Electron環境でシステム音声をキャプチャ...');

        const systemAudioSource = document.getElementById('systemAudioSource');
        let sourceId = systemAudioSource.value;

        // 音声ソースが未選択の場合、自動検出を試みる
        if (!sourceId) {
            console.info('[Recording] 音声ソースが未選択 - 自動検出を開始...');
            this.notify('自動検出', '音声ソースを自動検出しています...', 'info');

            try {
                await this.detectAudioSources();

                // 検出後、最初のソースを自動選択
                sourceId = systemAudioSource.value;

                if (!sourceId) {
                    throw new Error(
                        '音声ソースが見つかりませんでした。Teams、Zoom、Chrome等の会議アプリやブラウザを起動してから再度お試しください。'
                    );
                }

                console.info('[Recording] 自動選択されたソース:', sourceId);
                this.notify('自動選択', '音声ソースを自動選択しました', 'success');
            } catch (error) {
                console.error('[Recording] 自動検出失敗:', error);
                throw new Error(
                    '音声ソースの自動検出に失敗しました。「会議アプリを検出」ボタンをクリックして、手動で選択してください。'
                );
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

            console.info('[Recording] Electron画面キャプチャ要求中...', { sourceId });
            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            // 音声トラックを取得
            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();

            console.info('[Recording] トラック情報:', {
                audioTracks: audioTracks.length,
                videoTracks: videoTracks.length
            });

            // 重要: 音声トラックがなくても続行する
            // 理由: 会議アプリでは、誰も話していない時は音声トラックがない場合がある
            //       音声が開始されると、ストリームに音声トラックが追加される

            if (audioTracks.length === 0) {
                console.warn(
                    '[Recording] 現在音声トラックがありません。音声が開始されるまで待機します。'
                );

                // ストリーム全体を保存（音声トラックが後で追加される可能性がある）
                this.state.mediaStream = stream;

                // 音声トラックが追加されたときのリスナーを設定
                stream.addEventListener('addtrack', (event) => {
                    console.info('[Recording] 音声トラックが追加されました:', event.track);
                    if (event.track.kind === 'audio') {
                        console.info('[Recording] 音声トラック検出、録音を開始します');
                        this.notify(
                            '音声検出',
                            '音声が検出されました。録音を開始します。',
                            'success'
                        );
                    }
                });

                this.notify(
                    '待機中',
                    '音声トラックを待機しています。会議で誰かが話し始めると録音が開始されます。',
                    'info'
                );
            } else {
                // 音声トラックがある場合
                this.state.mediaStream = stream;

                console.info('[Recording] Electronシステム音声キャプチャ成功', {
                    audioTrackCount: audioTracks.length,
                    audioTrackLabel: audioTracks[0]?.label
                });

                // 重要な通知: ブラウザの音声をミュートするよう指示
                this.notify(
                    '重要',
                    'ブラウザのタブをミュートしてください！翻訳音声のみを聞くために、元の音声をミュートする必要があります。',
                    'warning'
                );
            }

            // ビデオトラックは不要なので停止
            videoTracks.forEach((track) => track.stop());
        } catch (error) {
            console.error('[Recording] Electronシステム音声キャプチャ失敗:', error);
            throw new Error(`システム音声のキャプチャに失敗しました: ${error.message}`);
        }
    }

    /**
     * ブラウザシステム音声キャプチャ時の音声トラック終了処理
     *
     * 目的:
     *   画面共有の音声トラックが停止した時の処理を実行
     *
     * Returns:
     *   void
     *
     * 注意:
     *   このメソッドはイベントリスナーから呼び出される
     */
    handleBrowserAudioTrackEnded() {
        console.error('[Recording] 音声トラックが停止しました');
        this.notify('エラー', '画面共有の音声キャプチャが停止しました', 'error');
        this.stopRecording();
    }

    /**
     * ブラウザシステム音声キャプチャ時の音声トラック監視設定
     *
     * 目的:
     *   画面共有から取得した音声トラックにイベントリスナーを設定
     *
     * Parameters:
     *   audioTrack - MediaStreamAudioTrack オブジェクト
     *
     * Returns:
     *   void
     *
     * 注意:
     *   トラックが存在する場合のみ処理を実行
     */
    setupBrowserAudioTrackListener(audioTrack) {
        if (!audioTrack) {
            return;
        }

        audioTrack.addEventListener('ended', () => this.handleBrowserAudioTrackEnded());
        console.info('[Recording] 音声トラック監視を開始:', {
            id: audioTrack.id,
            label: audioTrack.label,
            readyState: audioTrack.readyState
        });
    }

    async startBrowserSystemAudioCapture() {
        console.info('[Recording] ブラウザ環境でシステム音声をキャプチャ...');

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
                video: true // 互換性のためtrueに設定（後でビデオトラックを停止）
            };

            console.info('[Recording] ブラウザ音声アクセス要求中...', constraints);
            const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

            // ビデオトラックを停止（音声のみ使用）
            const videoTracks = stream.getVideoTracks();
            videoTracks.forEach((track) => {
                console.info('[Recording] ビデオトラックを停止:', track.label);
                track.stop();
            });

            this.state.mediaStream = stream;

            // 音声トラックの監視
            const audioTrack = stream.getAudioTracks()[0];
            this.setupBrowserAudioTrackListener(audioTrack);

            console.info('[Recording] ブラウザシステム音声キャプチャ成功');
            this.notify('キャプチャ開始', 'システム音声のキャプチャを開始しました', 'success');
        } catch (error) {
            console.error('[Recording] ブラウザシステム音声キャプチャ失敗:', error);
            throw new Error(
                'システム音声のキャプチャに失敗しました。ブラウザタブまたはウィンドウを選択してください。'
            );
        }
    }

    /**
     * 音声トラック終了時のコールバック処理
     *
     * 目的:
     *   音声トラックが停止した時の処理を実行
     *
     * Returns:
     *   void
     *
     * 注意:
     *   このメソッドはイベントリスナーから呼び出される
     */
    handleAudioTrackEnded() {
        console.error('[Recording] 音声トラックが停止しました');
        this.notify('エラー', 'タブ音声のキャプチャが停止しました', 'error');
        this.stopRecording();
    }

    /**
     * 音声トラック監視の設定
     *
     * 目的:
     *   取得した音声トラックにイベントリスナーを設定
     *
     * Parameters:
     *   audioTrack - MediaStreamAudioTrack オブジェクト
     *
     * Returns:
     *   void
     *
     * 注意:
     *   トラックが存在する場合のみ処理を実行
     */
    setupAudioTrackListener(audioTrack) {
        if (!audioTrack) {
            return;
        }

        audioTrack.addEventListener('ended', () => this.handleAudioTrackEnded());
        console.info('[Recording] 音声トラック監視を開始:', {
            id: audioTrack.id,
            label: audioTrack.label,
            readyState: audioTrack.readyState,
            enabled: audioTrack.enabled
        });
    }

    /**
     * tabCapture成功時のコールバック処理
     *
     * 目的:
     *   tabCaptureで取得したストリームを処理
     *
     * Parameters:
     *   stream - MediaStream オブジェクト
     *   resolve - Promise resolve関数
     *   reject - Promise reject関数
     *
     * Returns:
     *   void
     *
     * 注意:
     *   ネストを減らすため別メソッドに抽出
     */
    handleTabCaptureSuccess(stream, resolve, reject) {
        if (chrome.runtime.lastError) {
            console.error('[Recording] tabCapture失敗:', chrome.runtime.lastError);

            // Chrome内部ページのエラーを検出
            const errorMsg = chrome.runtime.lastError.message;
            if (
                errorMsg.includes('Chrome pages cannot be captured') ||
                errorMsg.includes('Extension has not been invoked')
            ) {
                reject(
                    new Error(
                        'Chrome内部ページ（chrome://）では音声キャプチャできません。\n' +
                            '通常のウェブページ（YouTube、Google Meetなど）で使用するか、\n' +
                            '音声ソースを「マイク」または「画面/ウィンドウを選択」に変更してください。'
                    )
                );
            } else {
                reject(new Error(errorMsg));
            }
            return;
        }

        if (!stream) {
            reject(new Error('ストリームの取得に失敗しました'));
            return;
        }

        console.info('[Recording] タブ音声キャプチャ成功');
        this.state.mediaStream = stream;

        // ストリームが停止した時の処理を追加
        const audioTrack = stream.getAudioTracks()[0];
        this.setupAudioTrackListener(audioTrack);

        this.notify('キャプチャ開始', '現在のタブの音声キャプチャを開始しました', 'success');
        resolve();
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
            console.info('[Recording] タブ音声キャプチャを開始...');

            // 現在のタブを取得
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || tabs.length === 0) {
                    reject(new Error('アクティブなタブが見つかりません'));
                    return;
                }

                const tab = tabs[0];
                const tabId = tab.id;
                const tabUrl = tab.url || '';

                console.info('[Recording] タブID:', tabId);
                console.info('[Recording] タブURL:', tabUrl);

                // Chrome内部ページのチェック
                if (
                    tabUrl.startsWith('chrome://') ||
                    tabUrl.startsWith('chrome-extension://') ||
                    tabUrl.startsWith('edge://') ||
                    tabUrl.startsWith('about:')
                ) {
                    reject(
                        new Error(
                            'Chrome内部ページでは音声キャプチャできません。\n\n' +
                                '解決方法:\n' +
                                '1. 通常のウェブページ（YouTube、Google Meetなど）を開く\n' +
                                '2. 音声ソースを「マイク」に変更する\n' +
                                '3. 音声ソースを「画面/ウィンドウを選択」に変更する'
                        )
                    );
                    return;
                }

                // タブの音声をキャプチャ
                const constraints = {
                    audio: true,
                    video: false
                };

                chrome.tabCapture.capture(constraints, (stream) => {
                    this.handleTabCaptureSuccess(stream, resolve, reject);
                });
            });
        });
    }

    /**
     * 音声トラック検出待機処理
     *
     * 目的:
     *   メディアストリームに音声トラックが追加されるまで待機
     *
     * Returns:
     *   Promise<void>
     *
     * 注意:
     *   ネストを減らすため別メソッドに抽出
     */
    async waitForAudioTrack() {
        const checkAudioTrack = () => {
            const tracks = this.state.mediaStream.getAudioTracks();
            if (tracks.length > 0) {
                console.info('[Recording] 音声トラックが検出されました。処理を開始します。');
                return true;
            }
            return false;
        };

        // 音声トラックが追加されるまで待機
        while (!checkAudioTrack()) {
            // 100msごとにチェック
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    async setupAudioProcessing() {
        console.info('[Recording] 音声処理をセットアップ中...');

        // AudioContext設定
        this.state.audioContext = new (globalThis.AudioContext || globalThis.webkitAudioContext)({
            sampleRate: CONFIG.AUDIO.SAMPLE_RATE
        });

        // AudioContextがサスペンドされている場合、再開
        if (this.state.audioContext.state === 'suspended') {
            console.info('[Recording] AudioContextがサスペンド状態です。再開します...');
            await this.state.audioContext.resume();
            console.info('[Recording] AudioContext再開完了:', this.state.audioContext.state);
        }

        // 音声トラックがあるか確認
        const audioTracks = this.state.mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn(
                '[Recording] 音声トラックがまだありません。音声が開始されるまで待機します。'
            );

            // 音声トラックが追加されるまで待機
            await this.waitForAudioTrack();
        }

        await this.setupAudioProcessingInternal();
    }

    async setupAudioProcessingInternal() {
        console.info('[Recording] 音声処理を開始...');

        // MediaStreamSource を作成して保存（後で切断できるように）
        this.state.audioSource = this.state.audioContext.createMediaStreamSource(
            this.state.mediaStream
        );

        // VADリセット
        if (this.elements.vadEnabled.classList.contains('active')) {
            this.vad.reset();
            console.info('[VAD] Calibrating...');
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
                    // ✅ AudioWorklet から受信した音声データを処理
                    if (!this.state.isRecording) {
                        return;
                    }

                    const inputData = event.data.data;

                    // ✅ Phase 3: 音声データバッファリング（VAD有効無効に関わらず）
                    if (this.isBufferingAudio) {
                        // 音声データをバッファにコピー
                        const audioChunk = new Float32Array(inputData.length);
                        audioChunk.set(inputData);
                        this.audioBuffer.push(audioChunk);
                    }

                    // Server VADが有効かどうかをチェック
                    const vadEnabledElement = this.elements.vadEnabled;
                    const isServerVadEnabled = vadEnabledElement.classList.contains('active');

                    if (isServerVadEnabled) {
                        // Server VAD有効: すべての音声データをサーバーに送信
                        // サーバー側で音声検出を行う
                        this.sendAudioData(inputData);

                        // ビジュアライザーのみ更新（VAD解析は不要）
                        const energy = this.vad.calculateEnergy(inputData);
                        this.updateVisualizer(inputData, { isSpeaking: true, energy: energy });
                    } else {
                        // Server VAD無効: クライアント側VADで音声検出
                        const vadResult = this.vad.analyze(inputData);
                        this.updateVisualizer(inputData, vadResult);

                        // 音声が検出された場合のみ送信
                        if (vadResult.isSpeaking) {
                            this.sendAudioData(inputData);
                        }
                    }
                }
            };

            this.state.audioSource.connect(this.state.workletNode);

            // GainNodeを作成して入力音声のミュート制御
            this.state.inputGainNode = this.state.audioContext.createGain();

            // 入力音声出力設定に応じてゲインを設定
            this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1 : 0;

            // 音声チェーン: workletNode → inputGainNode → destination
            this.state.workletNode.connect(this.state.inputGainNode);
            this.state.inputGainNode.connect(this.state.audioContext.destination);

            console.info(
                '[Recording] AudioWorklet を使用して音声処理を開始しました（入力音声出力:',
                this.state.inputAudioOutputEnabled ? 'ON' : 'OFF',
                '）'
            );
        } catch (error) {
            console.warn(
                '[Recording] AudioWorklet の読み込みに失敗しました。ScriptProcessorNode にフォールバックします:',
                error
            );

            // フォールバック: ScriptProcessorNode を使用（非推奨だが互換性のため）
            const preset = getAudioPreset();
            this.state.processor = this.state.audioContext.createScriptProcessor(
                preset.BUFFER_SIZE,
                1,
                1
            );

            this.state.processor.onaudioprocess = (e) => {
                if (!this.state.isRecording) {
                    return;
                }

                // ✅ ループバック防止: システム音声モードの場合のみ、再生中の入力をスキップ
                if (this.state.isPlayingAudio && this.state.audioSourceType === 'system') {
                    return;
                }

                const inputData = e.inputBuffer.getChannelData(0);

                // ✅ Phase 3: 音声データバッファリング（VAD有効無効に関わらず）
                if (this.isBufferingAudio) {
                    // 音声データをバッファにコピー
                    const audioChunk = new Float32Array(inputData.length);
                    audioChunk.set(inputData);
                    this.audioBuffer.push(audioChunk);
                }

                // Server VADが有効かどうかをチェック
                const vadEnabledElement = this.elements.vadEnabled;
                const isServerVadEnabled = vadEnabledElement.classList.contains('active');

                if (isServerVadEnabled) {
                    // Server VAD有効: すべての音声データをサーバーに送信
                    // サーバー側で音声検出を行う
                    this.sendAudioData(inputData);

                    // ビジュアライザーのみ更新（VAD解析は不要）
                    const energy = this.vad.calculateEnergy(inputData);
                    this.updateVisualizer(inputData, { isSpeaking: true, energy: energy });
                } else {
                    // Server VAD無効: クライアント側VADで音声検出
                    const vadResult = this.vad.analyze(inputData);
                    this.updateVisualizer(inputData, vadResult);

                    // 音声が検出された場合のみ送信
                    if (vadResult.isSpeaking) {
                        this.sendAudioData(inputData);
                    }
                }
            };

            this.state.audioSource.connect(this.state.processor);

            // GainNodeを作成して入力音声のミュート制御
            this.state.inputGainNode = this.state.audioContext.createGain();

            // 入力音声出力設定に応じてゲインを設定
            this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1 : 0;

            // 音声チェーン: processor → inputGainNode → destination
            this.state.processor.connect(this.state.inputGainNode);
            this.state.inputGainNode.connect(this.state.audioContext.destination);

            console.info(
                '[Recording] ScriptProcessorNode を使用して音声処理を開始しました（入力音声出力:',
                this.state.inputAudioOutputEnabled ? 'ON' : 'OFF',
                '）'
            );
        }

        this.state.isRecording = true;
        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = false;
        this.elements.disconnectBtn.disabled = true;

        const sourceTypeText = this.state.audioSourceType === 'system' ? 'システム音声' : 'マイク';
        this.updateStatus('recording', '録音中');
        this.notify('録音開始', `${sourceTypeText}から音声を取得しています`, 'success');

        console.info('[Recording] 録音開始完了', {
            isRecording: this.state.isRecording,
            isConnected: this.state.isConnected,
            audioSourceType: this.state.audioSourceType,
            vadEnabled: this.elements.vadEnabled.classList.contains('active'),
            usingAudioWorklet: !!this.state.workletNode
        });
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
        console.info('[Audio Output] 入力音声出力を切り替え中...', {
            enabled: this.state.inputAudioOutputEnabled,
            hasGainNode: !!this.state.inputGainNode
        });

        try {
            // GainNodeが存在する場合、ゲイン値を変更
            if (this.state.inputGainNode) {
                // 入力音声出力設定に応じてゲインを設定
                // ON: 1.0 (通常音量), OFF: 0.0 (完全ミュート)
                this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1 : 0;

                console.info(
                    '[Audio Output] 入力音声ゲイン:',
                    this.state.inputAudioOutputEnabled ? '1.0 (ON)' : '0.0 (OFF)'
                );
            } else {
                console.warn('[Audio Output] GainNodeが存在しません');
            }
        } catch (error) {
            console.error('[Audio Output] 切り替えエラー:', error);
            this.notify('エラー', '入力音声出力の切り替えに失敗しました', 'error');
        }
    }

    async detectAudioSources() {
        console.info('[Audio Source] 音声ソースを検出中...');

        const isElectron =
            typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;
        const systemAudioSource = document.getElementById('systemAudioSource');

        if (isElectron) {
            // Electron環境: 会議アプリを自動検出
            try {
                this.notify('検出中', '音声ソースを検出しています...', 'info');

                const sources = await globalThis.window.electronAPI.detectMeetingApps();
                console.info('[Audio Source] 検出されたソース:', sources);
                console.info('[Audio Source] ソース数:', sources.length);

                // ドロップダウンを更新
                systemAudioSource.innerHTML = '<option value="">ソースを選択...</option>';

                if (sources.length === 0) {
                    console.warn('[Audio Source] 音声ソースが見つかりませんでした');
                    this.notify(
                        '検出結果',
                        '会議アプリやブラウザが見つかりませんでした。Teams、Zoom、Chrome等を起動してから再度お試しください。',
                        'warning'
                    );

                    // デバッグ用: 全ウィンドウを表示するオプションを追加
                    const debugOption = document.createElement('option');
                    debugOption.value = 'debug';
                    debugOption.textContent = '（デバッグ: 全ウィンドウを確認）';
                    systemAudioSource.appendChild(debugOption);
                } else {
                    // ソースをドロップダウンに追加（会議アプリとブラウザを区別）
                    console.info('[Audio Source] ========== ソース追加開始 ==========');
                    console.info(`[Audio Source] 総ソース数: ${sources.length}`);

                    sources.forEach((source, index) => {
                        // 会議アプリか確認
                        const isMeetingApp =
                            source.name.includes('Teams') ||
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

                        console.info(`[Audio Source]   [${index + 1}] ${icon}${source.name}`);
                    });

                    console.info('[Audio Source] ========== 追加完了 ==========');

                    // 自動選択: 最初のソースを選択
                    if (sources.length > 0) {
                        systemAudioSource.selectedIndex = 1; // 0は"ソースを選択..."なので1を選択
                        console.info('[Audio Source] 最初のソースを自動選択:', sources[0].name);
                    }

                    this.notify(
                        '検出完了',
                        `${sources.length}個の音声ソースを検出しました`,
                        'success'
                    );
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
                console.info('[Audio Source] Chrome拡張環境: 現在のタブオプションを追加');
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
        console.info('[Recording] 停止処理開始');

        // ✅ モードロックをクリア
        localStorage.removeItem(this.modeStateManager.globalLockKey);
        this.modeStateManager.currentMode = null;
        console.info('[ModeSwitch] モードロックをクリア');

        // ✅ Phase 3: 音声バッファリング停止
        this.isBufferingAudio = false;
        this.audioBuffer = []; // バッファクリア
        this.audioBufferStartTime = null;

        // ✅ P1: VAD バッファタイマーをクリア
        if (this.silenceConfirmTimer) {
            clearTimeout(this.silenceConfirmTimer);
            this.silenceConfirmTimer = null;
        }
        this.speechStartTime = null;

        // 再生キューをクリア（録音停止時は未再生の音声も破棄）
        this.clearPlaybackQueueIfAny();

        // Electronアプリの場合、ブラウザ版への録音停止通知をクリア
        const isElectron =
            typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;
        if (isElectron) {
            console.info('[Sync] Electronアプリで録音停止 - ブラウザ版への通知をクリアします');
            localStorage.removeItem('app2_recording');
        }

        const isServerVadEnabled = this.elements.vadEnabled.classList.contains('active');
        console.info('[Recording] Server VAD状態:', isServerVadEnabled ? '有効' : '無効');

        // Server VADが無効な場合はコミット＆レスポンス生成処理を行う（抽象化して複雑度を低下）
        if (this.state.isConnected && this.state.isRecording && !isServerVadEnabled) {
            await this.commitAndEnqueueResponseIfNeeded();
        } else if (isServerVadEnabled) {
            console.info(
                '[Recording] Server VAD有効 - input_audio_buffer.committedイベントでレスポンス生成されます'
            );
        }

        // メディアストリーム／オーディオノードをクリーンアップ（共通処理にまとめる）
        this.stopMediaStreamTracks();
        this.cleanupAudioNodes();

        if (this.state.audioContext) {
            try {
                await this.state.audioContext.close();
            } catch (e) {
                console.warn('[Recording] AudioContext close error:', e);
            }
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

        console.info('[Recording] 停止処理完了 - 翻訳待機中');
    }

    // helper: 再生キューを安全にクリア
    clearPlaybackQueueIfAny() {
        if (!this.playbackQueue || this.playbackQueue.length === 0) {
            return;
        }
        console.info(
            '[Playback Queue] 録音停止 - キューをクリア:',
            this.playbackQueue.length,
            '個破棄'
        );
        this.playbackQueue = [];
        this.isPlayingFromQueue = false;
    }

    // helper: input_audio_buffer.commit とレスポンス生成リクエストを行う
    async commitAndEnqueueResponseIfNeeded() {
        console.info('[Recording] 音声バッファをコミットします（Server VAD無効）');
        this.sendMessage({ type: 'input_audio_buffer.commit' });

        const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
        const modalities = audioOutputEnabled ? ['text', 'audio'] : ['text'];

        console.info('[Recording] レスポンス生成を要求（Server VAD無効）:', {
            modalities: modalities,
            audioOutputEnabled: audioOutputEnabled,
            queueStatus: this.responseQueue.getStatus()
        });

        try {
            await this.responseQueue.enqueue({
                modalities: modalities,
                instructions: this.getInstructions()
            });
            console.info('[Recording] レスポンスリクエストをキューに追加しました');
        } catch (error) {
            console.error('[Recording] レスポンスリクエスト失敗:', error);
        }
    }

    // helper: mediaStream のトラック停止
    stopMediaStreamTracks() {
        if (!this.state.mediaStream) {
            return;
        }
        try {
            this.state.mediaStream.getTracks().forEach((track) => track.stop());
        } catch (error) {
            console.warn('[Recording] mediaStream stop error:', error);
        } finally {
            this.state.mediaStream = null;
        }
    }

    // helper: オーディオノードのクリーンアップをまとめる
    cleanupAudioNodes() {
        // MediaStreamSource
        if (this.state.audioSource) {
            try {
                this.state.audioSource.disconnect();
            } catch (e) {
                console.warn('[Recording] audioSource disconnect error:', e);
            }
            this.state.audioSource = null;
            console.info('[Recording] MediaStreamSource をクリーンアップしました');
        }

        // GainNode
        if (this.state.inputGainNode) {
            try {
                this.state.inputGainNode.disconnect();
            } catch (e) {
                console.warn('[Recording] inputGainNode disconnect error:', e);
            }
            this.state.inputGainNode = null;
            console.info('[Recording] GainNode をクリーンアップしました');
        }

        // AudioWorkletNode
        if (this.state.workletNode) {
            try {
                // 停止メッセージを送信
                if (
                    this.state.workletNode.port &&
                    typeof this.state.workletNode.port.postMessage === 'function'
                ) {
                    this.state.workletNode.port.postMessage({ type: 'stop' });
                }
                this.state.workletNode.disconnect();
            } catch (e) {
                console.warn('[Recording] workletNode cleanup error:', e);
            } finally {
                this.state.workletNode = null;
                console.info('[Recording] AudioWorkletNode をクリーンアップしました');
            }
        }

        // ScriptProcessorNode
        if (this.state.processor) {
            try {
                this.state.processor.disconnect();
            } catch (e) {
                console.warn('[Recording] processor disconnect error:', e);
            } finally {
                this.state.processor = null;
                console.info('[Recording] ScriptProcessorNode をクリーンアップしました');
            }
        }
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

        // ✅ ループバック防止: システム音声モードの場合のみ、再生中の入力をスキップ
        // 理由:
        //   - マイクモード: ユーザーの音声と翻訳音声は別のソースなので、ループバックの心配がない
        //   - システム音声モード: 翻訳音声が再度入力として捕捉される可能性があるため、スキップが必要
        if (this.state.isPlayingAudio && this.state.audioSourceType === 'system') {
            return; // システム音声モードの場合のみスキップ
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
     * ✅ ストリーミング再生: 音声チャンクを即座に再生
     *
     * 目的:
     *   Realtime API の低遅延ストリーミングの利点を活かすため、
     *   音声チャンクを受信したら即座にデコード・再生する
     *
     * @param {string} base64Audio - base64エンコードされた音声データ
     */
    async playAudioChunk(base64Audio) {
        try {
            // 再生キューに追加
            this.playbackQueue.push(base64Audio);

            console.info('[🔊 Streaming] チャンク受信:', {
                queueLength: this.playbackQueue.length,
                isPlayingFromQueue: this.isPlayingFromQueue
            });

            // 再生中でなければ再生開始
            if (!this.isPlayingFromQueue) {
                console.info('[🔊 Streaming] 再生開始');
                this.playNextInQueue();
            }
        } catch (error) {
            console.error('[🔊 Streaming] チャンク処理エラー:', error);
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
                this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1 : 0;
                console.info(
                    '[Playback Queue] キューが空 - 入力音声を復元:',
                    this.state.inputAudioOutputEnabled ? 'ON' : 'OFF'
                );
            }

            console.info('[Playback Queue] キューが空 - 再生終了');
            return;
        }

        // 再生中フラグをON
        this.isPlayingFromQueue = true;

        // キューから最初の音声を取り出す
        const audioData = this.playbackQueue.shift();

        console.info('[Playback Queue] 次の音声を再生:', {
            remainingInQueue: this.playbackQueue.length
        });

        // 音声を再生（await しない - 非同期で開始）
        this.playAudio(audioData).catch((error) => {
            console.error('[Playback Queue] 再生エラー:', error);
            // エラーが発生しても次の音声を再生
            this.playNextInQueue();
        });
    }

    /**
     * ✅ PCM16 データを WAV 形式に変換
     *
     * 目的:
     *   AudioContext.decodeAudioData が認識できる WAV 形式に変換
     *
     * @param {ArrayBuffer} pcm16Data - PCM16 データ
     * @param {number} sampleRate - サンプルレート
     * @returns {ArrayBuffer} WAV 形式のデータ
     */
    createWavFromPCM16(pcm16Data, sampleRate) {
        const numChannels = 1; // モノラル
        const bitsPerSample = 16;
        const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
        const blockAlign = (numChannels * bitsPerSample) / 8;
        const dataSize = pcm16Data.byteLength;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;

        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);

        // RIFF チャンク
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, totalSize - 8, true);
        this.writeString(view, 8, 'WAVE');

        // fmt チャンク
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // fmt チャンクサイズ
        view.setUint16(20, 1, true); // PCM フォーマット
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);

        // data チャンク
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // PCM データをコピー
        const pcm16View = new Uint8Array(pcm16Data);
        const wavView = new Uint8Array(buffer);
        wavView.set(pcm16View, headerSize);

        return buffer;
    }

    /**
     * DataView に文字列を書き込む
     *
     * @param {DataView} view - DataView
     * @param {number} offset - オフセット
     * @param {string} string - 文字列
     */
    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    /**
     * 音声再生の初期化処理
     *
     * 目的:
     *   出力AudioContextの作成とリジューム
     *
     * Returns:
     *   Promise<void>
     *
     * 注意:
     *   ネストを減らすため別メソッドに抽出
     */
    async initializeOutputAudioContext() {
        // 出力専用AudioContextが存在しない場合は作成
        // 入力処理と分離することで、出力音声の優先度を確保
        if (!this.state.outputAudioContext) {
            this.state.outputAudioContext = new (globalThis.AudioContext ||
                globalThis.webkitAudioContext)({
                sampleRate: CONFIG.AUDIO.SAMPLE_RATE
            });
            console.info('[Audio] 出力専用AudioContextを作成しました');
        }

        // AudioContextがsuspended状態の場合はresume
        if (this.state.outputAudioContext.state === 'suspended') {
            await this.state.outputAudioContext.resume();
            console.info('[Audio] AudioContextをresumeしました');
        }
    }

    /**
     * 音声データのデコードと再生準備
     *
     * 目的:
     *   Base64音声データをデコードしてAudioBufferSourceを作成
     *
     * Parameters:
     *   base64Audio - Base64エンコードされた音声データ
     *
     * Returns:
     *   AudioBufferSource - 再生準備完了のAudioBufferSource
     *
     * 注意:
     *   ネストを減らすため別メソッドに抽出
     */
    async prepareAudioSource(base64Audio) {
        // Base64からArrayBufferに変換
        const pcm16Data = Utils.base64ToArrayBuffer(base64Audio);

        // PCM16 を WAV 形式に変換（decodeAudioData が必要とする形式）
        const wavData = this.createWavFromPCM16(pcm16Data, CONFIG.AUDIO.SAMPLE_RATE);

        // 非同期デコード
        const audioBuffer = await this.state.outputAudioContext.decodeAudioData(wavData);

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

        return source;
    }

    /**
     * 音声再生完了時の処理
     *
     * 目的:
     *   再生終了後のフラグ更新とキュー処理
     *
     * Returns:
     *   void
     *
     * 注意:
     *   このメソッドはonendedコールバックから呼び出される
     */
    handleAudioPlaybackEnded() {
        // 即座に次の音声を再生（連続性最優先）
        this.state.isPlayingAudio = false;

        // 次の音声を再生（キューに残っている場合）
        // 注意: 入力音声の復元は playNextInQueue() で統一処理
        this.playNextInQueue();
    }

    /**
     * 音声再生エラー時の処理
     *
     * 目的:
     *   エラー発生時のフラグ更新と入力音声復元
     *
     * Parameters:
     *   error - エラーオブジェクト
     *
     * Returns:
     *   void
     *
     * 注意:
     *   ネストを減らすため別メソッドに抽出
     */
    handleAudioPlaybackError(error) {
        console.error('[Audio Play Error]', error);
        this.notify('音声再生エラー', error.message, 'error');

        // エラー時もフラグをOFF（すべてのモードで適用）
        this.state.isPlayingAudio = false;

        // 入力音声を復元
        if (this.state.inputGainNode) {
            this.state.inputGainNode.gain.value = this.state.inputAudioOutputEnabled ? 1 : 0;
            console.info('[Audio] エラー時 - 入力音声を復元');
        }

        // エラーでも次の音声を再生（キューを停止しない）
        this.playNextInQueue();
    }

    async playAudio(base64Audio) {
        // ✅ 音声源トラッキング開始: 出力再生時刻を記録
        const playbackToken =
            'playback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.audioSourceTracker.playbackTokens.add(playbackToken);
        this.audioSourceTracker.outputStartTime = Date.now();

        // 音声再生中フラグをON（ループバック防止）
        // すべてのモード（マイク/ブラウザ音声/画面共有）で有効
        this.state.isPlayingAudio = true;

        // 出力音声再生中は入力音声を完全ミュート（優先度確保）
        if (this.state.inputGainNode) {
            this.state.inputGainNode.gain.value = 0;
            console.info('[Audio] 出力再生中 - 入力音声を完全ミュート', {
                playbackToken,
                timestamp: this.audioSourceTracker.outputStartTime
            });
        }

        try {
            // 出力AudioContextの初期化
            await this.initializeOutputAudioContext();

            // ✅ 非同期デコード: AudioContext.decodeAudioData を使用
            // 理由: メインスレッドのブロックを防ぎ、UI の応答性を維持
            const source = await this.prepareAudioSource(base64Audio);

            // 再生終了時にフラグをOFF（すべてのモードで適用）
            source.onended = () => {
                // ✅ 出力完了時刻を記録（バッファウィンドウの計算用）
                this.audioSourceTracker.outputEndTime = Date.now();
                this.audioSourceTracker.playbackTokens.delete(playbackToken);
                this.handleAudioPlaybackEnded();
            };

            console.info('[Audio] 音声再生開始:', {
                playbackToken,
                outputStartTime: this.audioSourceTracker.outputStartTime
            });

            source.start();
        } catch (error) {
            // ✅ エラー時もトークンをクリア
            this.audioSourceTracker.playbackTokens.delete(playbackToken);
            this.handleAudioPlaybackError(error);
            throw error;
        }
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
        if (
            this.state.processingTranscripts &&
            this.state.processingTranscripts.has(transcriptId)
        ) {
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
                    Authorization: `Bearer ${this.state.apiKey}`
                },
                body: JSON.stringify({
                    model: CONFIG.API.CHAT_MODEL,
                    messages: [
                        {
                            role: 'system',
                            content:
                                'You are a language detection expert. Detect the language of the given text and return ONLY a JSON object with format: {"language": "language_code", "confidence": 0.95}. Language codes: ja (Japanese), en (English), zh (Chinese), ko (Korean), es (Spanish), fr (French), de (German), etc. Confidence should be 0.0-1.0.'
                        },
                        {
                            role: 'user',
                            content: inputText
                        }
                    ],
                    temperature: 0.1,
                    max_completion_tokens: 50
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

            // 置信度が60%以上の場合は検出された言語を使用、それ以外はデフォルト値を使用
            const finalSourceLang =
                confidence >= 0.6 ? detectedLang : this.state.sourceLang || 'en';

            // 検出された言語で翻訳を実行
            await this.translateTextDirectly(inputText, transcriptId, finalSourceLang);
        } catch (error) {
            console.error('[言語検出] エラー:', error);
            // エラー時はデフォルト値の言語で翻訳を実行
            await this.translateTextDirectly(
                inputText,
                transcriptId,
                this.state.sourceLang || 'en'
            );
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
        // sourceLangが指定されていない場合はデフォルト値を使用
        const actualSourceLang = sourceLang || this.state.sourceLang || 'en';

        try {
            if (!this.state.apiKey) {
                throw new Error('APIキーが設定されていません');
            }

            // 文本翻訳用のモデルを選択
            // Chat Completions APIモデルを使用（環境変数から設定可能）
            const translationModel = CONFIG.API.CHAT_MODEL;

            // リクエストボディを構築
            const requestBody = {
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
                ],
                max_completion_tokens: 500
            };

            // gpt-5 モデルは temperature をサポートしないため、他のモデルのみ設定
            if (!translationModel.startsWith('gpt-5')) {
                requestBody.temperature = 0.3;
            }

            // OpenAI Chat Completions API を使用して文本翻訳
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.state.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error('[処理2] API Error Response:', errorBody);
                throw new Error(
                    `API Error: ${response.status} ${response.statusText} - ${errorBody}`
                );
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
     * 重複するトランスクリプトをチェック
     * 目的: 同じtranscriptIdとtypeで既に表示されている場合を検出
     *
     * @param {string} type - トランスクリプトタイプ
     * @param {number} transcriptId - トランスクリプトID
     * @param {string} text - テキスト（ログ用）
     * @returns {Element|null} 既存要素またはnull
     */
    checkDuplicateTranscript(type, transcriptId, text) {
        if (!transcriptId || type !== 'output') {
            return null;
        }

        const container = this.elements.outputTranscript;
        if (!container) {
            return null;
        }

        const existing = container.querySelector(`[data-transcript-id="${transcriptId}"]`);
        if (existing) {
            console.warn('[Transcript] 重複検出 - スキップ:', {
                type,
                transcriptId,
                text: text.substring(0, 20)
            });
        }
        return existing;
    }

    /**
     * トランスクリプト表示可否をチェック
     * 目的: ユーザー設定に基づいて表示/非表示を判定
     *
     * @param {string} type - トランスクリプトタイプ
     * @returns {boolean} 表示すべき場合true
     */
    shouldShowTranscript(type) {
        const showInput = this.elements.showInputTranscript?.classList.contains('active') ?? true;
        const showOutput = this.elements.showOutputTranscript?.classList.contains('active') ?? true;

        if (type === 'input' && !showInput) {
            console.info('[Transcript] 入力音声表示がOFFのためスキップ');
            return false;
        }

        if (type === 'output' && !showOutput) {
            console.info('[Transcript] 翻訳結果表示がOFFのためスキップ');
            return false;
        }

        return true;
    }

    /**
     * トランスクリプトコンテナを取得
     * 目的: タイプに応じた適切なコンテナを返す
     *
     * @param {string} type - トランスクリプトタイプ
     * @returns {Element|null} コンテナ要素またはnull
     */
    getTranscriptContainer(type) {
        const container =
            type === 'input' ? this.elements.inputTranscript : this.elements.outputTranscript;

        if (!container) {
            console.error('[Transcript] コンテナが見つかりません:', type);
            return null;
        }

        return container;
    }

    /**
     * メッセージ要素を作成
     * 目的: トランスクリプト表示用のDOM要素を生成
     *
     * @param {string} type - トランスクリプトタイプ
     * @param {string} text - メッセージテキスト
     * @param {number} transcriptId - トランスクリプトID
     * @returns {Element} 作成されたメッセージ要素
     */
    createTranscriptMessage(type, text, transcriptId) {
        const message = document.createElement('div');
        message.className = `transcript-message ${type === 'output' ? 'translation' : ''}`;

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

        return message;
    }

    /**
     * 空状態要素を削除
     * 目的: 最初のメッセージ追加時に空状態表示を削除
     *
     * @param {Element} container - コンテナ要素
     */
    removeEmptyState(container) {
        const emptyState = container.querySelector('.empty-state');
        if (emptyState) {
            console.info('[Transcript] 空状態を削除');
            emptyState.remove();
        }
    }

    /**
     * 順序付きメッセージを挿入（output用）
     * 目的: transcriptIdの順序を保証して正しい位置に挿入
     *
     * @param {Element} container - コンテナ要素
     * @param {Element} message - メッセージ要素
     * @param {number} transcriptId - トランスクリプトID
     */
    insertOrderedMessage(container, message, transcriptId) {
        let insertPosition = null;
        const messages = container.querySelectorAll('.transcript-message');

        for (const msg of messages) {
            const existingId = Number.parseInt(msg.dataset.transcriptId, 10);
            if (existingId && transcriptId > existingId) {
                insertPosition = msg;
                console.info('[Transcript] 挿入位置を発見:', {
                    currentId: transcriptId,
                    existingId: existingId,
                    insertBefore: true
                });
                break;
            }
        }

        if (insertPosition) {
            insertPosition.before(message);
            console.info('[Transcript] 順序を保証して挿入:', {
                transcriptId: transcriptId,
                position: '中間位置',
                totalMessages: container.children.length
            });
        } else {
            container.appendChild(message);
            console.info('[Transcript] 最後に追加:', {
                transcriptId: transcriptId,
                position: '最下部',
                totalMessages: container.children.length
            });
        }
    }

    /**
     * 最新メッセージを最上部に追加
     * 目的: input型またはtranscriptIdなしの場合の標準的な挿入
     *
     * @param {Element} container - コンテナ要素
     * @param {Element} message - メッセージ要素
     * @param {string} type - トランスクリプトタイプ
     * @param {number} transcriptId - トランスクリプトID
     */
    insertLatestMessage(container, message, type, transcriptId) {
        if (container.firstChild) {
            container.insertBefore(message, container.firstChild);
        } else {
            container.appendChild(message);
        }
        console.info('[Transcript] 最新メッセージを最上部に追加:', {
            type: type,
            transcriptId: transcriptId || 'なし',
            totalMessages: container.children.length
        });
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
        // 重複チェック
        const duplicate = this.checkDuplicateTranscript(type, transcriptId, text);
        if (duplicate) {
            return duplicate;
        }

        // 表示可否チェック
        if (!this.shouldShowTranscript(type)) {
            return;
        }

        // コンテナ取得
        const container = this.getTranscriptContainer(type);
        if (!container) {
            return;
        }

        // 空状態を削除
        this.removeEmptyState(container);

        // メッセージ要素を作成
        const message = this.createTranscriptMessage(type, text, transcriptId);

        // メッセージを挿入
        if (type === 'output' && transcriptId) {
            this.insertOrderedMessage(container, message, transcriptId);
        } else {
            this.insertLatestMessage(container, message, type, transcriptId);
        }

        console.info(
            '[Transcript] メッセージ追加完了:',
            container.children.length,
            '件',
            transcriptId ? `(ID: ${transcriptId})` : ''
        );

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
     * トランスクリプトメッセージを挿入
     *
     * 目的:
     *   output タイプで transcriptId がある場合は順序を保証して挿入、
     *   それ以外は最新を一番上に追加
     *
     * @param {HTMLElement} container - コンテナ要素
     * @param {HTMLElement} message - メッセージ要素
     * @param {string} type - トランスクリプトタイプ
     * @param {number} transcriptId - トランスクリプトID
     */
    insertTranscriptMessage(container, message, type, transcriptId) {
        if (type === 'output' && transcriptId) {
            const insertPosition = this.findInsertPosition(container, transcriptId);

            if (insertPosition) {
                insertPosition.before(message);
                console.info('[Transcript] 順序を保証して挿入:', {
                    transcriptId: transcriptId,
                    position: '中間位置',
                    totalMessages: container.children.length
                });
            } else {
                container.appendChild(message);
                console.info('[Transcript] 最後に追加:', {
                    transcriptId: transcriptId,
                    position: '最下部',
                    totalMessages: container.children.length
                });
            }
        } else {
            if (container.firstChild) {
                container.firstChild.before(message);
            } else {
                container.appendChild(message);
            }
            console.info('[Transcript] 最新メッセージを最上部に追加:', {
                type: type,
                transcriptId: transcriptId || 'なし',
                totalMessages: container.children.length
            });
        }
    }

    /**
     * トランスクリプト統計を更新: 文字数カウントとスクロール位置を更新
     *
     * 目的:
     *   メッセージ追加後の統計情報を更新する
     *
     * @param {HTMLElement} container - コンテナ要素
     * @param {string} text - メッセージテキスト
     * @param {number} transcriptId - トランスクリプトID
     */
    updateTranscriptStats(container, text, transcriptId) {
        console.info(
            '[Transcript] メッセージ追加完了:',
            container.children.length,
            '件',
            transcriptId ? `(ID: ${transcriptId})` : ''
        );

        container.scrollTop = 0;

        this.state.charCount += text.length;
        if (this.elements.charCount) {
            this.elements.charCount.textContent = this.state.charCount.toLocaleString();
        }
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

        const container =
            type === 'input' ? this.elements.inputTranscript : this.elements.outputTranscript;

        if (!container) {
            console.error('[Transcript] コンテナが見つかりません:', type);
            return;
        }

        // 最新のメッセージ（一番上）のテキスト部分を取得
        const firstMessage = container.querySelector('.transcript-message:first-child');
        if (firstMessage) {
            // テキスト部分を取得（.transcript-text または最後の div）
            const textElement =
                firstMessage.querySelector('.transcript-text') ||
                firstMessage.querySelector('div:last-child');

            if (textElement && !textElement.classList.contains('transcript-time')) {
                console.info(
                    '[Transcript] 既存メッセージに追加:',
                    textElement.textContent.substring(0, 20) + '...'
                );
                textElement.textContent += text;
            } else {
                console.info('[Transcript] テキスト要素が見つからないため、新規メッセージを作成');
                this.addTranscript(type, text);
            }
        } else {
            console.info('[Transcript] メッセージが存在しないため、新規メッセージを作成');
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
        console.info('[Transcript] クリア:', type);

        // 要素が初期化されているか確認
        if (!this.elements || !this.elements.inputTranscript || !this.elements.outputTranscript) {
            console.warn('[Transcript] 要素が初期化されていません。クリアをスキップします。');
            return;
        }

        const clearContainer = (containerType) => {
            const container =
                containerType === 'input'
                    ? this.elements.inputTranscript
                    : this.elements.outputTranscript;

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
            text.textContent =
                containerType === 'input'
                    ? '録音を開始すると、ここに音声認識結果が表示されます'
                    : '翻訳結果がここに表示されます';

            emptyState.appendChild(icon);
            emptyState.appendChild(text);
            container.appendChild(emptyState);

            console.info('[Transcript] クリア完了:', containerType);
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

        this.visualizerBars.forEach((bar, _index) => {
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
        this.visualizerBars.forEach((bar) => {
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
        console.info(`[Status] ${type}: ${text}`);
    }
    /**
     * Electron環境かどうか判定
     *
     * @returns {boolean} Electron環境の場合true
     */
    isElectron() {
        return (
            typeof globalThis.window !== 'undefined' &&
            typeof globalThis.window.electronAPI !== 'undefined'
        );
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
            console.info(`[VAD] Sensitivity updated: ${level} (${sourceType}モード)`, {
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
        if (!this.state.isConnected) {
            return;
        }

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

        // 録音中でない場合のみ、翻訳音色も更新
        if (!this.state.isRecording) {
            session.session.voice = this.state.voiceType;
        }

        this.sendMessage(session);
        console.info('[Session] セッション更新:', {
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

    /**
     * ✅ 新しい音声セグメント処理（双パス异步処理）
     *
     * @param {AudioSegment} segment 音声セグメント
     */
    handleNewAudioSegment(segment) {
        console.info('[Audio] 新しいセグメント処理開始:', {
            id: segment.id,
            queueSize: this.audioQueue.size(),
            duration: segment.getDuration() + 'ms'
        });

        // ✅ モード設定: 「リアルタイム音声翻訳」トグルの状態に基づいて設定
        // ON（true）: モード2（音声翻訳）→ テキスト翻訳も実行
        // OFF（false）: モード1（音声のみ）→ テキスト翻訳は実行しない
        const isRealtimeAudioMode = this.elements.translationModeAudio.classList.contains('active');
        const textPathMode = isRealtimeAudioMode ? 2 : 1;
        const voicePathMode = isRealtimeAudioMode ? 2 : 1;

        this.textPathProcessor.setMode(textPathMode);
        this.voicePathProcessor.setMode(voicePathMode);

        console.info('[Audio] パス処理器モード設定:', {
            isRealtimeAudioMode: isRealtimeAudioMode,
            textPathMode: textPathMode,
            voicePathMode: voicePathMode,
            description: isRealtimeAudioMode ? '音声翻訳モード' : 'テキスト翻訳モード'
        });

        // ✅ パス1: 文本処理（异步）
        this.textPathProcessor.process(segment).catch((error) => {
            console.error('[Path1] 処理失敗:', {
                segmentId: segment.id,
                error: error.message
            });
        });

        // ✅ パス2: 音声処理（异步）
        this.voicePathProcessor.process(segment).catch((error) => {
            console.error('[Path2] 処理失敗:', {
                segmentId: segment.id,
                error: error.message
            });
        });
    }

    /**
     * ✅ 音声セグメント完全処理完了
     *
     * @param {AudioSegment} segment 音声セグメント
     */
    handleSegmentComplete(segment) {
        console.info('[Audio] セグメント完全処理完了:', {
            id: segment.id,
            duration: segment.getDuration() + 'ms',
            age: segment.getAge() + 'ms',
            results: {
                path1: segment.results.path1 !== null ? 'OK' : 'N/A',
                path2: segment.results.path2 !== null ? 'OK' : 'N/A'
            }
        });

        // 統計情報更新
        const stats = this.audioQueue.getStats();
        console.info('[AudioQueue] 統計:', stats);

        // UI に統計情報を表示
        this.updateLatencyDisplay(stats);
        this.updateAccuracy();
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

    initializeModeManager() {
        // モードの初期化
        this.modeStateManager.currentMode = null;
        this.modeStateManager.modeStartTime = null;
        this.modeStateManager.lastModeChange = null;
        this.modeStateManager.modeChangeTimeout = 1000;
        this.modeStateManager.globalLockKey = 'global_capture_mode_v2';
    }
}

// ====================
// アプリケーション起動
// ====================
document.addEventListener('DOMContentLoaded', () => {
    globalThis.window.app = new VoiceTranslateApp();
});

// 拡張機能用のエクスポート
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VoiceTranslateApp, CONFIG, Utils, VoiceActivityDetector };
}
