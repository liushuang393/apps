/**
 * VoiceTranslate Pro 2.0 - メインアプリケーション
 *
 * 依存モジュール:
 *   - voicetranslate-utils.js: ResponseQueue, VoiceActivityDetector, CONFIG, AudioUtils
 *   - voicetranslate-audio-queue.js: AudioSegment, AudioQueue
 *   - voicetranslate-path-processors.js: TextPathProcessor, VoicePathProcessor
 *   - voicetranslate-websocket-mixin.js: WebSocketMixin (WebSocket/音声処理機能)
 *   - voicetranslate-ui-mixin.js: UIMixin (UI/転録表示機能)
 *   - voicetranslate-audio-capture-strategy.js: AudioCaptureStrategyFactory (音声キャプチャ戦略)
 *
 * 注意:
 *   このファイルを読み込む前に上記モジュールを読み込む必要があります
 *
 * @typedef {import('./src/types/electron.d.ts').ElectronAPI} ElectronAPI
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
     * - ノイズ除去: ON (dev-only)
     * - エコー除去: ON (dev-only)
     * - 自動ゲイン: ON (dev-only)
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
            noiseReduction: 'true', // ON (dev-only)
            echoCancellation: 'true', // ON (dev-only)
            autoGainControl: 'true', // ON (dev-only)
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

        audioSourceType.addEventListener('change', async (e) => {
            const sourceType = e.target.value;
            this.state.audioSourceType = sourceType;
            this.saveToStorage('audio_source_type', sourceType);

            // システム音声選択時は追加UIを表示
            if (sourceType === 'system') {
                systemAudioSourceGroup.style.display = 'block';

                // ✅ 修正: ブラウザ環境では自動的に音声ソースを検出
                // Electron環境ではユーザーが手動で「会議アプリを検出」ボタンをクリックする
                const isElectron =
                    typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;
                if (!isElectron) {
                    console.info('[Audio Source] ブラウザ環境: 音声ソースを自動検出');
                    await this.detectAudioSources();
                }
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

        // ✅ システム音声ソース選択時の処理（ブラウザ拡張機能用）
        const systemAudioSource = document.getElementById('systemAudioSource');
        systemAudioSource.addEventListener('change', async (e) => {
            const selectedValue = e.target.value;
            console.info('[Audio Source] ソース選択:', selectedValue);

            // ブラウザ拡張機能環境で「画面/ウィンドウを選択」が選択された場合
            if (selectedValue === 'display-media') {
                try {
                    console.info('[Audio Source] 画面/ウィンドウ選択ダイアログを表示...');

                    // getDisplayMedia で選択ダイアログを表示
                    const stream = await navigator.mediaDevices.getDisplayMedia({
                        audio: {
                            channelCount: 1,
                            sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
                            echoCancellation: false,
                            noiseSuppression: false,
                            autoGainControl: false
                        },
                        video: true // 互換性のため
                    });

                    // ビデオトラックを停止
                    stream.getVideoTracks().forEach((track) => track.stop());

                    // ✅ 音声トラックの有無を即座にチェック
                    const audioTrack = stream.getAudioTracks()[0];
                    if (audioTrack) {
                        console.info('[Audio Source] ✅ 音声トラック検出:', audioTrack.label);
                        this.notify('選択完了', `${audioTrack.label} を選択しました`, 'success');

                        // 選択された音声ソースを保存
                        this.state.selectedDisplayMediaStream = stream;
                    } else {
                        console.warn('[Audio Source] ❌ 音声トラックが含まれていません');

                        // ストリームを停止
                        stream.getTracks().forEach((track) => track.stop());

                        // ドロップダウンを元に戻す
                        e.target.value = '';

                        this.notify(
                            '音声トラックなし',
                            '【重要】音声をキャプチャするには「タブ」を選択してください。\n\n' +
                                '画面全体やウィンドウを選択した場合、音声は含まれません。\n' +
                                'または、音声ソースを「マイク」に変更してください。',
                            'warning'
                        );
                    }
                } catch (error) {
                    console.error('[Audio Source] 選択キャンセルまたはエラー:', error);
                    // ユーザーがキャンセルした場合、ドロップダウンを元に戻す
                    e.target.value = '';

                    if (error.name === 'NotAllowedError') {
                        this.notify(
                            'キャンセル',
                            '画面/ウィンドウの選択がキャンセルされました',
                            'info'
                        );
                    } else {
                        this.notify('エラー', '画面/ウィンドウの選択に失敗しました', 'error');
                    }
                }
            }
        });

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
        const isElectron = typeof globalThis !== 'undefined' && !!globalThis.electronAPI;

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

## SUPPORTED LANGUAGES (CRITICAL)
**IMPORTANT**: This system ONLY supports 4 languages:
1. English (en)
2. Japanese (ja / 日本語)
3. Chinese (zh / 中文)
4. Vietnamese (vi / Tiếng Việt)

**DO NOT attempt to recognize or translate any other languages** (Korean, Spanish, French, German, etc.)
If you detect speech in an unsupported language, respond in ${targetName}: "申し訳ございません。対応言語は英語、日本語、中国語、ベトナム語のみです。"

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
     * 録音を開始
     *
     * 目的:
     *   WebSocket接続確認、モード切り替え、音声キャプチャを開始
     *
     * 処理フロー:
     *   1. 接続状態と録音状態を確認
     *   2. モード切り替え処理を実行
     *   3. Electron/ブラウザ同期を処理
     *   4. 音声キャプチャを開始
     *   5. 共通の音声処理をセットアップ
     */
    async startRecording() {
        // 接続状態を確認
        if (!this.state.isConnected) {
            this.notify('エラー', 'WebSocketに接続してください', 'error');
            return;
        }

        // 既に録音中の場合は無視
        if (this.state.isRecording) {
            console.warn('[Recording] 既に録音中のため開始要求を無視します');
            return;
        }

        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = true;

        try {
            console.info('[Recording] Starting...');

            // モード切り替え処理を実行
            await this.handleModeSwitch();

            // Electron/ブラウザ同期を処理
            const shouldContinue = await this.handleElectronBrowserSync();
            if (!shouldContinue) {
                return;
            }

            // 音声キャプチャを開始
            await this.routeAudioCapture();

            // 共通の録音開始処理
            await this.setupAudioProcessing();
        } catch (error) {
            // エラーメッセージを安全に抽出
            const errorMessage = this.extractErrorMessage(error);
            console.error('[Recording] エラー:', errorMessage);
            // エラー時もモードロックをクリア
            localStorage.removeItem(this.modeStateManager.globalLockKey);
            this.modeStateManager.currentMode = null;
            this.notify('録音エラー', errorMessage, 'error');
        } finally {
            if (!this.state.isRecording) {
                this.elements.startBtn.disabled = false;
                this.elements.stopBtn.disabled = true;
            }
        }
    }

    /**
     * モード切り替え処理
     *
     * 目的:
     *   現在のモードをチェックし、別のモードが実行中の場合は強制終了
     *   新しいモードをロック
     */
    async handleModeSwitch() {
        const targetMode = this.state.audioSourceType; // 'microphone' or 'system'
        console.info('[ModeSwitch] 目標モード:', targetMode);

        // 現在のモードをチェック
        const globalLock = localStorage.getItem(this.modeStateManager.globalLockKey);
        if (globalLock) {
            await this.handleExistingModeConflict(globalLock, targetMode);
        }

        // 新しいモードをロック
        this.lockNewMode(targetMode);
    }

    /**
     * 既存モードの競合を処理
     *
     * 目的:
     *   別のモードが実行中の場合、それを強制終了して新しいモードに切り替え
     */
    async handleExistingModeConflict(globalLock, targetMode) {
        try {
            const parsedLock = JSON.parse(globalLock);
            if (parsedLock.mode && parsedLock.mode !== targetMode) {
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
        } catch (error) {
            console.error('[ModeSwitch] globalLock パース失敗:', error);
            localStorage.removeItem(this.modeStateManager.globalLockKey);
        }
    }

    /**
     * 新しいモードをロック
     *
     * 目的:
     *   新しいモードをlocalStorageにロックして、他のインスタンスが同時に異なるモードで実行されないようにする
     */
    lockNewMode(targetMode) {
        const modeLockData = {
            mode: targetMode,
            startTime: Date.now(),
            instanceId: 'inst_' + Math.random().toString(36).substring(2, 11)
        };
        localStorage.setItem(this.modeStateManager.globalLockKey, JSON.stringify(modeLockData));
        this.modeStateManager.currentMode = targetMode;
        this.modeStateManager.modeStartTime = Date.now();

        console.info('[ModeSwitch] モードをロック:', modeLockData);
    }

    /**
     * Electron/ブラウザ同期を処理
     *
     * 目的:
     *   Electronアプリとブラウザ版の競合を防ぐ
     *
     * 戻り値:
     *   true: 続行可能、false: 中止
     */
    async handleElectronBrowserSync() {
        const isElectron =
            typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;

        if (isElectron) {
            console.info('[Sync] Electronアプリで録音開始 - ブラウザ版に停止を通知します');
            localStorage.setItem('app2_recording', 'true');
            return true;
        }

        // ブラウザ版の場合、app2が既に録音中かチェック
        const app2Recording = localStorage.getItem('app2_recording');
        if (app2Recording === 'true') {
            console.warn('[Sync] Electronアプリが既に録音中です - ブラウザ版での録音を中止します');
            localStorage.removeItem(this.modeStateManager.globalLockKey);
            this.notify(
                '警告',
                'Electronアプリが既に録音中です。ブラウザ版では録音できません。',
                'warning'
            );
            return false;
        }

        return true;
    }

    /**
     * 音声キャプチャを開始
     *
     * 目的:
     *   音声ソースタイプに応じて、マイクまたはシステム音声のキャプチャを開始
     */
    async routeAudioCapture() {
        if (this.state.audioSourceType === 'system') {
            // システム音声キャプチャ
            await this.startSystemAudioCapture();
        } else {
            // マイクキャプチャ（既存機能）
            await this.startMicrophoneCapture();
        }
    }

    /**
     * エラーメッセージを安全に抽出
     *
     * 目的:
     *   エラーオブジェクトから適切なメッセージを抽出
     *   [object Object] のような不適切な表示を防ぐ
     *
     * 入力:
     *   error - エラーオブジェクト
     *
     * 戻り値:
     *   string - エラーメッセージ
     */
    extractErrorMessage(error) {
        if (!error) {
            return '不明なエラーが発生しました';
        }

        // Error オブジェクトの場合
        if (error instanceof Error) {
            return error.message || error.toString();
        }

        // 文字列の場合
        if (typeof error === 'string') {
            return error;
        }

        // オブジェクトの場合
        if (typeof error === 'object') {
            // message プロパティがある場合
            if (error.message) {
                return error.message;
            }

            // toString() メソッドがある場合
            if (typeof error.toString === 'function') {
                const str = error.toString();
                if (str && str !== '[object Object]') {
                    return str;
                }
            }

            // JSON.stringify で試す
            try {
                return JSON.stringify(error);
            } catch {
                return '不明なエラーが発生しました';
            }
        }

        return String(error);
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
            const errorMessage = this.extractErrorMessage(error);
            console.warn('[Permission] マイク権限チェックエラー:', errorMessage);
            // エラーは無視（一部ブラウザでは microphone クエリが未サポート）
        }
    }

    async startMicrophoneCapture() {
        console.info('[Recording] マイクキャプチャを開始...');

        // ✅ 音声キャプチャ戦略を使用（低結合・高凝集）
        const config = {
            sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
            echoCancellation: this.elements.echoCancellation.classList.contains('active'),
            noiseSuppression: this.elements.noiseReduction.classList.contains('active'),
            autoGainControl: this.elements.autoGainControl.classList.contains('active')
        };

        // 戦略を作成
        const strategy = AudioCaptureStrategyFactory.createStrategy({
            sourceType: 'microphone',
            config: config
        });

        // 音声キャプチャを実行
        this.state.mediaStream = await strategy.capture();

        console.info('[Recording] マイクキャプチャ成功');
        this.notify('マイク接続成功', 'マイクが正常に接続されました', 'success');
    }

    async startSystemAudioCapture() {
        console.info('[Recording] システム音声キャプチャを開始...');

        // ✅ 音声キャプチャ戦略を使用（低結合・高凝集）
        const systemAudioSource = document.getElementById('systemAudioSource');
        const sourceId = systemAudioSource?.value;
        const sourceLabel = systemAudioSource?.options[systemAudioSource.selectedIndex]?.text || '';

        // 音声設定を取得
        // ブラウザ、Teams、Zoom で異なる設定を使用
        const isBrowserSource =
            this.state.selectedDisplayMediaStream ||
            sourceLabel.toLowerCase().includes('chrome') ||
            sourceLabel.toLowerCase().includes('firefox') ||
            sourceLabel.toLowerCase().includes('edge');

        const config = {
            sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
            echoCancellation: isBrowserSource,
            noiseSuppression: isBrowserSource,
            autoGainControl: false
        };

        if (isBrowserSource) {
            console.info('[Recording] ブラウザ環境: 回音消除を有効化');
        } else {
            console.info('[Recording] Electron環境: 回音消除は無効（mandatory形式を使用）');
        }

        // 戦略を作成
        const strategy = AudioCaptureStrategyFactory.createStrategy({
            sourceType: 'system',
            config: config,
            sourceId: sourceId, // Electron環境で使用
            preSelectedStream: this.state.selectedDisplayMediaStream // ブラウザ環境で使用
        });

        // 音声キャプチャを実行
        this.state.mediaStream = await strategy.capture();

        // ブラウザ環境で事前選択されたストリームを使用した場合はクリア
        if (this.state.selectedDisplayMediaStream) {
            this.state.selectedDisplayMediaStream = null;
        }

        // 音声トラックの監視を設定
        const audioTrack = this.state.mediaStream.getAudioTracks()[0];
        if (audioTrack) {
            this.setupAudioTrackListener(audioTrack);
        }

        console.info('[Recording] システム音声キャプチャ成功');
        this.notify('キャプチャ開始', 'システム音声のキャプチャを開始しました', 'success');
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
                const errorMessage = this.extractErrorMessage(error);
                console.error('[Recording] 自動検出失敗:', errorMessage);
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
            const errorMessage = this.extractErrorMessage(error);
            console.error('[Recording] Electronシステム音声キャプチャ失敗:', errorMessage);
            throw new Error(`システム音声のキャプチャに失敗しました: ${errorMessage}`);
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
    async handleBrowserAudioTrackEnded() {
        console.error('[Recording] 音声トラックが停止しました');
        this.notify('エラー', '画面共有の音声キャプチャが停止しました', 'error');
        try {
            await this.stopRecording();
        } catch (error) {
            console.error(
                '[Recording] stopRecording error in handleBrowserAudioTrackEnded:',
                error
            );
        }
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

        audioTrack.addEventListener('ended', async () => {
            try {
                await this.handleBrowserAudioTrackEnded();
            } catch (error) {
                console.error('[Recording] Error in audio track ended listener:', error);
            }
        });
        console.info('[Recording] 音声トラック監視を開始:', {
            id: audioTrack.id,
            label: audioTrack.label,
            readyState: audioTrack.readyState
        });
    }

    async startBrowserSystemAudioCapture() {
        console.info('[Recording] ブラウザ環境でシステム音声をキャプチャ...');

        try {
            let stream;

            // ✅ 既に選択されたストリームがある場合はそれを使用
            if (this.state.selectedDisplayMediaStream) {
                console.info('[Recording] 既に選択されたストリームを使用');
                stream = this.state.selectedDisplayMediaStream;

                // 使用後はクリア（次回は再選択が必要）
                this.state.selectedDisplayMediaStream = null;
            } else {
                // ✅ 選択されていない場合は新規に選択ダイアログを表示
                console.info('[Recording] 画面/ウィンドウ選択ダイアログを表示...');

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

                stream = await navigator.mediaDevices.getDisplayMedia(constraints);

                // ビデオトラックを停止（音声のみ使用）
                const videoTracks = stream.getVideoTracks();
                videoTracks.forEach((track) => {
                    console.info('[Recording] ビデオトラックを停止:', track.label);
                    track.stop();
                });
            }

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
     */
    async handleAudioTrackEnded() {
        console.error('[Recording] 音声トラックが停止しました');
        this.notify('エラー', 'タブ音声のキャプチャが停止しました', 'error');
        try {
            await this.stopRecording();
        } catch (error) {
            console.error('[Recording] stopRecording error in handleAudioTrackEnded:', error);
        }
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

        audioTrack.addEventListener('ended', async () => {
            try {
                await this.handleAudioTrackEnded();
            } catch (error) {
                console.error('[Recording] Error in audio track ended listener:', error);
            }
        });
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
     * Returns:
     *   void
     *
     * 注意:
     *   ネストを減らすため別メソッドに抽出
     */
    handleTabCaptureSuccess(stream, resolve, reject) {
        if (chrome.runtime.lastError) {
            // エラーメッセージを安全に抽出
            let errorMsg = '';
            if (chrome.runtime.lastError.message) {
                errorMsg = chrome.runtime.lastError.message;
            } else if (typeof chrome.runtime.lastError === 'string') {
                errorMsg = chrome.runtime.lastError;
            } else {
                errorMsg = JSON.stringify(chrome.runtime.lastError);
            }

            console.error('[Recording] tabCapture失敗:', errorMsg);

            // Chrome内部ページのエラーを検出
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
     *   ブラウザ拡張機能では、タブを選択しないと音声トラックが含まれない
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

        // ✅ タイムアウトを設定（5秒）
        const timeout = 5000; // 5秒
        const startTime = Date.now();

        // 音声トラックが追加されるまで待機
        while (!checkAudioTrack()) {
            // タイムアウトチェック
            if (Date.now() - startTime > timeout) {
                console.error('[Recording] 音声トラック待機タイムアウト');

                // ブラウザ拡張機能かElectronかを判定
                const isElectron =
                    typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;

                if (isElectron) {
                    throw new Error(
                        '音声トラックが検出されませんでした。\n' +
                            '会議アプリで音声が再生されているか確認してください。'
                    );
                } else {
                    throw new Error(
                        '音声トラックが検出されませんでした。\n\n' +
                            '【重要】getDisplayMedia() で音声をキャプチャするには:\n' +
                            '1. 「タブ」を選択してください（画面/ウィンドウでは音声が含まれません）\n' +
                            '2. または、音声ソースを「マイク」に変更してください\n\n' +
                            '詳細: Chromeの仕様により、画面全体やウィンドウを選択した場合、\n' +
                            '音声トラックは含まれません。タブを選択すると音声が含まれます。'
                    );
                }
            }

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
            const errorMessage = this.extractErrorMessage(error);
            console.warn(
                '[Recording] AudioWorklet の読み込みに失敗しました。ScriptProcessorNode にフォールバックします:',
                errorMessage
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

            // ✅ Chrome拡張環境では「現在のタブ」オプションは不要
            // 理由: 拡張機能のポップアップは独立したウィンドウなので、
            //       「現在のタブ」という概念が意味をなさない
            //       ユーザーは getDisplayMedia() で任意のタブ/ウィンドウを選択する方が便利

            // 画面共有オプション（常に利用可能）
            const displayOption = document.createElement('option');
            displayOption.value = 'display-media';
            displayOption.textContent = '🖥️ 画面/ウィンドウを選択';
            systemAudioSource.appendChild(displayOption);

            console.info('[Audio Source] ブラウザ拡張環境: 画面/ウィンドウ選択オプションを追加');
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
    async playAudio(base64Audio) {
        // ✅ 音声源トラッキング開始: 出力再生時刻を記録
        const playbackToken =
            'playback_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
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
// Mixin適用
// ====================
// WebSocket/音声処理機能を追加
Object.assign(VoiceTranslateApp.prototype, WebSocketMixin);
// UI/転録表示機能を追加
Object.assign(VoiceTranslateApp.prototype, UIMixin);

// ====================
// UI折りたたみ機能
// ====================
/**
 * 折りたたみ可能なセクションを初期化
 * @description 詳細設定と言語設定の折りたたみ機能を提供
 */
class CollapsibleManager {
    constructor() {
        this.sections = new Map();
    }

    /**
     * 折りたたみセクションを登録
     * @param {string} name - セクション名
     * @param {string} headerId - ヘッダー要素のID
     * @param {string} contentId - コンテンツ要素のID
     * @param {boolean} defaultCollapsed - デフォルトで折りたたむか
     */
    registerSection(name, headerId, contentId, defaultCollapsed = false) {
        this.sections.set(name, {
            headerId,
            contentId,
            defaultCollapsed,
            clickHandler: null,
            initialized: false // ✅ 追加: 個別セクションの初期化状態
        });
    }

    /**
     * すべてのセクションを初期化
     */
    initializeAll() {
        let successCount = 0;
        let alreadyInitializedCount = 0;

        for (const [name, config] of this.sections) {
            if (config.initialized) {
                alreadyInitializedCount++;
                continue;
            }

            if (this.initializeSection(name, config)) {
                successCount++;
                config.initialized = true; // ✅ 追加: 初期化成功をマーク
            }
        }

        if (alreadyInitializedCount > 0) {
            console.info(
                `[Collapsible] ${alreadyInitializedCount}/${this.sections.size} セクションは既に初期化済み`
            );
        }

        if (successCount > 0) {
            console.info(
                `[Collapsible] ${successCount}/${this.sections.size} セクションを新規初期化しました`
            );
        }

        return successCount;
    }

    /**
     * 個別セクションを初期化
     * @param {string} name - セクション名
     * @param {object} config - セクション設定
     * @returns {boolean} 初期化成功したか
     */
    initializeSection(name, config) {
        const header = document.getElementById(config.headerId);
        const content = document.getElementById(config.contentId);

        if (!header || !content) {
            console.warn(`[Collapsible] ${name}: 要素が見つかりません`, {
                header: !!header,
                content: !!content
            });
            return false;
        }

        console.info(`[Collapsible] ${name}: 初期化開始`);

        // クリックイベントハンドラーを定義
        const clickHandler = (e) => {
            console.info(`[Collapsible] ${name}: クリックイベント発火`, e.target);

            // collapsed クラスをトグル
            const wasCollapsed = content.classList.contains('collapsed');
            content.classList.toggle('collapsed');
            header.classList.toggle('collapsed');

            // ローカルストレージに状態を保存
            const isCollapsed = content.classList.contains('collapsed');
            const storageKey = `${name}SettingsCollapsed`;
            localStorage.setItem(storageKey, isCollapsed);
            console.info(
                `[Collapsible] ${name}: 状態変更`,
                wasCollapsed ? '折りたたみ→展開' : '展開→折りたたみ'
            );
        };

        // 既存のイベントリスナーを削除（存在する場合）
        if (config.clickHandler) {
            header.removeEventListener('click', config.clickHandler);
        }

        // 新しいイベントリスナーを追加
        header.addEventListener('click', clickHandler, { passive: false });
        config.clickHandler = clickHandler;
        console.info(`[Collapsible] ${name}: イベントリスナー登録完了`);

        // ページ読み込み時に前回の状態を復元
        const storageKey = `${name}SettingsCollapsed`;
        const savedState = localStorage.getItem(storageKey);
        const shouldCollapse =
            savedState !== null ? savedState === 'true' : config.defaultCollapsed;

        if (shouldCollapse) {
            content.classList.add('collapsed');
            header.classList.add('collapsed');
            console.info(`[Collapsible] ${name}: 初期状態 -> 折りたたみ`);
        } else {
            content.classList.remove('collapsed');
            header.classList.remove('collapsed');
            console.info(`[Collapsible] ${name}: 初期状態 -> 展開`);
        }

        return true;
    }

    /**
     * デバッグ用: セクションをテスト
     * @param {string} name - セクション名
     */
    testSection(name) {
        const config = this.sections.get(name);
        if (!config) {
            console.error('[Collapsible Test] 不明なセクション:', name);
            console.info(
                '[Collapsible Test] 利用可能なセクション:',
                Array.from(this.sections.keys())
            );
            return;
        }

        const header = document.getElementById(config.headerId);
        const content = document.getElementById(config.contentId);

        console.info('[Collapsible Test] セクション:', name);
        console.info('[Collapsible Test] ヘッダー:', header);
        console.info('[Collapsible Test] コンテンツ:', content);
        console.info('[Collapsible Test] ヘッダークラス:', header?.className);
        console.info('[Collapsible Test] コンテンツクラス:', content?.className);

        if (header) {
            console.info('[Collapsible Test] クリックイベントを発火');
            header.click();
        }
    }
}

// グローバルな折りたたみマネージャーを作成
const collapsibleManager = new CollapsibleManager();

// セクションを登録
collapsibleManager.registerSection(
    'advanced',
    'advancedSettingsHeader',
    'advancedSettingsContent',
    true
);
collapsibleManager.registerSection(
    'language',
    'languageSettingsHeader',
    'languageSettingsContent',
    false
);

// ====================
// アプリケーション起動
// ====================
document.addEventListener('DOMContentLoaded', () => {
    globalThis.window.app = new VoiceTranslateApp();

    // ✅ 修正: 折りたたみ機能を初期化（即座に実行）
    console.info('[Collapsible] DOMContentLoaded: 初期化開始');
    const initialSuccess = collapsibleManager.initializeAll();

    if (initialSuccess === 0) {
        console.warn('[Collapsible] DOMContentLoaded: 初期化失敗、再試行をスケジュール');
    }

    // ✅ 修正: 複数のタイミングで再試行（初期化されていないセクションのみ）
    setTimeout(() => {
        console.info('[Collapsible] 500ms後に再試行');
        const retrySuccess = collapsibleManager.initializeAll();
        if (retrySuccess > 0) {
            console.info('[Collapsible] 500ms後の再試行で成功');
        }
    }, 500);

    setTimeout(() => {
        console.info('[Collapsible] 1500ms後に再試行');
        const retrySuccess = collapsibleManager.initializeAll();
        if (retrySuccess > 0) {
            console.info('[Collapsible] 1500ms後の再試行で成功');
        }
    }, 1500);

    // デバッグ用関数をグローバルに公開
    globalThis.window.testCollapsible = (sectionName) => {
        collapsibleManager.testSection(sectionName);
    };

    console.info(
        '[UI] デバッグ関数を公開: window.testCollapsible("advanced") または window.testCollapsible("language")'
    );
});

// 拡張機能用のエクスポート
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VoiceTranslateApp, CONFIG, Utils, VoiceActivityDetector };
}
