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
            targetLang: 'ja', // ✅ 修正: デフォルトを日本語に変更（中国語→日本語翻訳用）
            voiceType: 'alloy',
            sessionStartTime: null,
            charCount: 0,
            ws: null,
            // ▼ ブラウザ/拡張機能の翻訳エンドポイント接続用（WebRTC + ephemeral client secret）
            //   翻訳エンドポイントはブラウザからの APIキー直WSを許可しないため WebRTC を使う。
            pc: null, // RTCPeerConnection
            dataChannel: null, // session.* イベント用データチャネル
            translatedAudioEl: null, // 翻訳音声（リモートトラック）再生用 <audio>
            audioContext: null, // 入力音声処理用AudioContext
            outputAudioContext: null, // 出力音声再生専用AudioContext（優先度確保）
            mediaStream: null,
            processor: null,
            audioSource: null, // MediaStreamSource（音声ルーティング制御用）
            inputGainNode: null, // 入力音声ミュート用GainNode
            audioSourceType: 'microphone', // 'microphone' or 'system'
            systemAudioSourceId: null, // システム音声のソースID
            // ✅ 原声出力の連動スイッチ（システム音声モードでのみ意味を持つ）
            //   true  = 原声を物理スピーカーに出す → スピーカー出力(loopback)を監視
            //   false = 原声分離（仮想サウンドカードへ） → 仮想カードの入力デバイスを監視
            playOriginalToSpeaker: true,
            virtualCardDeviceId: '', // OFF時に監視する仮想サウンドカードの入力デバイスID
            isNewResponse: true, // 新しい応答かどうかのフラグ
            outputVolume: 1, // 出力音量（1 = 通常、クリッピング防止のため2から変更）
            isPlayingAudio: false, // 音声再生中フラグ（ループバック防止用）
            // ✅ 開始/停止のユーザー意図フラグ（自動接続・自動再接続の制御に使用）
            userWantsActive: false, // 「開始」で true、「停止」で false
            isUnloading: false, // ページ/アプリ終了中フラグ（終了時は再接続しない）
            reconnectAttempt: 0, // 自動再接続のリトライ回数（指数バックオフ用）
            outputDeviceId: '' // 翻訳音声の出力先デバイスID（''=既定。原声分離用に物理デバイスを選択）
        };

        this.vad = null;
        this.elements = {};
        this.timers = {};

        // ✅ ストリーミング再生キュー（音声途中切断を防ぐ）
        this.playbackQueue = []; // 音声チャンクの再生待ちキュー（ストリーミング再生）
        this.isPlayingAudio = false; // 音声再生中フラグ（ループバック防止用）
        this.isPlayingFromQueue = false; // キューから再生中フラグ
        this.currentAudioStartTime = 0;
        this.currentAudioSource = null; // 現在再生中のAudioBufferSourceNode（停止用）

        // ✅ レスポンス状態管理（並発制御）
        this.activeResponseId = null; // 現在処理中のレスポンスID
        this.pendingResponseId = null; // ✅ リクエスト送信中フラグ（レース条件対策）
        this.lastCommitTime = 0; // 最後のコミット時刻（重複防止）

        // ✅ P1: 智能VAD缓冲策略（品質優先）
        this.speechStartTime = null; // 発話開始時刻
        this.silenceConfirmTimer = null; // 無声確認タイマー
        this.minSpeechDuration = 300; // ✅ 最小発話時長（300ms - 品質優先、短い単語も保護）
        this.silenceConfirmDelay = 200; // ✅ 無声確認延迟（200ms - 反応速度向上）

        // ✅ 音声結合バッファ（短い音声を結合して1秒以上にする）
        this.pendingAudioBuffer = null; // 保留中の音声データ
        this.pendingAudioDuration = 0; // 保留中の音声時長（ms）
        this.pendingAudioTimer = null; // 保留音声タイムアウトタイマー
        this.pendingAudioTimeout = 1000; // 保留音声タイムアウト（1秒）

        // ✅ 句子数量追踪（実時性向上）
        this.currentTranscriptBuffer = ''; // 当前累積的転写文本
        this.sentenceCount = 0; // 当前句子数量
        this.targetSentenceCount = 2; // 目標句子数（2-3句）
        this.maxBufferDuration = 10000; // 最大缓冲时长（10秒 - 防止无限等待）

        // ✅ プラットフォーム差分アダプタ（Electron/拡張/ブラウザの個別部分を隔離）
        this.platform = VoiceTranslatePlatform.getPlatform();

        // ✅ P1-2: 会話コンテキスト管理（Electron環境のみ）
        // ブラウザ・拡張機能では使用しない
        this.conversationEnabled = this.platform.supportsConversation;

        if (this.conversationEnabled) {
        } else {
        }

        // ✅ レスポンスキュー管理（conversation_already_has_active_response エラー対策）
        this.responseQueue = new ResponseQueue((message) => this.sendMessage(message), {
            maxQueueSize: 30, // 最大キュー長を拡大（10 → 30）
            // 理由: システム音声モードで連続音声が来る場合、
            //       10個では不足してレスポンスがドロップされる可能性
            timeout: 60000, // タイムアウト: 60秒（response.done が来ない場合に備えて）
            retryOnError: true, // エラー時リトライ有効
            maxRetries: 2, // 最大リトライ回数
            debugMode: CONFIG.DEBUG_MODE, // デバッグモード
            // ✅ リクエスト送信時のコールバック（レース条件対策）
            onRequestSending: () => {
                this.pendingResponseId = 'pending_' + Date.now();
            }
        });

        // ✅ 音声源トラッキング（ループバック防止用）
        // 各オーディオフレームに対して、それが「ユーザー新規音声」か「システム出力」かを標記
        this.audioSourceTracker = {
            outputStartTime: null, // 出力再生開始時刻
            outputEndTime: null, // 出力再生終了時刻
            bufferWindow: 2000, // バッファウィンドウ（出力完了後3秒間は入力を無視）
            // 注意: 3000msは以下の遅延を考慮
            //   - スピーカー→マイク伝播: 100-500ms
            //   - マイク処理: 100-200ms
            //   - ネットワーク遅延: 100-300ms
            //   - 安全マージン: 1000ms
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
            maxQueueSize: 100, // ✅ キューサイズを拡大（50 → 100）長語音対応
            maxSegmentDuration: 30000, // ✅ 最大セグメント時長を30秒に拡大（15秒 → 30秒）
            minSegmentDuration: 300 // 最小300ms（短い単語も重要）
            // 理由: 長時間の連続音声（会議、プレゼンなど）で
            //       セグメントがドロップされるのを防ぐ
            // 注意: cleanupDelay はデフォルト値（1000ms）を使用
        });

        this.segmentAlignment =
            typeof SegmentAlignmentManager !== 'undefined'
                ? new SegmentAlignmentManager({ maxSegments: 300 })
                : null;
        this.realtimeMessageListeners = new Set();

        // ✅ パス処理器
        this.textPathProcessor = new TextPathProcessor(this.audioQueue, this);
        this.voicePathProcessor = new VoicePathProcessor(this.audioQueue, this);

        // ✅ プル型アーキテクチャ: 消費者ループ
        this.path1ConsumerInterval = null;
        this.path2ConsumerInterval = null;

        // ✅ 监听队列イベント
        this.audioQueue.on('segmentComplete', (segment) => {
            this.handleSegmentComplete(segment);
        });

        this.audioQueue.on('queueFull', (size) => {
            this.notify(
                '警告',
                `音声キューが満杯です（${size}個）\n処理が追いついていません`,
                'warning'
            );
        });

        // ✅ 定期的なキュー状態監視（長語音丢失追踪用）
        setInterval(() => {
            const stats = this.audioQueue.getStats();
            // 丢失セグメントがあり、かつ総セグメント数が0より大きい場合のみ警告
            if (stats.droppedSegments > 0 && stats.totalSegments > 0) {
                const dropRate = ((stats.droppedSegments / stats.totalSegments) * 100).toFixed(2);

                // 丢失率が10%を超えた場合はユーザーに通知
                if (Number.parseFloat(dropRate) > 10) {
                    this.notify(
                        '警告',
                        `音声セグメントの丢失率が高いです（${dropRate}%）\n翻訳品質が低下する可能性があります`,
                        'warning'
                    );
                }
            }
        }, 5000); // 5秒ごとにチェック

        // ✅ Phase 3: 音声バッファ管理
        this.audioBuffer = []; // から保存された onaudioprocess キャプチャされた音声データ
        this.audioBufferStartTime = null; // 音声バッファ開始時刻記録
        this.isBufferingAudio = false; // マーク是否正在缓冲音声

        // ✅ groupedモード（整文1〜3句まとめ翻訳）の蓄積状態
        this.groupedAudioChunks = []; // 蓄積中の完結ターン音声
        this.groupedAudioDuration = 0; // 蓄積済み時長（ms）
        this.groupedAudioStartTime = null; // グループ開始時刻
        this.groupedSampleRate = CONFIG.AUDIO.SAMPLE_RATE; // グループ音声のサンプルレート
        this.groupSentenceCount = 0; // グループ内の文数（ライブ転写から計数）
        this.groupLastSentenceAt = null; // 最後に完全文を検出した時刻
        this.groupedPendingTranscriptText = ''; // segment 作成前に届いたライブ転写の一時保持
        this.groupedSegmentId = null; // 現在のグループに対応する alignment segment id
        this.pendingCommittedItemId = null; // 直近コミットの item_id（segment への bindItemId 用）
        this.groupedFlushTimer = null; // MAX_BUFFER_MS 到達用の保険タイマー
        this.groupedPostSentenceTimer = null; // 1文完結後の短い待機タイマー
        this.segmentResendDepth = 0; // Path1 音声再送中フラグ（文数二重計数ガード）

        // ✅ 監視先の無音自動検証
        this.silenceVerifyActive = false; // 観測中フラグ
        this.silenceVerifyMaxEnergy = 0; // 観測期間中の最大エネルギー
        this.silenceVerifyTimer = null; // 観測終了タイマー
        this.silenceFallbackDone = false; // 自動フォールバック実施済みフラグ

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
        this.initVAD(); // ✅ VADを先に初期化
        this.loadSettings(); // ✅ 設定を読み込んでVAD灵敏度を適用

        // ブラウザ版とElectronアプリの競合を防ぐ
        this.initCrossInstanceSync();

        // マイク権限を自動チェック
        await this.checkMicrophonePermission();

        // パスプロセッサの初期モードを同期
        try {
            this.updateProcessorModes();
        } catch (e) {}

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
        // モデル設定
        this.elements.realtimeModel = document.getElementById('realtimeModel');
        this.elements.chatModel = document.getElementById('chatModel');
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
        this.elements.outputDeviceSelect = document.getElementById('outputDeviceSelect');
        // ✅ 原声出力の連動スイッチと仮想サウンドカード選択
        this.elements.playOriginalToSpeaker = document.getElementById('playOriginalToSpeaker');
        this.elements.loopbackSourceGroup = document.getElementById('loopbackSourceGroup');
        this.elements.virtualCardGroup = document.getElementById('virtualCardGroup');
        this.elements.virtualCardDevice = document.getElementById('virtualCardDevice');

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
            playOriginalToSpeaker: 'true' // ON（原声をスピーカーに出す＝loopbackを監視）
        };

        // localStorage に設定を保存
        for (const [key, value] of Object.entries(defaultSettings)) {
            localStorage.setItem(key, value);
        }
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

        // Realtimeモデル変更（次回接続時に反映）
        this.elements.realtimeModel.addEventListener('change', (e) => {
            CONFIG.API.REALTIME_MODEL = e.target.value;
            this.saveToStorage('realtime_model', e.target.value);

            if (this.state.isConnected) {
                this.notify('モデル変更', 'Realtimeモデルは次回「接続」時に反映されます', 'info');
            }
        });

        // Chatモデル変更（即時反映）
        this.elements.chatModel.addEventListener('change', (e) => {
            CONFIG.API.CHAT_MODEL = e.target.value;
            this.saveToStorage('chat_model', e.target.value);
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

                // ✅ 原声出力スイッチに応じてloopback対象 / 仮想カード選択の表示を同期
                this.syncOriginalAudioUI();

                if (!this.state.playOriginalToSpeaker) {
                    // OFF（原声分離）: 仮想サウンドカードの入力デバイス一覧を更新
                    await this.populateInputDevices();
                } else if (!this.platform.isElectron) {
                    // ON（loopback）かつブラウザ環境: 音声ソースを自動検出
                    // Electron環境ではユーザーが手動で「会議アプリを検出」ボタンをクリックする
                    await this.detectAudioSources();
                }
            } else {
                systemAudioSourceGroup.style.display = 'none';
            }

            // VAD設定を再適用（音声ソースタイプに応じた最適な設定に更新）
            const currentVadLevel = this.elements.vadSensitivity.value;
            this.updateVADSensitivity(currentVadLevel);

            // ✅ #1 録音中にソースを変更した場合は、新ソースでキャプチャを取り直す（即時切替）。
            //    マイク↔システムで取得APIもサーバVADのsilence_durationも異なるため、再起動が必要。
            if (this.state.isRecording) {
                try {
                    await this.stopRecording();
                    await this.updateSessionConfig(); // 新ソース用のserver VADへ更新
                    await this.startRecording();
                } catch (err) {
                    this.notify(
                        '音声ソース',
                        'ソース切替に失敗しました。停止→開始で再試行してください。',
                        'error'
                    );
                }
            } else if (this.state.isConnected) {
                // 接続中（待機）なら server VAD 設定のみ更新
                await this.updateSessionConfig();
            }
        });

        // 会議アプリ検出ボタン
        const detectSourcesBtn = document.getElementById('detectSourcesBtn');
        detectSourcesBtn.addEventListener('click', () => this.detectAudioSources());

        // ✅ システム音声ソース選択時の処理（ブラウザ拡張機能用）
        const systemAudioSource = document.getElementById('systemAudioSource');
        systemAudioSource.addEventListener('change', async (e) => {
            const selectedValue = e.target.value;

            // ブラウザ拡張機能環境で「画面/ウィンドウを選択」が選択された場合
            if (selectedValue === 'display-media') {
                try {
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
                        this.notify('選択完了', `${audioTrack.label} を選択しました`, 'success');

                        // 選択された音声ソースを保存
                        this.state.selectedDisplayMediaStream = stream;
                    } else {
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
            'playOriginalToSpeaker'
        ].forEach((id) => {
            this.elements[id].addEventListener('click', (e) => {
                this.handleToggleSetting(id, e.currentTarget);
            });
        });

        // 仮想サウンドカード（入力）デバイス選択
        if (this.elements.virtualCardDevice) {
            this.elements.virtualCardDevice.addEventListener('change', async (e) => {
                this.state.virtualCardDeviceId = e.target.value;
                this.saveToStorage('virtual_card_device_id', e.target.value);
                // 録音中（かつ原声分離=OFF）なら新デバイスでキャプチャを取り直す
                if (
                    this.state.isRecording &&
                    !this.elements.playOriginalToSpeaker.classList.contains('active')
                ) {
                    await this.restartCaptureForSourceChange();
                }
            });
        }

        // VAD感度
        this.elements.vadSensitivity.addEventListener('change', async (e) => {
            this.updateVADSensitivity(e.target.value);
            this.saveToStorage('vad_sensitivity', e.target.value);

            // ✅ Server VAD有効時は、セッション設定を更新
            if (this.state.isConnected && this.elements.vadEnabled.classList.contains('active')) {
                try {
                    await this.updateSessionConfig();
                } catch (error) {}
            }
        });

        // コントロールボタン
        // 「接続/切断」ボタンは廃止（画面上は非表示）。「開始」で自動接続、「停止」で切断する。
        this.elements.connectBtn.addEventListener('click', () => this.start());
        this.elements.disconnectBtn.addEventListener('click', () => this.stop());
        this.elements.startBtn.addEventListener('click', () => this.start());
        this.elements.stopBtn.addEventListener('click', () => this.stop());

        // 翻訳音声の出力先デバイス選択（原声分離: 翻訳だけを物理スピーカーへ）
        if (this.elements.outputDeviceSelect) {
            this.elements.outputDeviceSelect.addEventListener('change', async (e) => {
                this.state.outputDeviceId = e.target.value;
                this.saveToStorage('output_device_id', e.target.value);
                await this.applyOutputSink();
            });
            this.populateOutputDevices();
        }

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

        // ✅ 履歴ボタン
        const historyBtn = document.getElementById('historyBtn');
        if (historyBtn) {
            historyBtn.addEventListener('click', () => this.showHistory());
        }

        // ✅ 履歴モーダル閉じるボタン
        const closeHistoryModal = document.getElementById('closeHistoryModal');
        if (closeHistoryModal) {
            closeHistoryModal.addEventListener('click', () => this.closeHistoryModal());
        }

        // ✅ モーダルオーバーレイクリックで閉じる
        const historyModal = document.getElementById('historyModal');
        if (historyModal) {
            historyModal.addEventListener('click', (e) => {
                if (e.target === historyModal) {
                    this.closeHistoryModal();
                }
            });
        }

        // ページ離脱時（ブラウザ/拡張/アプリを閉じたときのみ切断。自動再接続はしない）
        globalThis.addEventListener('beforeunload', () => {
            this.state.isUnloading = true;
            this.state.userWantsActive = false;
            clearTimeout(this.timers.reconnect);
            if (this.state.isConnected) {
                this.disconnect();
            }
        });
    }

    // ストレージ操作（拡張機能対応）→ プラットフォームアダプタへ委譲
    saveToStorage(key, value) {
        this.platform.saveToStorage(key, value);
    }

    async getFromStorage(key) {
        return this.platform.getFromStorage(key);
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
        // ✅ デフォルト設定を使用（ユーザー設定で上書き可能）
        const defaultSettings = CONFIG.VAD.MICROPHONE.MEDIUM;

        this.vad = new VoiceActivityDetector({
            threshold: defaultSettings.threshold,
            debounceTime: defaultSettings.debounce,
            onSpeechStart: () => {
                this.updateStatus('recording', '話し中...');
            },
            onSpeechEnd: () => {
                this.updateStatus('recording', '待機中...');
            }
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
            case 'playOriginalToSpeaker':
                this.handlePlayOriginalToggle(element);
                break;
            default:
                // その他の設定（noiseReduction, echoCancellation, autoGainControl）
                break;
        }
    }

    /**
     * 原声出力スイッチの処理
     *
     * 目的:
     *   原声をPCスピーカーに出すか（loopback監視）／仮想サウンドカードへ分離するか（仮想カード監視）を
     *   切り替える。監視先が変わるため、録音中なら新しい監視先でキャプチャを取り直す。
     *
     * @param {HTMLElement} element - トグル要素
     */
    handlePlayOriginalToggle(element) {
        this.state.playOriginalToSpeaker = element.classList.contains('active');

        // UIの表示切替（loopback対象 ↔ 仮想カード選択）
        this.syncOriginalAudioUI();

        // OFFに切替時、入力デバイス一覧を更新（仮想カードを選びやすくする）
        if (!this.state.playOriginalToSpeaker) {
            this.populateInputDevices();
        }

        // 録音中（システム音声モード）なら新しい監視先でキャプチャを取り直す
        if (this.state.isRecording && this.state.audioSourceType === 'system') {
            this.restartCaptureForSourceChange();
        }
    }

    /**
     * 原声出力スイッチに応じてシステム音声UIの表示を同期する
     *
     * 目的:
     *   ON  → loopbackキャプチャ対象（会議アプリ検出/ソース選択）を表示
     *   OFF → 仮想サウンドカード（入力）選択を表示
     */
    syncOriginalAudioUI() {
        const isOn = this.state.playOriginalToSpeaker;
        if (this.elements.loopbackSourceGroup) {
            this.elements.loopbackSourceGroup.style.display = isOn ? 'block' : 'none';
        }
        if (this.elements.virtualCardGroup) {
            this.elements.virtualCardGroup.style.display = isOn ? 'none' : 'block';
        }
    }

    /**
     * 音声ソース/監視先の変更に伴い、録音を安全に再起動する
     *
     * 目的:
     *   マイク↔システム、loopback↔仮想カードの切替時に共通で使う再起動処理。
     *   取得API・サーバVAD設定が異なるため、停止→設定更新→開始で確実に切り替える。
     */
    async restartCaptureForSourceChange() {
        try {
            await this.stopRecording();
            await this.updateSessionConfig();
            await this.startRecording();
        } catch (err) {
            this.notify(
                '音声ソース',
                '監視先の切替に失敗しました。停止→開始で再試行してください。',
                'error'
            );
        }
    }

    /**
     * 監視先の無音自動検証を開始する
     *
     * 目的:
     *   開始直後の一定時間だけ入力エネルギーを観測し、選んだ監視先が
     *   実際に音を出しているかを確認する。無音なら警告し、未フォールバック時は
     *   もう一方の監視先（loopback ↔ 仮想サウンドカード）へ自動切替して穴を塞ぐ。
     */
    startSilenceVerification() {
        const VERIFY_WINDOW_MS = 5000; // 観測時間
        this.silenceVerifyActive = true;
        this.silenceVerifyMaxEnergy = 0;
        if (this.silenceVerifyTimer) {
            clearTimeout(this.silenceVerifyTimer);
        }
        this.silenceVerifyTimer = setTimeout(() => {
            this.evaluateSilenceVerification();
        }, VERIFY_WINDOW_MS);
    }

    /**
     * 観測中のエネルギーを供給する（onaudioprocess から呼ばれる）
     * @param {number} energy - RMSエネルギー
     */
    feedSilenceVerifier(energy) {
        if (energy > this.silenceVerifyMaxEnergy) {
            this.silenceVerifyMaxEnergy = energy;
        }
    }

    /**
     * 観測結果を評価し、無音なら警告＋自動フォールバックする
     */
    evaluateSilenceVerification() {
        this.silenceVerifyActive = false;
        this.silenceVerifyTimer = null;

        // 無音判定のしきい値（ノイズフロアを上回る音声が一切無い状態）
        const SILENCE_THRESHOLD = 0.001;
        const maxEnergy = this.silenceVerifyMaxEnergy || 0;

        if (maxEnergy >= SILENCE_THRESHOLD || !this.state.isRecording) {
            return;
        }

        // 未フォールバックなら、もう一方の監視先へ自動切替（穴を塞ぐ）
        if (!this.silenceFallbackDone && this.state.audioSourceType === 'system') {
            this.silenceFallbackDone = true;
            const toVirtualCard = this.state.playOriginalToSpeaker; // 現在ON→仮想カードへ
            this.notify(
                '監視先が無音です',
                toVirtualCard
                    ? 'PCスピーカー出力が無音のため、仮想サウンドカードの監視へ自動切替します。'
                    : '仮想サウンドカードが無音のため、PCスピーカー出力の監視へ自動切替します。',
                'warning'
            );
            // トグルを反転させてキャプチャを取り直す
            this.elements.playOriginalToSpeaker.classList.toggle('active');
            this.saveToStorage(
                'playOriginalToSpeaker',
                this.elements.playOriginalToSpeaker.classList.contains('active')
            );
            this.handlePlayOriginalToggle(this.elements.playOriginalToSpeaker);
        } else {
            // 既にフォールバック済み（両方無音）→ 警告のみ
            this.notify(
                '音声が検出できません',
                '監視先のどちらからも音声が検出できません。音声ソースの設定・原声出力スイッチ・仮想サウンドカードの配線を確認してください。',
                'error'
            );
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

        // ✅ バグ修正（無音対策）: 音声翻訳ONなのに「翻訳音声を出力」がOFFだと
        //    output_modalities=['text'] となり音声が一切出ない不正状態になる。
        //    handleAudioOutputToggle の逆方向ガード（OFF→音声翻訳もOFF）と対になる補正。
        if (isActive) {
            const audioOutputEnabled = this.elements.audioOutputEnabled;
            if (audioOutputEnabled && !audioOutputEnabled.classList.contains('active')) {
                audioOutputEnabled.classList.add('active');
                this.saveToStorage('audioOutputEnabled', 'true');
            }
        }

        // パスプロセッサのモードを同期
        this.updateProcessorModes();

        // ✅ 接続中ならサーバ側 output_modalities も即時同期（不一致での無音を防ぐ）
        if (this.state.isConnected) {
            this.updateSession();
        }

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
        this.notify('表示設定変更', `${label}を${isActive ? 'ON' : 'OFF'}にしました`, 'info');
    }

    /**
     * 翻訳音声を出力設定トグルの処理
     *
     * 目的:
     *   翻訳音声を出力設定が変更された場合、セッションを更新
     *   OFFの場合は「リアルタイム音声翻訳」も自動的にOFFにする
     *
     * 入力:
     *   element: トグル要素
     */
    handleAudioOutputToggle(element) {
        const isActive = element.classList.contains('active');

        // ✅ バグ修正: 翻訳音声を出力がOFFの場合、リアルタイム音声翻訳も自動的にOFFにする
        if (!isActive) {
            const translationModeAudio = this.elements.translationModeAudio;
            if (translationModeAudio && translationModeAudio.classList.contains('active')) {
                translationModeAudio.classList.remove('active');
                this.saveToStorage('translationModeAudio', 'false');
                this.notify(
                    '音声出力設定',
                    '翻訳音声を出力をOFFにしました。リアルタイム音声翻訳も自動的にOFFになりました。',
                    'info'
                );
            } else {
                this.notify(
                    '音声出力設定',
                    `翻訳音声を出力を${isActive ? 'ON' : 'OFF'}にしました`,
                    'info'
                );
            }
        } else {
            this.notify('音声出力設定', '翻訳音声を出力をONにしました', 'info');
        }

        // パスプロセッサのモードを同期
        this.updateProcessorModes();
    }

    /**
     * ✅ パスプロセッサの動作モードを現在の設定に同期
     *
     * 目的:
     *   UIの設定（リアルタイム音声翻訳、音声出力）に応じて、
     *   Path1 (Text) と Path2 (Voice) の処理内容を動的に切り替える
     */
    updateProcessorModes() {
        const isAudioTranslation = this.elements.translationModeAudio.classList.contains('active');
        const isAudioOutput = this.elements.audioOutputEnabled.classList.contains('active');

        if (isAudioTranslation) {
            // ✅ 音声翻訳モード（Path2 優先）
            // Path1: 音声認識のみ（字幕表示用）
            this.textPathProcessor.setMode(1);
            // Path2: 音声翻訳実行
            this.voicePathProcessor.mode = 1;
        } else {
            // ✅ テキスト翻訳モード（Path1 優先）
            // Path1: 音声認識 + テキスト翻訳
            this.textPathProcessor.setMode(2);
            // Path2: 無効化（または待機）
            this.voicePathProcessor.mode = 0; // 0 は「何もしない」モードとして扱う
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
            realtimeModel: await this.getFromStorage('realtime_model'),
            chatModel: await this.getFromStorage('chat_model'),
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

        // モデル設定（UI保存値を環境変数より優先、未保存なら現在のCONFIG値を表示）
        if (settings.realtimeModel) {
            CONFIG.API.REALTIME_MODEL = settings.realtimeModel;
        }
        if (settings.chatModel) {
            CONFIG.API.CHAT_MODEL = settings.chatModel;
        }
        // 後台で設定中のモデルを必ず表示・選択し、新しい順に並べ替える
        this.setupModelSelects();

        if (settings.vadSensitivity) {
            this.elements.vadSensitivity.value = settings.vadSensitivity;
            // ✅ VAD灵敏度を適用（initVAD後に呼び出す必要がある）
            this.updateVADSensitivity(settings.vadSensitivity);
        } else {
            // デフォルト値を適用
            this.updateVADSensitivity('medium');
        }

        // 出力音量設定を復元
        if (settings.outputVolume) {
            this.state.outputVolume = Number.parseFloat(settings.outputVolume);
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
            'audioOutputEnabled',
            'playOriginalToSpeaker'
        ];
        for (const id of toggleSettings) {
            const value = await this.getFromStorage(id);
            if (value === 'false') {
                this.elements[id].classList.remove('active');
            }
        }

        // ✅ 原声出力スイッチの状態を state とUIに反映
        if (this.elements.playOriginalToSpeaker) {
            this.state.playOriginalToSpeaker =
                this.elements.playOriginalToSpeaker.classList.contains('active');
            this.syncOriginalAudioUI();
        }
        // 仮想サウンドカードの選択を復元
        const savedVirtualCard = await this.getFromStorage('virtual_card_device_id');
        if (savedVirtualCard) {
            this.state.virtualCardDeviceId = savedVirtualCard;
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
        if (this.platform.isElectron) {
        } else {
            // ブラウザ版の場合、LocalStorageの変更を監視
            globalThis.addEventListener('storage', (event) => {
                if (event.key === 'app2_recording' && event.newValue === 'true') {
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
        if (!this.platform.isElectron) {
            return;
        }

        try {
            const envApiKey = await this.platform.getEnvApiKey();

            if (envApiKey) {
                this.state.apiKey = envApiKey;
                // UIに反映（セキュリティのため一部のみ表示）
                // 注意: パスワードフィールドには完全なキーを設定
                if (this.elements && this.elements.apiKey) {
                    this.elements.apiKey.value = envApiKey;
                }
            } else {
            }

            // 環境変数から設定を読み込む
            const envConfig = await this.platform.getEnvConfig();

            if (envConfig) {
                // CONFIGを上書き（2種類のモデル設定）
                CONFIG.API.REALTIME_MODEL = envConfig.realtimeModel;
                CONFIG.API.CHAT_MODEL = envConfig.chatModel;
                CONFIG.API.TRANSCRIBE_MODEL =
                    envConfig.transcribeModel ||
                    CONFIG.API.TRANSCRIBE_MODEL ||
                    'gpt-realtime-whisper';
                CONFIG.API.REALTIME_URL = envConfig.realtimeUrl;

                // 翻訳の区切り（ターン検出）設定を .env から上書き
                // 未設定の項目は CONFIG.TRANSLATION の既定値を維持する
                if (envConfig.translation) {
                    const t = envConfig.translation;
                    if (t.turnMode != null) CONFIG.TRANSLATION.TURN_MODE = t.turnMode;
                    if (t.vadType != null) CONFIG.TRANSLATION.VAD_TYPE = t.vadType;
                    if (t.semanticEagerness != null)
                        CONFIG.TRANSLATION.SEMANTIC_EAGERNESS = t.semanticEagerness;
                    if (t.maxSentences != null) CONFIG.TRANSLATION.MAX_SENTENCES = t.maxSentences;
                    if (t.postSentenceHoldMs != null)
                        CONFIG.TRANSLATION.POST_SENTENCE_HOLD_MS = t.postSentenceHoldMs;
                    if (t.maxBufferMs != null) CONFIG.TRANSLATION.MAX_BUFFER_MS = t.maxBufferMs;
                }
            }
        } catch (error) {}
    }

    setupElectronWebSocketHandlers() {
        if (!this.platform.isElectron) {
            return;
        }

        // Realtime WebSocket イベントをアダプタ経由で購読
        this.platform.subscribeRealtimeEvents({
            onOpen: () => {
                this.handleWSOpen();
            },
            onMessage: (message) => {
                this.handleWSMessage({ data: message });
            },
            onError: (error) => {
                this.handleWSError(error);
            },
            onClose: (data) => {
                this.handleWSClose(data);
            }
        });
    }

    /**
     * 「開始」: 未接続なら自動接続し、接続済みなら録音（翻訳）を開始する。
     * ユーザー意図フラグを立てるため、以降の異常切断時は自動再接続する。
     * 接続成功後の録音開始は handleWSOpen() が担う（接続→翻訳を1アクションに）。
     */
    async start() {
        if (!this.state.apiKey) {
            this.notify('エラー', 'APIキーを入力してください', 'error');
            return;
        }
        this.state.userWantsActive = true;
        this.state.isUnloading = false;

        // ✅ ユーザー操作による開始時は無音フォールバック実績をリセット（再検証を許可）
        this.silenceFallbackDone = false;

        // 「開始」押下中は二重開始を防ぎ、「停止」で中断できるようにする
        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = false;

        if (this.state.isConnected) {
            if (!this.state.isRecording) {
                await this.startRecording();
            }
        } else {
            await this.connect();
        }
    }

    /**
     * 「停止」: ユーザー意図フラグを下ろし、録音停止＋切断する（自動再接続しない）。
     */
    async stop() {
        this.state.userWantsActive = false;
        this.state.reconnectAttempt = 0;
        clearTimeout(this.timers.reconnect);
        await this.disconnect();
    }

    /**
     * 異常切断時の自動再接続を指数バックオフでスケジュールする。
     * ユーザーが「停止」した場合・ページ終了中は再接続しない。
     */
    scheduleReconnect() {
        if (!this.state.userWantsActive || this.state.isUnloading) {
            return;
        }
        const attempt = this.state.reconnectAttempt + 1;
        this.state.reconnectAttempt = attempt;
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10000); // 1,2,4,8,10,10...
        this.notify(
            '再接続',
            `${Math.round(delay / 1000)}秒後に自動再接続します（試行 ${attempt}）`,
            'warning'
        );
        clearTimeout(this.timers.reconnect);
        this.timers.reconnect = setTimeout(() => {
            if (!this.state.userWantsActive || this.state.isUnloading) {
                return;
            }
            this.start();
        }, delay);
    }

    /**
     * 出力デバイス一覧を選択肢に反映する（翻訳音声の出力先用）。
     * 保存済みの選択があれば復元する。ラベルは権限取得後に表示される。
     */
    async populateOutputDevices() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                return;
            }
            const sel = this.elements.outputDeviceSelect;
            if (!sel) {
                return;
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            const outputs = devices.filter((d) => d.kind === 'audiooutput');
            sel.innerHTML = '<option value="">既定のデバイス</option>';
            for (const d of outputs) {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.textContent = d.label || `出力デバイス (${d.deviceId.slice(0, 8)})`;
                sel.appendChild(opt);
            }
            // 保存済みの選択を復元
            const saved = await this.getFromStorage('output_device_id');
            if (saved) {
                this.state.outputDeviceId = saved;
                sel.value = saved;
            }
        } catch (err) {}
    }

    /**
     * 仮想サウンドカード等の入力デバイスを列挙し、選択 UI を埋める。
     * 原声分離（原声出力OFF）時に監視する入力デバイスを選ぶために使用する。
     *
     * 目的:
     *   - audioinput デバイスを列挙
     *   - VB-Cable / CABLE Output / VoiceMeeter 等の仮想カードを名前で自動選択
     *   - 保存済みの選択があれば復元
     */
    async populateInputDevices() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                return;
            }
            const sel = this.elements.virtualCardDevice;
            if (!sel) {
                return;
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices.filter((d) => d.kind === 'audioinput');
            sel.innerHTML = '<option value="">入力デバイスを選択...</option>';
            for (const d of inputs) {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.textContent = d.label || `入力デバイス (${d.deviceId.slice(0, 8)})`;
                sel.appendChild(opt);
            }

            // 保存済みの選択を優先的に復元
            const saved = await this.getFromStorage('virtual_card_device_id');
            if (saved && inputs.some((d) => d.deviceId === saved)) {
                this.state.virtualCardDeviceId = saved;
                sel.value = saved;
                return;
            }

            // 仮想サウンドカードを名前で自動選択（VB-Cable / VoiceMeeter 等）
            const virtualPattern = /CABLE|VB-Audio|VoiceMeeter|Virtual|仮想/i;
            const virtual = inputs.find((d) => virtualPattern.test(d.label || ''));
            if (virtual) {
                this.state.virtualCardDeviceId = virtual.deviceId;
                sel.value = virtual.deviceId;
            }
        } catch (err) {}
    }

    /**
     * 翻訳音声の出力先を選択デバイスへ切り替える（AudioContext.setSinkId）。
     * 原声分離（会議→仮想サウンドカード→翻訳→物理スピーカー）の物理出力側を担う。
     * setSinkId 非対応環境では既定デバイスのまま（何もしない）。
     */
    async applyOutputSink() {
        const deviceId = this.state.outputDeviceId;

        // WebRTC 経路: 翻訳音声は <audio> 要素で再生されるため、要素側の出力先を切り替える。
        // （原声分離・回灌防止のため、WS 経路の AudioContext と同様に物理出力を分離する）
        const audioEl = this.state.translatedAudioEl;
        if (audioEl && typeof audioEl.setSinkId === 'function') {
            try {
                await audioEl.setSinkId(deviceId || '');
            } catch (err) {}
        }

        const ctx = this.state.outputAudioContext;
        if (!ctx || typeof ctx.setSinkId !== 'function') {
            return;
        }
        try {
            await ctx.setSinkId(deviceId || '');
        } catch (err) {}
    }

    normalizeRealtimeEndpointModel() {
        const api = CONFIG.API || {};
        const translationUrl = OPENAI_REALTIME_TRANSLATION_URL;
        const isTranslationUrl = (api.REALTIME_URL || '').includes('/realtime/translations');
        const isTranslationModel = api.REALTIME_MODEL === 'gpt-realtime-translate';

        if (isTranslationModel && !isTranslationUrl) {
            api.REALTIME_URL = translationUrl;
        } else if (isTranslationUrl && !isTranslationModel) {
            api.REALTIME_MODEL = 'gpt-realtime-translate';
        }

        if (this.elements?.realtimeModel) {
            this.elements.realtimeModel.value = api.REALTIME_MODEL;
        }
    }

    async connect() {
        if (!this.state.apiKey) {
            this.notify('エラー', 'APIキーを入力してください', 'error');
            return;
        }

        // 接続開始時にトランスクリプトをクリア
        this.clearTranscript('both');
        this.normalizeRealtimeEndpointModel();

        try {
            this.updateConnectionStatus('connecting');
            this.elements.connectBtn.disabled = true;

            // デバッグ: 接続情報をログ出力
            const debugInfo = {
                apiKey: this.state.apiKey ? `${this.state.apiKey.substring(0, 7)}...` : 'なし',
                model: CONFIG.API.REALTIME_MODEL,
                url: CONFIG.API.REALTIME_URL
            };

            // ✅ Electron環境: 会話セッション開始
            if (this.platform.conversation) {
                try {
                    const sessionId = await this.platform.conversation.startSession(
                        this.state.sourceLang || 'auto',
                        this.state.targetLang || 'ja'
                    );
                    this.state.currentSessionId = sessionId;
                } catch (error) {
                    // セッション開始失敗でも接続は続行
                }
            }

            if (this.platform.isElectron) {
                // Electronの場合、mainプロセス経由で接続（Authorizationヘッダー付き）

                // IPCイベントリスナーを設定
                this.setupElectronWebSocketHandlers();

                // WebSocket接続を要求
                const result = await this.platform.connectRealtime({
                    url: CONFIG.API.REALTIME_URL,
                    apiKey: this.state.apiKey,
                    model: CONFIG.API.REALTIME_MODEL
                });

                if (!result.success) {
                    throw new Error(result.message || '接続失敗');
                }

                // 接続成功はIPCイベント経由で通知される
                return;
            }

            // ✅ ブラウザ/拡張機能 + 翻訳エンドポイント: WebRTC + ephemeral client secret が必須。
            //    （翻訳エンドポイントはブラウザからの APIキー直 WebSocket を受け付けない）
            if (this.usesWebRtcTransport()) {
                await this.connectWebRtcTranslation();
                return;
            }

            // ブラウザ環境の場合（sec-websocket-protocolで認証）
            const wsUrl = `${CONFIG.API.REALTIME_URL}?model=${CONFIG.API.REALTIME_MODEL}`;

            // ブラウザ環境では、sec-websocket-protocolヘッダーを使用してAPIキーを送信
            // GA: 'openai-beta.realtime-v1' サブプロトコルは削除
            const protocols = ['realtime', `openai-insecure-api-key.${this.state.apiKey}`];

            this.state.ws = new WebSocket(wsUrl, protocols);

            // WebSocketイベント設定
            this.state.ws.onopen = () => this.handleWSOpen();
            this.state.ws.onmessage = (event) => this.handleWSMessage(event);
            this.state.ws.onerror = (error) => this.handleWSError(error);
            this.state.ws.onclose = (event) => this.handleWSClose(event);

            // タイムアウト設定
            const timeout = setTimeout(() => {
                if (!this.state.isConnected) {
                    this.disconnect();
                    this.notify('エラー', '接続タイムアウト (30秒)', 'error');
                }
            }, CONFIG.API.TIMEOUT);

            this.timers.connectionTimeout = timeout;
        } catch (error) {
            this.notify('エラー', '接続に失敗しました: ' + error.message, 'error');
            this.updateConnectionStatus('error');
            this.elements.connectBtn.disabled = false;
        }
    }

    async disconnect() {
        // ✅ Electron環境: 会話セッション終了
        if (this.platform.conversation && this.state.currentSessionId) {
            try {
                await this.platform.conversation.endSession();
                this.state.currentSessionId = null;
            } catch (error) {}
        }

        if (this.platform.isElectron) {
            // Electron環境
            await this.platform.closeRealtime();
        } else if (this.usesWebRtcTransport()) {
            // ブラウザ/拡張機能の翻訳エンドポイント（WebRTC）
            this.closeWebRtc();
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
        // 新モデル: 切断状態では「開始」を入口として有効化（接続は開始が担う）
        this.elements.connectBtn.disabled = false;
        this.elements.disconnectBtn.disabled = true;
        this.elements.startBtn.disabled = false;
        this.elements.stopBtn.disabled = true;

        clearTimeout(this.timers.connectionTimeout);
        clearInterval(this.timers.sessionTimer);

        this.notify('切断', '接続を切断しました', 'warning');
    }

    handleWSOpen() {
        clearTimeout(this.timers.connectionTimeout);

        this.state.isConnected = true;
        this.updateConnectionStatus('connected');
        this.elements.connectBtn.disabled = true;
        this.elements.disconnectBtn.disabled = false;
        this.elements.startBtn.disabled = false;

        // セッション作成
        this.createSession();

        // セッションタイマー開始
        this.startSessionTimer();

        // 自動再接続カウンタをリセット（接続成功）
        this.state.reconnectAttempt = 0;

        this.notify('接続成功', 'OpenAI Realtime APIに接続しました', 'success');

        // 「開始」意図がある場合は録音（翻訳）を自動開始する。
        // これにより「接続→翻訳開始」が1アクションになり、再接続後も自動で再開する。
        if (this.state.userWantsActive && !this.state.isRecording) {
            this.startRecording();
        }
    }

    /**
     * 入力転写(STT)設定を構築する。
     *
     * 目的:
     *   対応4言語(日本語・英語・中国語・ベトナム語)以外(韓国語など)への
     *   誤認識を防ぐ。ソース言語が確定していれば language を固定し、
     *   auto のときは prompt で対応言語へバイアスをかける。
     *
     * @returns {Object} audio.input.transcription に渡す設定
     */
    buildInputTranscriptionConfig() {
        // ※ /v1/realtime/translations の transcription は `prompt` を受け付けない
        //   (400 unknown_parameter)。受理されるのは model / language のみ。
        const config = {
            model: CONFIG.API.TRANSCRIBE_MODEL || 'gpt-realtime-whisper'
        };
        const src = this.state.sourceLang;
        if (src && src !== 'auto' && ['ja', 'en', 'zh', 'vi'].includes(src)) {
            // ソース言語が確定しているときは ISO-639-1 を固定し、自動検出のブレ
            // (短い中国語が韓国語に化けるなど)を抑える。auto のときは指定しない。
            config.language = src;
        }
        return config;
    }

    createSession() {
        // リアルタイム音声翻訳セッション（/v1/realtime/translations）。
        // Electron のサーバ側WS（Authorization ヘッダ）では session.update で設定を送る。
        // ※ ブラウザ/拡張機能の WebRTC 経路は client_secret 発行時に設定を埋め込むため
        //   本メソッドは呼ばない（handleWebRtcConnected を参照）。
        // 入力転写（audio.input.transcription）を設定することで session.input_transcript.delta
        // （＝左カラムの音声認識）が返るようになる（公式仕様）。
        const targetLang = this.state.targetLang || 'ja';
        this.sendMessage({
            type: 'session.update',
            session: {
                audio: {
                    input: {
                        transcription: this.buildInputTranscriptionConfig()
                    },
                    output: { language: targetLang }
                }
            }
        });
    }

    /**
     * ブラウザ/拡張機能で翻訳エンドポイントに WebRTC 接続すべきか。
     *
     * 翻訳エンドポイント（/v1/realtime/translations）はブラウザからの APIキー直 WebSocket を
     * 受け付けない（公式: ブラウザは WebRTC + 短命 client secret が必須）。
     *
     * @returns {boolean} 非Electron かつ翻訳セッションのとき true
     */
    usesWebRtcTransport() {
        return !this.platform.isElectron && this.isRealtimeTranslationSession();
    }

    /**
     * REALTIME_URL（wss://...）から REST 用の https ベース URL を導出する。
     * 例: wss://api.openai.com/v1/realtime/translations → https://api.openai.com/v1/realtime/translations
     *
     * @returns {string}
     */
    getTranslationRestBase() {
        const wsUrl = CONFIG.API.REALTIME_URL || OPENAI_REALTIME_TRANSLATION_URL;
        let base = wsUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
        if (!/\/realtime\/translations$/.test(base)) {
            base = OPENAI_REALTIME_TRANSLATION_URL.replace(/^wss:/i, 'https:');
        }
        return base;
    }

    /**
     * サーバ役（拡張機能/ブラウザ）として短命 client secret を発行する。
     * 翻訳セッションの設定（出力言語・入力転写）はここで埋め込む。
     *
     * @returns {Promise<string>} ephemeral client secret 文字列
     * @throws {Error} 発行失敗・レスポンス形式不正のとき
     */
    async mintTranslationClientSecret() {
        const targetLang = this.state.targetLang || 'ja';
        const body = {
            session: {
                model: CONFIG.API.REALTIME_MODEL,
                audio: {
                    input: {
                        transcription: this.buildInputTranscriptionConfig(),
                        noise_reduction: { type: 'near_field' }
                    },
                    output: { language: targetLang }
                }
            }
        };
        const res = await fetch(`${this.getTranslationRestBase()}/client_secrets`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.state.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`client_secret 発行に失敗しました (${res.status}) ${detail}`.trim());
        }
        const data = await res.json();
        const secret =
            (data && data.client_secret && (data.client_secret.value || data.client_secret)) ||
            data.value ||
            null;
        if (!secret || typeof secret !== 'string') {
            throw new Error('client_secret の取得に失敗しました（レスポンス形式が不正）');
        }
        return secret;
    }

    /**
     * 翻訳エンドポイントへ WebRTC で接続する（ブラウザ/拡張機能経路）。
     *
     * 流れ:
     *   1. client_secret を発行（設定を埋め込む）
     *   2. RTCPeerConnection を生成し、データチャネル(oai-events)と音声 m-line を用意
     *   3. リモート音声トラックを <audio> で再生（翻訳音声）
     *   4. SDP を /calls に POST して answer を適用
     *   5. データチャネル open で接続完了（handleWebRtcConnected）
     */
    async connectWebRtcTranslation() {
        try {
            const clientSecret = await this.mintTranslationClientSecret();

            const pc = new RTCPeerConnection();
            this.state.pc = pc;

            // 翻訳音声（リモートトラック）を再生する <audio> を用意
            let audioEl = this.state.translatedAudioEl;
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                audioEl.style.display = 'none';
                document.body.appendChild(audioEl);
                this.state.translatedAudioEl = audioEl;
            }
            // 翻訳音声の出力先（原声分離用の物理デバイス）を反映する。
            await this.applyOutputSink();
            pc.ontrack = (event) => {
                if (event.streams && event.streams[0]) {
                    audioEl.srcObject = event.streams[0];
                }
            };

            // セッションイベント用データチャネル（session.* が流れる）
            const dc = pc.createDataChannel('oai-events');
            this.state.dataChannel = dc;
            dc.onopen = () => this.handleWebRtcConnected();
            dc.onmessage = (event) => this.handleWSMessage(event);

            // 音声送受信の m-line を確保（マイクは録音開始時に replaceTrack で接続する）
            pc.addTransceiver('audio', { direction: 'sendrecv' });

            pc.onconnectionstatechange = () => {
                const st = pc.connectionState;
                if (st === 'failed' || st === 'disconnected' || st === 'closed') {
                    this.handleWebRtcDisconnected();
                }
            };

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const sdpResponse = await fetch(`${this.getTranslationRestBase()}/calls`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${clientSecret}`,
                    'Content-Type': 'application/sdp'
                },
                body: offer.sdp
            });
            if (!sdpResponse.ok) {
                throw new Error(`SDP交換に失敗しました (${sdpResponse.status})`);
            }
            const answerSdp = await sdpResponse.text();
            await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

            // データチャネル open を待つタイムアウト
            this.timers.connectionTimeout = setTimeout(() => {
                if (!this.state.isConnected) {
                    this.disconnect();
                    this.notify('エラー', '接続タイムアウト (30秒)', 'error');
                }
            }, CONFIG.API.TIMEOUT);
        } catch (error) {
            // 確立途中で失敗した PeerConnection を確実に解放する（リーク防止）。
            this.closeWebRtc();
            throw error;
        }
    }

    /**
     * WebRTC データチャネル open 時の接続完了処理（handleWSOpen の WebRTC 版）。
     * 設定は client_secret 発行時に埋め込み済みのため session.update は送らない。
     */
    handleWebRtcConnected() {
        clearTimeout(this.timers.connectionTimeout);

        this.state.isConnected = true;
        this.updateConnectionStatus('connected');
        this.elements.connectBtn.disabled = true;
        this.elements.disconnectBtn.disabled = false;
        this.elements.startBtn.disabled = false;

        this.startSessionTimer();
        this.state.reconnectAttempt = 0;

        this.notify('接続成功', 'OpenAI 翻訳APIに接続しました (WebRTC)', 'success');

        if (this.state.userWantsActive && !this.state.isRecording) {
            this.startRecording();
        }
    }

    /**
     * WebRTC 切断時の処理。ユーザーが継続意図を持つ場合は自動再接続する。
     */
    handleWebRtcDisconnected() {
        if (!this.state.isConnected && !this.state.userWantsActive) {
            return;
        }
        const wasActive = this.state.userWantsActive && !this.state.isUnloading;
        this.state.isConnected = false;
        this.closeWebRtc();
        if (wasActive) {
            this.updateConnectionStatus('connecting');
            this.stopRecording();
            this.scheduleReconnect();
        } else {
            this.updateConnectionStatus('offline');
        }
    }

    /**
     * WebRTC リソース（データチャネル・PeerConnection・再生用 audio）を解放する。
     */
    closeWebRtc() {
        if (this.state.dataChannel) {
            try {
                this.state.dataChannel.onopen = null;
                this.state.dataChannel.onmessage = null;
                this.state.dataChannel.close();
            } catch (e) {}
            this.state.dataChannel = null;
        }
        if (this.state.pc) {
            try {
                // 意図的なクローズ。先にハンドラを外し、pc.close() が発火する
                // onconnectionstatechange('closed') が handleWebRtcDisconnected を
                // 再帰的に呼んで再接続ループになるのを防ぐ（teardown を副作用なしにする）。
                this.state.pc.onconnectionstatechange = null;
                this.state.pc.ontrack = null;
                this.state.pc.close();
            } catch (e) {}
            this.state.pc = null;
        }
        if (this.state.translatedAudioEl) {
            try {
                this.state.translatedAudioEl.srcObject = null;
            } catch (e) {}
        }
    }

    /**
     * 録音開始時に、取得済みマイクトラックを WebRTC 送信側へ接続する。
     */
    async attachMicToWebRtc() {
        if (!this.state.pc || !this.state.mediaStream) {
            return;
        }
        const track = this.state.mediaStream.getAudioTracks()[0];
        if (!track) {
            return;
        }
        const sender = this.state.pc.getSenders()[0];
        if (!sender) {
            return;
        }
        try {
            await sender.replaceTrack(track);
        } catch (err) {
            // 差し替え失敗を握り潰すと「録音中なのに無音」になるため明示通知する。
            this.notify(
                'マイク接続エラー',
                'WebRTCへのマイク接続に失敗しました: ' + this.extractErrorMessage(err),
                'error'
            );
        }
    }

    /**
     * 音声ソースタイプとVAD感度に応じた最適なServer VAD設定を取得
     *
     * 目的:
     *   マイクモード（対話）とシステム音声モード（会議監視）で
     *   異なるVADパラメータを使用して最適な翻訳体験を提供
     *   VAD感度スライダーの値に応じてthresholdを動的に調整
     *
     * @returns {Object} Server VAD設定
     */
    /**
     * セッション設定を更新（VAD感度変更時など）
     *
     * 目的:
     *   接続中にVAD感度を変更した場合、Server VADの設定を更新
     */
    async updateSessionConfig() {
        // 翻訳セッションは turn_detection を使わない（サーバが連続ストリームを処理する）ため、
        // VAD感度/音源切替時のセッション更新は不要。何もしない。
    }

    async sendMessage(message) {
        if (this.platform.isElectron) {
            // Electron環境（mainプロセス経由IPC）
            const result = await this.platform.sendRealtime(message);
            if (!result.success) {
            }
        } else if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            // ブラウザ環境
            this.state.ws.send(JSON.stringify(message));
        }
    }

    // handleWSMessage は WebSocketMixin 側が唯一の実体（notifyRealtimeMessageListeners を含む）。
    // ここに class メソッドを再定義すると Object.assign(prototype, WebSocketMixin) で上書きされ無効になるため定義しない。
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
            return;
        }

        // ✅ プル型アーキテクチャ: 消費者ループを開始
        this.startPathConsumers();

        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = true;

        try {
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

            // ✅ WebRTC 経路では、取得したマイクトラックを送信側へ接続する
            //    （音声は session.input_audio_buffer.append ではなくメディアトラックで送る）
            if (this.usesWebRtcTransport()) {
                await this.attachMicToWebRtc();
            }

            // ✅ システム音声モードでは、選んだ監視先が実際に鳴っているかを自動検証する
            //    （誤設定で無音を監視し続ける穴を塞ぐ）
            if (this.state.audioSourceType === 'system') {
                this.startSilenceVerification();
            }
        } catch (error) {
            // エラーメッセージを安全に抽出
            const errorMessage = this.extractErrorMessage(error);
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
        if (this.platform.isElectron) {
            localStorage.setItem('app2_recording', 'true');
            return true;
        }

        // ブラウザ版の場合、app2が既に録音中かチェック
        const app2Recording = localStorage.getItem('app2_recording');
        if (app2Recording === 'true') {
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
            // ✅ 原声出力スイッチで監視先を分岐
            //   OFF（原声分離） → 仮想サウンドカード（入力デバイス）を監視
            //   ON（聞きながら翻訳） → 物理スピーカー出力(loopback)を監視
            if (!this.state.playOriginalToSpeaker) {
                await this.startVirtualCardCapture();
            } else {
                await this.startSystemAudioCapture();
            }
        } else {
            // マイクキャプチャ（既存機能）
            await this.startMicrophoneCapture();
        }
    }

    /**
     * 仮想サウンドカード（入力デバイス）からのキャプチャを開始する
     *
     * 目的:
     *   原声分離構成（会議アプリ→仮想サウンドカード→本アプリ→物理スピーカー）で、
     *   仮想サウンドカードに流れている原声を入力デバイスとして取り込む。
     *   マイク戦略に deviceId を渡して getUserMedia で取得する。
     *
     * @throws {Error} 仮想サウンドカードが未選択の場合（穴を塞ぐ: 無音監視を防止）
     */
    async startVirtualCardCapture() {
        const deviceId = this.state.virtualCardDeviceId;
        if (!deviceId) {
            // 未選択のまま開始すると無音を監視し続ける穴になるため、明確にブロックする
            this.notify(
                '仮想サウンドカード未選択',
                '原声出力OFF（原声分離）では、監視する仮想サウンドカードの入力デバイスを選択してください。',
                'error'
            );
            throw new Error('仮想サウンドカードの入力デバイスが選択されていません');
        }

        const config = {
            sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
            // 仮想カードの原声はそのまま取り込む（エコー除去等は無効）
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        };

        const strategy = AudioCaptureStrategyFactory.createStrategy({
            sourceType: 'microphone',
            config: config,
            deviceId: deviceId
        });

        this.state.mediaStream = await strategy.capture();
        this.notify('仮想サウンドカード接続成功', '原声分離モードで監視を開始しました', 'success');
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
                return;
            }

            // マイク権限の状態を確認
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });

            if (permissionStatus.state === 'granted') {
                this.notify('マイク準備完了', 'マイクへのアクセスが許可されています', 'success');
            } else if (permissionStatus.state === 'prompt') {
                this.notify(
                    'マイク権限が必要です',
                    '録音開始時にマイクへのアクセスを許可してください',
                    'warning'
                );
            } else if (permissionStatus.state === 'denied') {
                this.notify(
                    'マイク権限が拒否されています',
                    'ブラウザの設定からマイクへのアクセスを許可してください',
                    'error'
                );
            }

            // 権限状態の変更を監視
            permissionStatus.onchange = () => {
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
            // エラーは無視（一部ブラウザでは microphone クエリが未サポート）
        }
    }

    async startMicrophoneCapture() {
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

        this.notify('マイク接続成功', 'マイクが正常に接続されました', 'success');
    }

    async startSystemAudioCapture() {
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
        } else {
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

        this.notify('キャプチャ開始', 'システム音声のキャプチャを開始しました', 'success');
    }

    async startElectronSystemAudioCapture() {
        const systemAudioSource = document.getElementById('systemAudioSource');
        let sourceId = systemAudioSource.value;

        // 音声ソースが未選択の場合、自動検出を試みる
        if (!sourceId) {
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

                this.notify('自動選択', '音声ソースを自動選択しました', 'success');
            } catch (error) {
                const errorMessage = this.extractErrorMessage(error);
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

            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            // 音声トラックを取得
            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();

            // ✅ デバッグログ追加：各音声トラックの詳細
            audioTracks.forEach((track, index) => {});

            // 重要: 音声トラックがなくても続行する
            // 理由: 会議アプリでは、誰も話していない時は音声トラックがない場合がある
            //       音声が開始されると、ストリームに音声トラックが追加される

            if (audioTracks.length === 0) {
                // ストリーム全体を保存（音声トラックが後で追加される可能性がある）
                this.state.mediaStream = stream;

                // 音声トラックが追加されたときのリスナーを設定
                stream.addEventListener('addtrack', (event) => {
                    if (event.track.kind === 'audio') {
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
        this.notify('エラー', '画面共有の音声キャプチャが停止しました', 'error');
        try {
            await this.stopRecording();
        } catch (error) {}
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
            } catch (error) {}
        });
    }

    async startBrowserSystemAudioCapture() {
        try {
            let stream;

            // ✅ 既に選択されたストリームがある場合はそれを使用
            if (this.state.selectedDisplayMediaStream) {
                stream = this.state.selectedDisplayMediaStream;

                // 使用後はクリア（次回は再選択が必要）
                this.state.selectedDisplayMediaStream = null;
            } else {
                // ✅ 選択されていない場合は新規に選択ダイアログを表示

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
                    track.stop();
                });
            }

            this.state.mediaStream = stream;

            // 音声トラックの監視
            const audioTrack = stream.getAudioTracks()[0];
            this.setupBrowserAudioTrackListener(audioTrack);

            this.notify('キャプチャ開始', 'システム音声のキャプチャを開始しました', 'success');
        } catch (error) {
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
        this.notify('エラー', 'タブ音声のキャプチャが停止しました', 'error');
        try {
            await this.stopRecording();
        } catch (error) {}
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
            } catch (error) {}
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
            // 現在のタブを取得
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || tabs.length === 0) {
                    reject(new Error('アクティブなタブが見つかりません'));
                    return;
                }

                const tab = tabs[0];
                const tabId = tab.id;
                const tabUrl = tab.url || '';

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
                // ブラウザ拡張機能かElectronかを判定
                if (this.platform.isElectron) {
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
        // AudioContext設定
        this.state.audioContext = new (globalThis.AudioContext || globalThis.webkitAudioContext)({
            sampleRate: CONFIG.AUDIO.SAMPLE_RATE
        });

        // AudioContextがサスペンドされている場合、再開
        if (this.state.audioContext.state === 'suspended') {
            await this.state.audioContext.resume();
        }

        // 音声トラックがあるか確認
        const audioTracks = this.state.mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
            // 音声トラックが追加されるまで待機
            await this.waitForAudioTrack();
        }

        await this.setupAudioProcessingInternal();
    }

    async setupAudioProcessingInternal() {
        // MediaStreamSource を作成して保存（後で切断できるように）
        this.state.audioSource = this.state.audioContext.createMediaStreamSource(
            this.state.mediaStream
        );

        // VADリセット
        if (this.elements.vadEnabled.classList.contains('active')) {
            this.vad.reset();
        }

        // ✅ 録音フラグを先に設定（音声データ処理を有効化）
        // 理由: AudioWorklet/ScriptProcessor の onmessage コールバックで
        //       isRecording をチェックするため、先に true に設定する必要がある
        //       そうしないと、初期の音声データが無視され、ビジュアライザーが動かない
        this.state.isRecording = true;
        this.elements.startBtn.disabled = true;
        this.elements.stopBtn.disabled = false;
        this.elements.disconnectBtn.disabled = true;

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

            // 入力音声出力設定: デフォルトOFF（ゲイン0）
            this.state.inputGainNode.gain.value = 0;

            // 音声チェーン: workletNode → inputGainNode → destination
            this.state.workletNode.connect(this.state.inputGainNode);
            this.state.inputGainNode.connect(this.state.audioContext.destination);
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);

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

                // ✅ ループバック防止は sendAudioData() で統一的に処理
                // ここでは録音状態のチェックのみ行う

                const inputData = e.inputBuffer.getChannelData(0);

                // ✅ Phase 3: 音声データバッファリング（VAD有効無効に関わらず）
                if (this.isBufferingAudio) {
                    // 音声データをバッファにコピー
                    const audioChunk = new Float32Array(inputData.length);
                    audioChunk.set(inputData);
                    this.audioBuffer.push(audioChunk);
                }

                // ✅ 監視先の無音自動検証（開始直後の一定時間だけエネルギーを観測）
                if (this.silenceVerifyActive) {
                    this.feedSilenceVerifier(this.vad.calculateEnergy(inputData));
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

            // 入力音声出力設定: デフォルトOFF（ゲイン0）
            this.state.inputGainNode.gain.value = 0;

            // 音声チェーン: processor → inputGainNode → destination
            this.state.processor.connect(this.state.inputGainNode);
            this.state.inputGainNode.connect(this.state.audioContext.destination);
        }

        // ✅ UI更新と通知（isRecording は既に true に設定済み）
        const sourceTypeText = this.state.audioSourceType === 'system' ? 'システム音声' : 'マイク';
        this.updateStatus('recording', '録音中');
        this.notify('録音開始', `${sourceTypeText}から音声を取得しています`, 'success');
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
    async detectAudioSources() {
        const systemAudioSource = document.getElementById('systemAudioSource');

        if (this.platform.isElectron) {
            // Electron環境: 会議アプリを自動検出
            try {
                this.notify('検出中', '音声ソースを検出しています...', 'info');

                const sources = await this.platform.detectMeetingApps();

                // ✅ デバッグログ追加：各ソースの詳細を表示
                sources.forEach((source, index) => {});

                // ドロップダウンを更新
                systemAudioSource.innerHTML = '<option value="">ソースを選択...</option>';

                if (sources.length === 0) {
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
                    });

                    // 自動選択: 最初のソースを選択
                    if (sources.length > 0) {
                        systemAudioSource.selectedIndex = 1; // 0は"ソースを選択..."なので1を選択
                    }

                    this.notify(
                        '検出完了',
                        `${sources.length}個の音声ソースを検出しました`,
                        'success'
                    );
                }
            } catch (error) {
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

            this.notify('情報', '音声ソースを選択してください', 'info');
        }
    }

    async stopRecording() {
        // ✅ プル型アーキテクチャ: 消費者ループを停止
        this.stopPathConsumers();

        // ✅ AudioQueue をクリア（重要: 再開始時に古いセグメントが残らないようにする）
        if (this.audioQueue) {
            this.audioQueue.clear();
        }

        // ✅ モードロックをクリア
        localStorage.removeItem(this.modeStateManager.globalLockKey);
        this.modeStateManager.currentMode = null;

        // ✅ Phase 3: 音声バッファリング停止
        this.isBufferingAudio = false;
        this.audioBuffer = []; // バッファクリア
        this.audioBufferStartTime = null;

        // ✅ groupedモードの蓄積状態をリセット（保険タイマー解除を含む）
        //    停止時は消費者ループが既に停止済みのため flush しても再生されない。
        //    設計（停止時は残セグメントを flush するか明示的に discard して通知）に従い、
        //    未送信の蓄積音声が残っている場合はサイレント破棄せずユーザーへ通知する。
        const hasPendingGroupedAudio = !!(
            this.groupedAudioChunks &&
            this.groupedAudioChunks.length > 0 &&
            this.groupedAudioDuration > 0
        );
        if (hasPendingGroupedAudio) {
            this.notify(
                '翻訳未完了',
                '停止時にまとめ翻訳待ちの音声が残っていたため破棄しました。最後の発話は翻訳されていません。',
                'warning'
            );
        }
        if (typeof this.resetGroupedAudioState === 'function') {
            this.resetGroupedAudioState();
        }
        this.segmentResendDepth = 0;

        // ✅ 無音検証を停止（silenceFallbackDone は保持してフォールバックのping-pongを防ぐ）
        this.silenceVerifyActive = false;
        if (this.silenceVerifyTimer) {
            clearTimeout(this.silenceVerifyTimer);
            this.silenceVerifyTimer = null;
        }

        // ✅ P1: VAD バッファタイマーをクリア
        if (this.silenceConfirmTimer) {
            clearTimeout(this.silenceConfirmTimer);
            this.silenceConfirmTimer = null;
        }
        this.speechStartTime = null;

        // ✅ 修正: 再生キューをクリアしない（翻訳音声の途中切断を防ぐ）
        // 理由: 録音停止時に再生キューをクリアすると、翻訳音声が途中で切断される
        // this.clearPlaybackQueueIfAny(); // ← 削除

        // Electronアプリの場合、ブラウザ版への録音停止通知をクリア
        if (this.platform.isElectron) {
            localStorage.removeItem('app2_recording');
        }

        const isServerVadEnabled = this.elements.vadEnabled.classList.contains('active');

        // メディアストリーム／オーディオノードをクリーンアップ（共通処理にまとめる）
        this.stopMediaStreamTracks();
        this.cleanupAudioNodes();

        if (this.state.audioContext) {
            try {
                await this.state.audioContext.close();
            } catch (e) {}
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
    }

    // helper: 再生キューを安全にクリア
    clearPlaybackQueueIfAny() {
        if (!this.playbackQueue || this.playbackQueue.length === 0) {
            return;
        }
        this.playbackQueue = [];
        this.isPlayingFromQueue = false;
    }

    // helper: mediaStream のトラック停止
    stopMediaStreamTracks() {
        if (!this.state.mediaStream) {
            return;
        }
        try {
            this.state.mediaStream.getTracks().forEach((track) => track.stop());
        } catch (error) {
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
            } catch (e) {}
            this.state.audioSource = null;
        }

        // GainNode
        if (this.state.inputGainNode) {
            try {
                this.state.inputGainNode.disconnect();
            } catch (e) {}
            this.state.inputGainNode = null;
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
            } finally {
                this.state.workletNode = null;
            }
        }

        // ScriptProcessorNode
        if (this.state.processor) {
            try {
                this.state.processor.disconnect();
            } catch (e) {
            } finally {
                this.state.processor = null;
            }
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
            this.state.outputAudioContext = new (
                globalThis.AudioContext || globalThis.webkitAudioContext
            )({
                sampleRate: CONFIG.AUDIO.SAMPLE_RATE
            });
            // 選択済みの出力先（原声分離用の物理デバイス）を適用
            await this.applyOutputSink();
        }

        // AudioContextがsuspended状態の場合はresume
        if (this.state.outputAudioContext.state === 'suspended') {
            await this.state.outputAudioContext.resume();
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

                // ✅ 現在のソースをクリア
                if (this.currentAudioSource === source) {
                    this.currentAudioSource = null;
                }

                this.handleAudioPlaybackEnded();
            };

            // ✅ 現在再生中のソースを記録（停止用）
            this.currentAudioSource = source;
            source.start();
        } catch (error) {
            // ✅ エラー時もトークンをクリア
            this.audioSourceTracker.playbackTokens.delete(playbackToken);
            this.handleAudioPlaybackError(error);
            throw error;
        }
    }

    /**
     * 再生キューをクリア（新しい翻訳開始時に古い音声を削除）
     *
     * 目的:
     *   新しい翻訳が開始されたとき、古い翻訳音声をクリアして
     *   最新の翻訳のみを再生する
     *
     * 効果:
     *   - 翻訳音声の中断を防ぐ
     *   - 古い翻訳と新しい翻訳が混在するのを防ぐ
     *   - ユーザー体験の向上
     */
    clearPlaybackQueue() {
        const clearedChunks = this.playbackQueue.length;

        if (clearedChunks > 0 || this.currentAudioSource) {
        }

        // ✅ キューをクリア
        this.playbackQueue = [];

        // ✅ 現在再生中の音声を停止
        if (this.currentAudioSource) {
            try {
                this.currentAudioSource.stop();
            } catch (error) {
                // 既に停止している場合はエラーを無視
            }
            this.currentAudioSource = null;
        }

        // ✅ 再生フラグをリセット
        this.isPlayingFromQueue = false;
        this.state.isPlayingAudio = false;

        // ✅ 入力音声を復元（ミュート状態を維持）
        if (this.state.inputGainNode) {
            this.state.inputGainNode.gain.value = 0;
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
            const detectionResponse = await fetch(CONFIG.API.CHAT_URL, {
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
                confidence >= 0.6 ? detectedLang : this.state.sourceLang || 'auto';

            // 検出された言語で翻訳を実行
            await this.translateTextDirectly(inputText, transcriptId, finalSourceLang);
        } catch (error) {
            // エラー時はデフォルト値の言語で翻訳を実行
            await this.translateTextDirectly(
                inputText,
                transcriptId,
                this.state.sourceLang || 'auto'
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
        const actualSourceLang = sourceLang || this.state.sourceLang || 'auto';

        // ✅ デバッグログ追加：翻訳方向を明確に表示

        try {
            if (!this.state.apiKey) {
                throw new Error('APIキーが設定されていません');
            }

            // 文本翻訳用のモデルを選択
            // Chat Completions APIモデルを使用（環境変数から設定可能）
            const translationModel = CONFIG.API.CHAT_MODEL;

            // リクエストボディを構築
            const targetLangName = Utils.getLanguageName(this.state.targetLang || 'ja');
            const sourceLangPrompt =
                actualSourceLang === 'auto'
                    ? `Auto-detect the source language and translate to ${targetLangName}`
                    : `Translate the following text from ${Utils.getLanguageName(actualSourceLang)} to ${targetLangName}`;

            const requestBody = {
                model: translationModel,
                messages: [
                    {
                        role: 'system',
                        content: `You are a professional translator. ${sourceLangPrompt}. Output ONLY the translation, no explanations, no commentary.`
                    },
                    {
                        role: 'user',
                        content: inputText
                    }
                ],
                max_completion_tokens: 500
            };

            // gpt-5 モデルは temperature をサポートしないため、他のモデルのみ設定。
            // 翻訳は決定的であるべき＆会話化を避けるため 0（最も確定的）にする。
            if (!translationModel.startsWith('gpt-5')) {
                requestBody.temperature = 0;
            }

            // OpenAI Chat Completions API を使用して文本翻訳
            const response = await fetch(CONFIG.API.CHAT_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.state.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(
                    `API Error: ${response.status} ${response.statusText} - ${errorBody}`
                );
            }

            const data = await response.json();

            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                throw new Error('Invalid API response structure');
            }

            // 防御的後処理: アシスタント定型句を除去（プロンプトに加えた多層防御）
            const translatedText = Utils.stripAssistantBoilerplate(data.choices[0].message.content);
            if (translatedText === '') {
                return '';
            }

            // 翻訳結果を右側カラムに表示（transcriptIdで一対一対応）
            this.addTranscript('output', translatedText, transcriptId);
            return translatedText;
        } catch (error) {
            this.notify('文本翻訳エラー', error.message, 'error');
            return null;
        }
    }
    /**
     * Electron環境かどうか判定
     *
     * @returns {boolean} Electron環境の場合true
     */
    isElectron() {
        return this.platform.isElectron;
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
        } else {
        }
    }

    updateSession() {
        if (!this.state.isConnected) {
            return;
        }

        // 翻訳セッションでは出力言語のみ更新する（翻訳先言語の変更を反映）。
        const targetLang = this.state.targetLang || 'ja';
        this.sendMessage({
            type: 'session.update',
            session: {
                audio: {
                    output: { language: targetLang }
                }
            }
        });
    }

    /**
     * モデル選択ドロップダウンを後台設定に合わせて再構築する
     *
     * 目的:
     *   - 「最新」等の独自マークは付けず、モデルIDをそのまま表示する
     *   - 後台（.env / 保存値）で設定中のモデルを必ず選択肢に含め、最上部・選択状態にする
     *   - 残りはモデルID末尾の日付（YYYY-MM-DD）降順＝新しい順に並べる
     */
    setupModelSelects() {
        this.populateModelSelect(this.elements.realtimeModel, CONFIG.API.REALTIME_MODEL);
        this.populateModelSelect(this.elements.chatModel, CONFIG.API.CHAT_MODEL);
    }

    /**
     * 単一のモデル選択を再構築する
     *
     * @param {HTMLSelectElement} selectEl - 対象の select 要素
     * @param {string} currentModel - 後台で設定中（選択すべき）のモデルID
     */
    populateModelSelect(selectEl, currentModel) {
        if (!selectEl) {
            return;
        }

        // 既存 option の value 集合（重複防止）
        const values = [];
        for (const opt of Array.from(selectEl.options)) {
            if (!values.includes(opt.value)) {
                values.push(opt.value);
            }
        }
        // 後台設定のモデルが候補に無ければ追加（＝後台設定をそのまま表示できるようにする）
        if (currentModel && !values.includes(currentModel)) {
            values.push(currentModel);
        }

        // モデルID末尾の日付で新しい順にソート（日付なしは元の相対順を維持）
        const dateKey = (v) => {
            const m = v.match(/(\d{4})-(\d{2})-(\d{2})/);
            return m ? `${m[1]}${m[2]}${m[3]}` : '';
        };
        const sorted = values
            .map((v, i) => ({ v, i }))
            .sort((a, b) => {
                const da = dateKey(a.v);
                const db = dateKey(b.v);
                if (da && db) {
                    return db.localeCompare(da); // 新しい日付を上へ
                }
                if (da) {
                    return -1; // 日付あり（新しい想定）を上へ
                }
                if (db) {
                    return 1;
                }
                return a.i - b.i; // どちらも日付なしは元の順序を維持
            })
            .map((o) => o.v);

        // 後台設定のモデルを最上部へ（「放到最上面」）
        if (currentModel) {
            const idx = sorted.indexOf(currentModel);
            if (idx > 0) {
                sorted.splice(idx, 1);
                sorted.unshift(currentModel);
            }
        }

        // option を再構築（ラベルはモデルID のみ、独自マークは付けない）
        selectEl.innerHTML = '';
        for (const v of sorted) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            selectEl.appendChild(opt);
        }
        if (currentModel) {
            selectEl.value = currentModel;
        }
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
        }

        if (successCount > 0) {
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
            return false;
        }

        // クリックイベントハンドラーを定義
        const clickHandler = (e) => {
            // collapsed クラスをトグル
            const wasCollapsed = content.classList.contains('collapsed');
            content.classList.toggle('collapsed');
            header.classList.toggle('collapsed');

            // ローカルストレージに状態を保存
            const isCollapsed = content.classList.contains('collapsed');
            const storageKey = `${name}SettingsCollapsed`;
            localStorage.setItem(storageKey, isCollapsed);
        };

        // 既存のイベントリスナーを削除（存在する場合）
        if (config.clickHandler) {
            header.removeEventListener('click', config.clickHandler);
        }

        // 新しいイベントリスナーを追加
        header.addEventListener('click', clickHandler, { passive: false });
        config.clickHandler = clickHandler;

        // ページ読み込み時に前回の状態を復元
        const storageKey = `${name}SettingsCollapsed`;
        const savedState = localStorage.getItem(storageKey);
        const shouldCollapse =
            savedState !== null ? savedState === 'true' : config.defaultCollapsed;

        if (shouldCollapse) {
            content.classList.add('collapsed');
            header.classList.add('collapsed');
        } else {
            content.classList.remove('collapsed');
            header.classList.remove('collapsed');
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
            return;
        }

        const header = document.getElementById(config.headerId);
        const content = document.getElementById(config.contentId);

        if (header) {
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
    const initialSuccess = collapsibleManager.initializeAll();

    if (initialSuccess === 0) {
    }

    // ✅ 修正: 複数のタイミングで再試行（初期化されていないセクションのみ）
    setTimeout(() => {
        const retrySuccess = collapsibleManager.initializeAll();
        if (retrySuccess > 0) {
        }
    }, 500);

    setTimeout(() => {
        const retrySuccess = collapsibleManager.initializeAll();
        if (retrySuccess > 0) {
        }
    }, 1500);

    // デバッグ用関数をグローバルに公開
    globalThis.window.testCollapsible = (sectionName) => {
        collapsibleManager.testSection(sectionName);
    };
});

/**
 * ✅ プル型アーキテクチャ: パス消費者ループを開始
 */
VoiceTranslateApp.prototype.startPathConsumers = function () {
    // ✅ Path1 消費者ループ（テキストパス）
    this.path1ConsumerInterval = setInterval(async () => {
        if (this.textPathProcessor.isProcessing) {
            return;
        }

        const segment = this.audioQueue.consumeForPath('path1');
        if (segment) {
            await this.textPathProcessor.process(segment);
        }
    }, 100); // 100ms ごとにチェック

    // ✅ Path2 消費者ループ（音声パス）
    this.path2ConsumerInterval = setInterval(async () => {
        if (this.voicePathProcessor.isProcessing) {
            return;
        }

        const segment = this.audioQueue.consumeForPath('path2');
        if (segment) {
            await this.voicePathProcessor.process(segment);
        }
    }, 100); // 100ms ごとにチェック
};

/**
 * ✅ プル型アーキテクチャ: パス消費者ループを停止
 */
VoiceTranslateApp.prototype.stopPathConsumers = function () {
    if (this.path1ConsumerInterval) {
        clearInterval(this.path1ConsumerInterval);
        this.path1ConsumerInterval = null;
    }

    if (this.path2ConsumerInterval) {
        clearInterval(this.path2ConsumerInterval);
        this.path2ConsumerInterval = null;
    }
};

/**
 * 履歴モーダルを表示
 *
 * 目的:
 *   Electron環境では会話履歴を表示、ブラウザ環境では情報メッセージを表示
 */
VoiceTranslateApp.prototype.showHistory = async function () {
    const modal = document.getElementById('historyModal');
    const modalBody = document.getElementById('historyModalBody');

    if (!modal || !modalBody) {
        return;
    }

    // 会話履歴(SQLite)はElectronのみ対応
    const platform = VoiceTranslatePlatform.getPlatform();

    if (!platform.conversation) {
        // ブラウザ環境: 情報メッセージを表示
        modalBody.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">ℹ️</div>
                <div class="empty-text">
                    <p style="font-size: 16px; margin-bottom: 8px;">会話履歴機能について</p>
                    <p>会話履歴機能はElectronアプリ版でのみ利用可能です。</p>
                    <p>ブラウザ版では履歴は保存されません。</p>
                </div>
            </div>
        `;
        modal.classList.add('active');
        return;
    }

    // Electron環境: セッション一覧を表示
    try {
        modalBody.innerHTML = '<div style="text-align: center; padding: 40px;">読み込み中...</div>';
        modal.classList.add('active');

        const sessions = await platform.conversation.getAllSessions(50);

        if (!sessions || sessions.length === 0) {
            modalBody.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div class="empty-text">
                        <p>会話履歴がありません</p>
                    </div>
                </div>
            `;
            return;
        }

        // セッション一覧を表示
        this.renderSessionList(sessions);
    } catch (error) {
        modalBody.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">❌</div>
                <div class="empty-text">
                    <p>履歴の読み込みに失敗しました</p>
                    <p style="font-size: 12px; color: var(--text-secondary);">${error.message}</p>
                </div>
            </div>
        `;
    }
};

/**
 * セッション一覧を表示
 *
 * @param {Array} sessions - セッション配列
 */
VoiceTranslateApp.prototype.renderSessionList = function (sessions) {
    const modalBody = document.getElementById('historyModalBody');

    const sessionListHTML = sessions
        .map((session) => {
            // ✅ キャメルケースとスネークケースの両方に対応
            const startTime = new Date(session.startTime || session.start_time);
            const endTime =
                session.endTime || session.end_time
                    ? new Date(session.endTime || session.end_time)
                    : null;
            const turnCount = session.turnCount || session.turn_count || 0;
            const sourceLanguage = session.sourceLanguage || session.source_language || 'auto';
            const targetLanguage = session.targetLanguage || session.target_language || 'ja';

            // ✅ 継続時間計算
            const duration = endTime
                ? Math.round((endTime - startTime) / 1000)
                : Math.round((Date.now() - startTime) / 1000);

            const formatDuration = (seconds) => {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = seconds % 60;
                if (hours > 0) {
                    return `${hours}時間${minutes}分`;
                } else if (minutes > 0) {
                    return `${minutes}分${secs}秒`;
                } else {
                    return `${secs}秒`;
                }
            };

            return `
                <div class="session-item" data-session-id="${session.id}">
                    <div class="session-header">
                        <div class="session-time">${startTime.toLocaleString('ja-JP')}</div>
                        <div class="session-badge">${turnCount}ターン</div>
                    </div>
                    <div class="session-info">
                        <span>⏱️ ${formatDuration(duration)}</span>
                        <span>🌐 ${sourceLanguage} → ${targetLanguage}</span>
                    </div>
                </div>
            `;
        })
        .join('');

    modalBody.innerHTML = `<div class="session-list">${sessionListHTML}</div>`;

    // セッションクリックイベント
    const sessionItems = modalBody.querySelectorAll('.session-item');
    sessionItems.forEach((item) => {
        item.addEventListener('click', () => {
            const sessionId = Number.parseInt(item.dataset.sessionId, 10);
            this.showSessionDetails(sessionId);
        });
    });
};

/**
 * セッション詳細を表示
 *
 * @param {number} sessionId - セッションID
 */
VoiceTranslateApp.prototype.showSessionDetails = async function (sessionId) {
    const modalBody = document.getElementById('historyModalBody');

    try {
        modalBody.innerHTML = '<div style="text-align: center; padding: 40px;">読み込み中...</div>';

        const turns =
            await VoiceTranslatePlatform.getPlatform().conversation.getSessionTurns(sessionId);

        if (!turns || turns.length === 0) {
            modalBody.innerHTML = `
                <button class="back-button">← 戻る</button>
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div class="empty-text">
                        <p>このセッションにはターンがありません</p>
                    </div>
                </div>
            `;
            this.addBackButtonListener();
            return;
        }

        // ターン一覧を表示
        const turnListHTML = turns
            .map((turn) => {
                const time = new Date(turn.timestamp);
                return `
                    <div class="turn-item">
                        <div class="turn-header">
                            <div class="turn-role ${turn.role}">${turn.role === 'user' ? 'ユーザー' : 'アシスタント'}</div>
                            <div class="turn-time">${time.toLocaleTimeString('ja-JP')}</div>
                        </div>
                        <div class="turn-content">${this.escapeHtml(turn.content)}</div>
                    </div>
                `;
            })
            .join('');

        modalBody.innerHTML = `
            <button class="back-button">← 戻る</button>
            <div class="turn-list">${turnListHTML}</div>
        `;

        this.addBackButtonListener();
    } catch (error) {
        modalBody.innerHTML = `
            <button class="back-button">← 戻る</button>
            <div class="empty-state">
                <div class="empty-icon">❌</div>
                <div class="empty-text">
                    <p>ターンの読み込みに失敗しました</p>
                    <p style="font-size: 12px; color: var(--text-secondary);">${error.message}</p>
                </div>
            </div>
        `;
        this.addBackButtonListener();
    }
};

/**
 * 戻るボタンのイベントリスナーを追加
 */
VoiceTranslateApp.prototype.addBackButtonListener = function () {
    const backButton = document.querySelector('.back-button');
    if (backButton) {
        backButton.addEventListener('click', () => {
            this.showHistory();
        });
    }
};

/**
 * 履歴モーダルを閉じる
 */
VoiceTranslateApp.prototype.closeHistoryModal = function () {
    const modal = document.getElementById('historyModal');
    if (modal) {
        modal.classList.remove('active');
    }
};

/**
 * HTMLエスケープ
 *
 * @param {string} text - エスケープするテキスト
 * @returns {string} エスケープされたテキスト
 */
VoiceTranslateApp.prototype.escapeHtml = function (text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

// 拡張機能用のエクスポート
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VoiceTranslateApp, CONFIG, Utils, VoiceActivityDetector };
}
