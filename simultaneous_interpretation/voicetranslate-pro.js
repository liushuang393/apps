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
            console.info('[Conversation] 会話管理機能が有効です（Electron環境）');
        } else {
            console.info('[Conversation] 会話管理機能は無効です（ブラウザ/拡張機能環境）');
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
            console.error('[AudioQueue] ========== キューが満杯 ==========');
            console.error('[AudioQueue] 現在のキューサイズ:', size);
            console.error('[AudioQueue] これ以上のセグメントは破棄されます！');
            console.error('[AudioQueue] 統計:', this.audioQueue.getStats());
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
                console.warn('[AudioQueue] ========== 丢失警告 ==========');
                console.warn('[AudioQueue] 累計丢失セグメント数:', stats.droppedSegments);
                console.warn('[AudioQueue] 現在のキューサイズ:', stats.currentQueueSize);
                console.warn('[AudioQueue] 処理済みセグメント:', stats.processedSegments);
                console.warn('[AudioQueue] 総セグメント数:', stats.totalSegments);
                console.warn('[AudioQueue] 丢失率:', dropRate + '%');

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

        console.info('[App] VoiceTranslate Pro v3.0 初期化完了');

        // パスプロセッサの初期モードを同期
        try {
            this.updateProcessorModes();
        } catch (e) {
            console.warn('[App] 初期プロセッサモードの同期に失敗しました:', e);
        }

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

        // Realtimeモデル変更（次回接続時に反映）
        this.elements.realtimeModel.addEventListener('change', (e) => {
            CONFIG.API.REALTIME_MODEL = e.target.value;
            this.saveToStorage('realtime_model', e.target.value);

            if (this.state.isConnected) {
                this.notify(
                    'モデル変更',
                    'Realtimeモデルは次回「接続」時に反映されます',
                    'info'
                );
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

            // ✅ #1 録音中にソースを変更した場合は、新ソースでキャプチャを取り直す（即時切替）。
            //    マイク↔システムで取得APIもサーバVADのsilence_durationも異なるため、再起動が必要。
            if (this.state.isRecording) {
                console.info('[Audio Source] 録音中のソース変更 → キャプチャを再起動します');
                try {
                    await this.stopRecording();
                    await this.updateSessionConfig(); // 新ソース用のserver VADへ更新
                    await this.startRecording();
                } catch (err) {
                    console.error('[Audio Source] ソース再起動エラー:', err);
                    this.notify('音声ソース', 'ソース切替に失敗しました。停止→開始で再試行してください。', 'error');
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
                if (this.state.isRecording && !this.elements.playOriginalToSpeaker.classList.contains('active')) {
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
                console.info('[VAD] Server VAD感度変更 - セッション設定を更新します');
                try {
                    await this.updateSessionConfig();
                } catch (error) {
                    console.error('[VAD] セッション設定更新失敗:', error);
                }
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
                console.info('[VAD] Speech started');
                this.updateStatus('recording', '話し中...');
            },
            onSpeechEnd: () => {
                console.info('[VAD] Speech ended');
                this.updateStatus('recording', '待機中...');
            }
        });
        console.info('[VAD] ✅ VAD初期化完了 - クライアント側音声検出有効', {
            threshold: defaultSettings.threshold,
            debounce: defaultSettings.debounce,
            note: 'デフォルト設定（ユーザー設定で上書き可能）'
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
        console.info(
            '[Audio Source] 原声出力スイッチ:',
            this.state.playOriginalToSpeaker
                ? 'ON（PCスピーカー/loopbackを監視）'
                : 'OFF（仮想サウンドカードを監視）'
        );

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
        console.info('[Audio Source] 監視先変更 → キャプチャを再起動します');
        try {
            await this.stopRecording();
            await this.updateSessionConfig();
            await this.startRecording();
        } catch (err) {
            console.error('[Audio Source] キャプチャ再起動エラー:', err);
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
        console.info('[Silence Verify] 監視先の無音検証を開始（5秒間観測）');
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
            console.info('[Silence Verify] 音声を検出（正常）:', { maxEnergy });
            return;
        }

        console.warn('[Silence Verify] 監視先が無音です:', { maxEnergy });

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

        // ✅ バグ修正（無音対策）: 音声翻訳ONなのに「翻訳音声を出力」がOFFだと
        //    output_modalities=['text'] となり音声が一切出ない不正状態になる。
        //    handleAudioOutputToggle の逆方向ガード（OFF→音声翻訳もOFF）と対になる補正。
        if (isActive) {
            const audioOutputEnabled = this.elements.audioOutputEnabled;
            if (audioOutputEnabled && !audioOutputEnabled.classList.contains('active')) {
                audioOutputEnabled.classList.add('active');
                this.saveToStorage('audioOutputEnabled', 'true');
                console.info(
                    '[Translation Mode] 音声翻訳ONのため「翻訳音声を出力」も自動的にONにしました'
                );
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
        console.info(`[Transcript] ${label}: ${isActive ? 'ON' : 'OFF'}`);
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
        console.info('[Audio Output] 翻訳音声を出力:', isActive ? 'ON' : 'OFF');

        // ✅ バグ修正: 翻訳音声を出力がOFFの場合、リアルタイム音声翻訳も自動的にOFFにする
        if (!isActive) {
            const translationModeAudio = this.elements.translationModeAudio;
            if (translationModeAudio && translationModeAudio.classList.contains('active')) {
                translationModeAudio.classList.remove('active');
                this.saveToStorage('translationModeAudio', 'false');
                console.info(
                    '[Audio Output] 翻訳音声を出力がOFFのため、リアルタイム音声翻訳も自動的にOFFにしました'
                );
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
            this.notify(
                '音声出力設定',
                '翻訳音声を出力をONにしました',
                'info'
            );
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

        console.info('[ProcessorModes] モード同期を開始:', {
            isAudioTranslation,
            isAudioOutput
        });

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

        console.info('[ProcessorModes] モード同期完了:', {
            path1Mode: this.textPathProcessor.mode,
            path2Mode: this.voicePathProcessor.mode
        });
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
        if (!this.platform.isElectron) {
            console.info('[App] ブラウザ環境: 環境変数からAPIキーを読み込めません');
            return;
        }

        try {
            console.info('[App] Electron環境: 環境変数からAPIキーを取得中...');
            const envApiKey = await this.platform.getEnvApiKey();

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
            const envConfig = await this.platform.getEnvConfig();

            if (envConfig) {
                // CONFIGを上書き（2種類のモデル設定）
                CONFIG.API.REALTIME_MODEL = envConfig.realtimeModel;
                CONFIG.API.CHAT_MODEL = envConfig.chatModel;
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

                console.info('[App] 環境変数から設定を読み込みました:', {
                    realtimeModel: CONFIG.API.REALTIME_MODEL,
                    chatModel: CONFIG.API.CHAT_MODEL,
                    realtimeUrl: CONFIG.API.REALTIME_URL,
                    translation: CONFIG.TRANSLATION
                });
            }
        } catch (error) {
            console.error('[App] 環境変数読み込みエラー:', error);
        }
    }

    setupElectronWebSocketHandlers() {
        if (!this.platform.isElectron) {
            return;
        }

        console.info('[Electron WS] IPCハンドラーを設定中...');

        // Realtime WebSocket イベントをアダプタ経由で購読
        this.platform.subscribeRealtimeEvents({
            onOpen: () => {
                console.info('[Electron WS] 接続成功イベント受信');
                this.handleWSOpen();
            },
            onMessage: (message) => {
                console.info('[Electron WS] メッセージ受信イベント');
                this.handleWSMessage({ data: message });
            },
            onError: (error) => {
                console.error('[Electron WS] エラーイベント:', error);
                this.handleWSError(error);
            },
            onClose: (data) => {
                console.info('[Electron WS] 接続終了イベント:', data);
                this.handleWSClose(data);
            }
        });

        console.info('[Electron WS] IPCハンドラー設定完了');
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
        console.info(`[Reconnect] ${delay}ms 後に再接続 (試行 ${attempt})`);
        this.notify('再接続', `${Math.round(delay / 1000)}秒後に自動再接続します（試行 ${attempt}）`, 'warning');
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
        } catch (err) {
            console.warn('[Audio] 出力デバイス列挙に失敗:', err);
        }
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
                console.info('[Audio] 仮想サウンドカードを自動選択:', virtual.label);
            }
        } catch (err) {
            console.warn('[Audio] 入力デバイス列挙に失敗:', err);
        }
    }

    /**
     * 翻訳音声の出力先を選択デバイスへ切り替える（AudioContext.setSinkId）。
     * 原声分離（会議→仮想サウンドカード→翻訳→物理スピーカー）の物理出力側を担う。
     * setSinkId 非対応環境では既定デバイスのまま（何もしない）。
     */
    async applyOutputSink() {
        const ctx = this.state.outputAudioContext;
        const deviceId = this.state.outputDeviceId;
        if (!ctx || typeof ctx.setSinkId !== 'function') {
            if (deviceId) {
                console.warn('[Audio] この環境は出力先切替(setSinkId)に未対応のため既定デバイスを使用します');
            }
            return;
        }
        try {
            await ctx.setSinkId(deviceId || '');
            console.info('[Audio] 翻訳音声の出力先を設定:', deviceId || '既定デバイス');
        } catch (err) {
            console.warn('[Audio] 出力先設定に失敗:', err);
        }
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

            // ✅ Electron環境: 会話セッション開始
            if (this.platform.conversation) {
                try {
                    const sessionId = await this.platform.conversation.startSession(
                        this.state.sourceLang || 'auto',
                        this.state.targetLang || 'ja'
                    );
                    this.state.currentSessionId = sessionId;
                    console.info('[Conversation] セッション開始:', sessionId);
                } catch (error) {
                    console.error('[Conversation] セッション開始エラー:', error);
                    // セッション開始失敗でも接続は続行
                }
            }

            if (this.platform.isElectron) {
                // Electronの場合、mainプロセス経由で接続（Authorizationヘッダー付き）
                console.info('[Connect] Electron環境: mainプロセス経由で接続します');

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

                console.info('[Connect] Electron WebSocket接続要求送信完了');
                // 接続成功はIPCイベント経由で通知される
                return;
            }

            // ブラウザ環境の場合（sec-websocket-protocolで認証）
            const wsUrl = `${CONFIG.API.REALTIME_URL}?model=${CONFIG.API.REALTIME_MODEL}`;
            console.info('[Connect] WebSocket URL:', wsUrl);

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
        // ✅ Electron環境: 会話セッション終了
        if (this.platform.conversation && this.state.currentSessionId) {
            try {
                await this.platform.conversation.endSession();
                console.info('[Conversation] セッション終了:', this.state.currentSessionId);
                this.state.currentSessionId = null;
            } catch (error) {
                console.error('[Conversation] セッション終了エラー:', error);
            }
        }

        if (this.platform.isElectron) {
            // Electron環境
            await this.platform.closeRealtime();
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

        // 自動再接続カウンタをリセット（接続成功）
        this.state.reconnectAttempt = 0;

        this.notify('接続成功', 'OpenAI Realtime APIに接続しました', 'success');

        // 「開始」意図がある場合は録音（翻訳）を自動開始する。
        // これにより「接続→翻訳開始」が1アクションになり、再接続後も自動で再開する。
        if (this.state.userWantsActive && !this.state.isRecording) {
            console.info('[WS] userWantsActive=true のため録音を自動開始します');
            this.startRecording();
        }
    }

    createSession() {
        // 音声出力が有効かどうかをチェック
        const audioOutputEnabled = this.elements.audioOutputEnabled.classList.contains('active');
        // GA: output_modalities は ['audio'] または ['text'] のいずれか
        // （'audio' を指定すると音声出力＋文字起こしの両方が得られる）
        const outputModalities = audioOutputEnabled ? ['audio'] : ['text'];

        console.info('[🔊 Session] 音声出力設定:', {
            audioOutputEnabled: audioOutputEnabled,
            outputModalities: outputModalities,
            buttonElement: this.elements.audioOutputEnabled,
            hasActiveClass: this.elements.audioOutputEnabled.classList.contains('active')
        });

        // GA: 音声フォーマットはオブジェクト形式（PCM16 = audio/pcm）
        const audioFormat = { type: 'audio/pcm', rate: CONFIG.AUDIO.SAMPLE_RATE };

        const session = {
            type: 'session.update',
            session: {
                // GA Realtime セッションタイプ
                type: 'realtime',
                // Realtime APIモデル（音声→音声翻訳、音声認識）
                model: CONFIG.API.REALTIME_MODEL,
                // GA: セッションの出力モダリティは output_modalities（旧: modalities）
                output_modalities: outputModalities,
                instructions: this.getInstructions(),
                audio: {
                    input: {
                        format: audioFormat,
                        transcription: {
                            // 音声認識モデル（入力音声 → 入力テキスト）
                            // gpt-realtime-2025-08-28 では whisper-1 を使用
                            model: 'whisper-1'
                            // language を指定しない → 自動言語検出を有効化
                            // 多人数・多言語環境で正確な言語検出を実現
                        },
                        turn_detection: this.elements.vadEnabled.classList.contains('active')
                            ? this.getTurnDetectionConfig()
                            : null
                    },
                    output: {
                        format: audioFormat,
                        voice: this.state.voiceType
                    }
                },
                max_output_tokens: 4096 // 4096: 長い会話にも対応
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
            '- output_modalities:',
            outputModalities
        );
        this.sendMessage(session);
        console.info('[Session] セッション作成メッセージを送信しました');
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
    getTurnDetectionConfig() {
        const isMicrophoneMode = this.state.audioSourceType === 'microphone';

        // ✅ semantic_vad: 発話の「意味的な完結」をモデルが判定して区切る公式機能。
        //    文の途中で切れにくく、完全な文（整句）単位で翻訳できるため文脈品質が向上する。
        //    eagerness が低いほど長めに待ち、より多くの完結した発話をまとめる。
        //    ※ create_response / interrupt_response は設定しない（server_vad時と同様）。
        //      応答生成は responseQueue 経由で手動制御しているため、サーバ自動応答の挙動を変えない。
        if (CONFIG.TRANSLATION && CONFIG.TRANSLATION.VAD_TYPE === 'semantic_vad') {
            const eagerness = CONFIG.TRANSLATION.SEMANTIC_EAGERNESS || 'low';
            console.info(`[VAD] semantic_vad を使用: eagerness=${eagerness}`);
            return {
                type: 'semantic_vad',
                eagerness: eagerness
            };
        }

        // ✅ VAD感度スライダーの値を取得（low/medium/high）
        const vadSensitivity = this.elements.vadSensitivity?.value || 'medium';

        // ✅ VAD感度に応じてthresholdを調整
        // threshold値が小さいほど敏感（小さい音でも検出）
        const thresholdMap = {
            low: 0.7, // 低感度：大きい音のみ検出
            medium: 0.5, // 中感度：標準的な音声を検出
            high: 0.3 // 高感度：小さい音も検出
        };

        const threshold = thresholdMap[vadSensitivity] || 0.5;

        console.info(`[VAD] Server VAD threshold設定: ${vadSensitivity} → ${threshold}`);

        if (isMicrophoneMode) {
            // マイクモード（対話）: 短い発話、素早い応答
            return {
                type: 'server_vad',
                threshold: threshold, // ✅ VAD感度に応じて調整
                prefix_padding_ms: 300, // 音声開始前のパディング
                silence_duration_ms: 500 // 短い静音で素早く翻訳開始
            };
        } else {
            // システム音声モード（会議監視）: 長い発話、自然な停顿を許容
            return {
                type: 'server_vad',
                threshold: threshold, // ✅ VAD感度に応じて調整
                prefix_padding_ms: 300, // 音声開始前のパディング
                silence_duration_ms: 1200 // 長い静音判定で途中の停顿を許容
                // 理由: 会議・プレゼンでは呼吸や考え中の停顿があるため
                //       1.2秒の静音で完全な文章を待つ
            };
        }
    }

    /**
     * セッション設定を更新（VAD感度変更時など）
     *
     * 目的:
     *   接続中にVAD感度を変更した場合、Server VADの設定を更新
     */
    async updateSessionConfig() {
        if (!this.state.isConnected) {
            console.warn('[Session] 未接続のためセッション設定を更新できません');
            return;
        }

        // GA: turn_detection は audio.input の下にネスト
        const updateEvent = {
            type: 'session.update',
            session: {
                // GA: session.update では session.type が必須（'realtime'）
                type: 'realtime',
                audio: {
                    input: {
                        turn_detection: this.elements.vadEnabled.classList.contains('active')
                            ? this.getTurnDetectionConfig()
                            : null
                    }
                }
            }
        };
        console.info('[Session] セッション設定を更新:', updateEvent);
        this.sendMessage(updateEvent);
    }

    getInstructions() {
        const sourceLang = this.state.sourceLang;
        const targetLang = this.state.targetLang || 'ja';
        const sourceName =
            sourceLang && sourceLang !== 'auto'
                ? Utils.getLanguageName(sourceLang)
                : 'the identified source language';
        const targetName = Utils.getLanguageName(targetLang);
        const sourceNative = sourceLang && sourceLang !== 'auto' ? Utils.getNativeLanguageName(sourceLang) : 'auto-detect';
        const targetNative = Utils.getNativeLanguageName(targetLang);

        // ✅ 中文の場合は明確に「简体中文」を指定
        const targetLanguageSpec =
            targetLang === 'zh' ? 'Simplified Chinese (简体中文)' : targetName;

        // ✅ 自動検出モードの記述
        const isAutoSource = !sourceLang || sourceLang === 'auto';
        const sourceDescription = isAutoSource
            ? 'Dynamic per segment (auto-detect English, Japanese, Simplified Chinese, or Vietnamese from the current audio only)'
            : `${sourceName} (${sourceNative})`;

        // 最適化された指示（OpenAI Realtime Prompting Guide ベストプラクティス）
        // ✅ 強化: 翻訳専用モード、対話禁止を明確化
        return `# CRITICAL: YOU ARE A TRANSLATION MACHINE, NOT A CONVERSATIONAL AI
## YOUR IDENTITY
- You are a professional, high-speed real-time interpreter.
- Your ONLY function is to convert speech from the source language to ${targetName}.
- You are NOT a person, you are NOT an assistant, and you have NO personal identity.

## CORE OBJECTIVE
- TRANSLATE every segment of input audio into ${targetName} (${targetNative}) IMMEDIATELY.
- If the user says "Hello", "How are you?", or any greeting, translate it to ${targetName}. DO NOT answer the greeting.
- If the user asks you a question ABOUT YOU or WHAT YOU ARE, translate that question into ${targetName}. DO NOT answer the question.

## STRICT RULES (NEVER BREAK THESE)
1. **NO CHATTING**: NEVER engage in conversation, discussion, or dialogue.
2. **NO EXPLANATIONS**: NEVER explain a translation or say things like "I am sorry, I can't translate that".
3. **NO RESPONSE IN SOURCE**: NEVER respond in the language the user just spoke. ALWAYS translate to ${targetName}.
4. **TRANSLATION ONLY**: Your output must contain ONLY the translation. No meta-commentary, no suggestions, no advice.

## LANGUAGE SPECIFICATIONS
- Input language: ${sourceDescription}.
- Output language: ${targetLanguageSpec} (${targetNative}) ONLY.
- **AUTO-IDENTIFICATION**: Identify the source language independently for every audio segment. Do not reuse the previous segment's language when the current segment sounds different.
- If the speaker uses English, Japanese, Simplified Chinese, or Vietnamese, translate it to ${targetName} without speaking to the user in their language.
${targetLang === 'zh'
                ? '- **PRECISION**: For Chinese output, use Simplified Chinese (简体中文) characters ONLY.'
                : ''
            }

## HANDLING INPUT
- Preserve the speaker's emotional tone, intent, and meaning in ${targetName}.
- Adapt idioms and cultural references appropriately.
- Match the length and pacing of the original speech.
- If the speech is unclear, provide the most plausible translation. NEVER ask for clarification.

## FORBIDDEN ACTIONS
- ❌ DO NOT say "How can I help you?", "I am an AI assistant", or "Nice to meet you".
- ❌ DO NOT provide help, tips, or suggestions.
- ❌ DO NOT repeat the original input language in your output.
- ❌ DO NOT say "Here is the translation:". Just give the translation.
- ❌ DO NOT say "Sorry, I misunderstood". Just translate the next audio segment.

# FINAL REMINDER
- Output ONLY the ${targetName} translation of the input audio. NOTHING ELSE.
- You are a TRANSLATION MACHINE. You translate ${sourceName} to ${targetName}. Period.`;
    }

    async sendMessage(message) {
        if (this.platform.isElectron) {
            // Electron環境（mainプロセス経由IPC）
            const result = await this.platform.sendRealtime(message);
            if (!result.success) {
                console.error('[Send Message] Electron送信エラー:', result.message);
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
            console.warn('[Recording] 既に録音中のため開始要求を無視します');
            return;
        }

        // ✅ プル型アーキテクチャ: 消費者ループを開始
        this.startPathConsumers();

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

            // ✅ システム音声モードでは、選んだ監視先が実際に鳴っているかを自動検証する
            //    （誤設定で無音を監視し続ける穴を塞ぐ）
            if (this.state.audioSourceType === 'system') {
                this.startSilenceVerification();
            }
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
        if (this.platform.isElectron) {
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

        console.info('[Recording] 仮想サウンドカードキャプチャを開始...', { deviceId });

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
        console.info('[Recording] 仮想サウンドカードキャプチャ成功');
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

            console.info('[Recording] ========== Electron画面キャプチャ要求中 ==========');
            console.info('[Recording] ソースID:', sourceId);
            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            // 音声トラックを取得
            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();

            console.info('[Recording] ========== トラック情報 ==========');
            console.info('[Recording] 音声トラック数:', audioTracks.length);
            console.info('[Recording] ビデオトラック数:', videoTracks.length);

            // ✅ デバッグログ追加：各音声トラックの詳細
            audioTracks.forEach((track, index) => {
                console.info(`[Recording] 音声トラック[${index}]:`, {
                    label: track.label,
                    enabled: track.enabled,
                    muted: track.muted,
                    readyState: track.readyState,
                    settings: track.getSettings()
                });
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

            console.info(
                '[Recording] AudioWorklet を使用して音声処理を開始しました（入力音声出力: OFF）'
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

            console.info(
                '[Recording] ScriptProcessorNode を使用して音声処理を開始しました（入力音声出力: OFF）'
            );
        }

        // ✅ UI更新と通知（isRecording は既に true に設定済み）
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
    async detectAudioSources() {
        console.info('[Audio Source] 音声ソースを検出中...');

        const systemAudioSource = document.getElementById('systemAudioSource');

        if (this.platform.isElectron) {
            // Electron環境: 会議アプリを自動検出
            try {
                this.notify('検出中', '音声ソースを検出しています...', 'info');

                const sources = await this.platform.detectMeetingApps();
                console.info('[Audio Source] ========== 検出されたソース ==========');
                console.info('[Audio Source] ソース数:', sources.length);

                // ✅ デバッグログ追加：各ソースの詳細を表示
                sources.forEach((source, index) => {
                    console.info(`[Audio Source] [${index}] ${source.name}`, {
                        id: source.id,
                        type: source.type,
                        isTeams: source.name.toLowerCase().includes('teams'),
                        isZoom: source.name.toLowerCase().includes('zoom'),
                        isChrome: source.name.toLowerCase().includes('chrome')
                    });
                });

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

        // ✅ プル型アーキテクチャ: 消費者ループを停止
        this.stopPathConsumers();

        // ✅ AudioQueue をクリア（重要: 再開始時に古いセグメントが残らないようにする）
        if (this.audioQueue) {
            this.audioQueue.clear();
            console.info('[Recording] AudioQueue をクリアしました');
        }

        // ✅ モードロックをクリア
        localStorage.removeItem(this.modeStateManager.globalLockKey);
        this.modeStateManager.currentMode = null;
        console.info('[ModeSwitch] モードロックをクリア');

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
            console.warn('[Recording] 停止時に未送信の蓄積音声を破棄します', {
                turns: this.groupedAudioChunks.length,
                durationMs: Math.round(this.groupedAudioDuration)
            });
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
        // GA: output_modalities は ['audio'] または ['text']
        const outputModalities = audioOutputEnabled ? ['audio'] : ['text'];

        console.info('[Recording] レスポンス生成を要求（Server VAD無効）:', {
            outputModalities: outputModalities,
            modalities: outputModalities,
            audioOutputEnabled: audioOutputEnabled,
            queueStatus: this.responseQueue.getStatus()
        });

        try {
            await this.responseQueue.enqueue({
                response: {
                    // GA: response.create も output_modalities を使用（旧: modalities）
                    output_modalities: outputModalities,
                    instructions: this.getInstructions(),
                }
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
            console.info('[Audio] 出力専用AudioContextを作成しました');
            // 選択済みの出力先（原声分離用の物理デバイス）を適用
            await this.applyOutputSink();
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

                // ✅ 現在のソースをクリア
                if (this.currentAudioSource === source) {
                    this.currentAudioSource = null;
                }

                this.handleAudioPlaybackEnded();
            };

            console.info('[Audio] 音声再生開始:', {
                playbackToken,
                outputStartTime: this.audioSourceTracker.outputStartTime
            });

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
            console.warn(
                '[🔊 Playback Queue] ========== 新しい翻訳開始 - 古い音声をクリア =========='
            );
            console.warn('[🔊 Playback Queue] クリアされた音声チャンク数:', clearedChunks);
            console.warn(
                '[🔊 Playback Queue] 現在再生中の音声:',
                this.currentAudioSource ? '停止します' : 'なし'
            );
            console.warn(
                '[🔊 Playback Queue] ================================================================'
            );
        }

        // ✅ キューをクリア
        this.playbackQueue = [];

        // ✅ 現在再生中の音声を停止
        if (this.currentAudioSource) {
            try {
                this.currentAudioSource.stop();
                console.info('[🔊 Playback Queue] 現在再生中の音声を停止しました');
            } catch (error) {
                // 既に停止している場合はエラーを無視
                console.debug('[🔊 Playback Queue] 音声停止エラー（無視）:', error.message);
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
                confidence >= 0.6 ? detectedLang : this.state.sourceLang || 'auto';

            // 検出された言語で翻訳を実行
            await this.translateTextDirectly(inputText, transcriptId, finalSourceLang);
        } catch (error) {
            console.error('[言語検出] エラー:', error);
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
        console.info('[翻訳] 翻訳方向:', {
            入力テキスト: inputText.substring(0, 50) + '...',
            ソース言語: actualSourceLang,
            ターゲット言語: this.state.targetLang,
            翻訳方向: `${actualSourceLang} → ${this.state.targetLang}`
        });

        try {
            if (!this.state.apiKey) {
                throw new Error('APIキーが設定されていません');
            }

            // 文本翻訳用のモデルを選択
            // Chat Completions APIモデルを使用（環境変数から設定可能）
            const translationModel = CONFIG.API.CHAT_MODEL;

            // リクエストボディを構築
            const targetLangName = Utils.getLanguageName(this.state.targetLang || 'ja');
            const sourceLangPrompt = actualSourceLang === 'auto'
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

            // 防御的後処理: アシスタント定型句を除去（プロンプトに加えた多層防御）
            const translatedText = Utils.stripAssistantBoilerplate(
                data.choices[0].message.content
            );
            if (translatedText === '') {
                console.warn('[翻訳] アシスタント定型句を検出したため出力を破棄しました');
                return '';
            }

            // 翻訳結果を右側カラムに表示（transcriptIdで一対一対応）
            this.addTranscript('output', translatedText, transcriptId);
            return translatedText;
        } catch (error) {
            console.error('[翻訳エラー]', error);
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
        // GA: output_modalities は ['audio'] または ['text']
        const outputModalities = audioOutputEnabled ? ['audio'] : ['text'];

        // 録音中の場合は、音声設定を変更できない
        // instructionsとoutput_modalitiesのみを更新
        const session = {
            type: 'session.update',
            session: {
                // GA: session.update では session.type が必須（'realtime'）
                type: 'realtime',
                instructions: this.getInstructions(),
                // GA: セッションの出力モダリティは output_modalities（旧: modalities）
                output_modalities: outputModalities
            }
        };

        // 録音中でない場合のみ、翻訳音色も更新（GA: audio.output.voice）
        if (!this.state.isRecording) {
            session.session.audio = { output: { voice: this.state.voiceType } };
        }

        this.sendMessage(session);
        console.info('[Session] セッション更新:', {
            isRecording: this.state.isRecording,
            voiceIncluded: !this.state.isRecording,
            audioOutputEnabled: audioOutputEnabled,
            outputModalities: outputModalities
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

/**
 * ✅ プル型アーキテクチャ: パス消費者ループを開始
 */
VoiceTranslateApp.prototype.startPathConsumers = function () {
    console.info('[PathConsumers] 消費者ループを開始');

    // ✅ Path1 消費者ループ（テキストパス）
    this.path1ConsumerInterval = setInterval(async () => {
        if (this.textPathProcessor.isProcessing) {
            return;
        }

        const segment = this.audioQueue.consumeForPath('path1');
        if (segment) {
            console.info('[Path1 Consumer] セグメント取得:', {
                segmentId: segment.id,
                duration: segment.getDuration() + 'ms'
            });
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
            console.info('[Path2 Consumer] セグメント取得:', {
                segmentId: segment.id,
                duration: segment.getDuration() + 'ms'
            });
            await this.voicePathProcessor.process(segment);
        }
    }, 100); // 100ms ごとにチェック
};

/**
 * ✅ プル型アーキテクチャ: パス消費者ループを停止
 */
VoiceTranslateApp.prototype.stopPathConsumers = function () {
    console.info('[PathConsumers] 消費者ループを停止');

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
        console.error('[History] モーダル要素が見つかりません');
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
        console.error('[History] セッション取得エラー:', error);
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
        console.error('[History] ターン取得エラー:', error);
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
