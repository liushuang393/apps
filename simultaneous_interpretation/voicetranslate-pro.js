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
            // ✅ 音声出力モード（聞こえる音）: 'translation'=翻訳音声 / 'original'=原音声のみ / 'off'=字幕のみ
            //   キャプチャ方式とは独立し、翻訳音声(TTS)の再生可否のみを制御する。
            audioOutputMode: 'translation',
            virtualCardDeviceId: '', // システム音声(Electron)で自動検出した仮想サウンドカードの入力デバイスID
            outputDeviceId: null, // 翻訳音声の出力先(物理スピーカー/ヘッドホン)デバイスID。null=未検出, ''=既定出力
            isNewResponse: true, // 新しい応答かどうかのフラグ
            outputVolume: 1, // 出力音量（1 = 通常、クリッピング防止のため2から変更）
            isPlayingAudio: false, // 音声再生中フラグ（ループバック防止用）
            // ✅ 開始/停止のユーザー意図フラグ（自動接続・自動再接続の制御に使用）
            userWantsActive: false, // 「開始」で true、「停止」で false
            isUnloading: false, // ページ/アプリ終了中フラグ（終了時は再接続しない）
            reconnectAttempt: 0 // 自動再接続のリトライ回数（指数バックオフ用）
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
            // 半二重時、再生終了後にマイク送信を抑止する時間。残響/伝播のエコー末尾だけを断つ。
            // 長すぎると次話者の発話頭を削る（＝丢声音）。実機で詰める校正値:
            //   スピーカー→マイク伝播 100-500ms + マイク処理 100-200ms ≒ 400ms 前後。
            bufferWindow: 400, // ※環境により残響が長い場合は 500-700 に上げて調整
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
        } catch (e) {
            this.notify('警告', 'プロセッサモードの初期化に失敗しました', 'error');
        }

        this.notify('システム準備完了', 'VoiceTranslate Proが起動しました', 'success');
    }

    initElements() {
        // API設定
        this.elements.apiKey = document.getElementById('apiKey');
        this.elements.validateBtn = document.getElementById('validateBtn');

        // 言語設定
        // ✅ D2: 入力言語セレクタ（既定=自動判定。指定すると認識精度が上がる）
        this.elements.sourceLang = document.getElementById('sourceLang');
        this.elements.targetLang = document.getElementById('targetLang');
        // 音色/モデル選択UIは廃止（CONFIG / .env から決定）
        this.elements.sourceLangDisplay = document.getElementById('sourceLangDisplay');
        this.elements.targetLangDisplay = document.getElementById('targetLangDisplay');

        // 自動検出言語の表示は左「入力音声」欄の sourceLangDisplay に統合（専用欄は廃止）

        // 詳細設定
        this.elements.vadEnabled = document.getElementById('vadEnabled');
        // ノイズ除去/エコー除去/自動ゲインのトグルUIは廃止（getUserMedia制約に既定値を直書き）
        this.elements.vadSensitivity = document.getElementById('vadSensitivity');
        this.elements.showInputTranscript = document.getElementById('showInputTranscript');
        this.elements.showOutputTranscript = document.getElementById('showOutputTranscript');
        // ✅ 音声出力モード（翻訳音声 / 原音声のみ / オフ）のセレクタ
        this.elements.audioOutputMode = document.getElementById('audioOutputMode');

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
            showInputTranscript: 'true', // ON
            showOutputTranscript: 'true' // ON
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
        // ✅ D2: 入力言語を指定したら state.sourceLang に反映。'auto' は null（自動判定）。
        //    接続中は session.update で転写設定を再送し、buildInputTranscriptionConfig が
        //    language を固定 → 短文の言語誤検出を抑え認識精度を上げる。
        if (this.elements.sourceLang) {
            this.elements.sourceLang.addEventListener('change', (e) => {
                this.state.sourceLang = e.target.value === 'auto' ? null : e.target.value;
                if (this.state.isConnected) {
                    this.updateSession();
                }
            });
        }

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

        // 音色/モデル選択UIは廃止（CONFIG / .env から決定）

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

                // キャプチャ方式はプラットフォームで自動決定する
                //   Electron → 仮想サウンドカード(VB-CABLE)を裏で自動検出
                //   ブラウザ → getDisplayMedia（タブ音声共有）の会議アプリを自動検出
                if (this.platform.isElectron) {
                    await this.autoDetectVirtualCard();
                } else {
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
        ['vadEnabled', 'showInputTranscript', 'showOutputTranscript'].forEach((id) => {
            this.elements[id].addEventListener('click', (e) => {
                this.handleToggleSetting(id, e.currentTarget);
            });
        });

        // 音声出力モード（聞こえる音）: 翻訳音声 / 原音声のみ / オフ（字幕のみ）
        if (this.elements.audioOutputMode) {
            this.elements.audioOutputMode.addEventListener('change', (e) => {
                this.state.audioOutputMode = e.target.value;
                this.saveToStorage('audio_output_mode', e.target.value);
                this.applyAudioOutputMode();
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
                } catch (error) {
                    this.notify('警告', 'VAD設定の反映に失敗しました', 'error');
                }
            }
        });

        // コントロールボタン
        // 「接続/切断」ボタンは廃止（画面上は非表示）。「開始」で自動接続、「停止」で切断する。
        this.elements.connectBtn.addEventListener('click', () => this.start());
        this.elements.disconnectBtn.addEventListener('click', () => this.stop());
        this.elements.startBtn.addEventListener('click', () => this.start());
        this.elements.stopBtn.addEventListener('click', () => this.stop());

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
            case 'showInputTranscript':
            case 'showOutputTranscript':
                this.handleTranscriptToggle(id, element);
                break;
            default:
                // 個別ハンドラを持たないトグルは状態保存のみ
                break;
        }
    }

    /**
     * 監視先の無音自動検証を開始する
     *
     * 目的:
     *   開始直後の一定時間だけ入力エネルギーを観測し、選んだ監視先が
     *   実際に音を出しているかを確認する。無音なら設定/配線の確認を促す。
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

        // 監視先が無音（キャプチャ方式はプラットフォーム固定のため自動切替はしない）→ 設定/配線の確認を促す
        this.notify(
            '音声が検出できません',
            this.platform.isElectron
                ? '仮想サウンドカードから音声が検出できません。会議アプリ/既定の出力先を「CABLE Input」に設定しているか確認してください。'
                : '共有したタブ/画面から音声が検出できません。「タブ」を選び「タブの音声を共有」にチェックが入っているか確認してください。',
            'error'
        );
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
     * 音声出力モード（聞こえる音）を再生段へ反映する。
     *
     * 目的:
     *   翻訳音声(TTS)を鳴らすかを state.audioOutputMode に従って制御する（単一の真実源）。
     *   - 'translation': 翻訳音声を再生（ブラウザ=WebRTCの<audio>を unmute＋play、Electron/WS=playAudioChunk許可）
     *   - 'original' / 'off': 翻訳音声をミュート（字幕は別ストリームなので影響しない＝底線）
     *   原音の可聴性は採集方式に依存するため、ここでは制御しない。
     */
    applyAudioOutputMode() {
        const playTranslation = this.state.audioOutputMode === 'translation';
        const el = this.state.translatedAudioEl;
        if (!el) {
            return;
        }
        el.muted = !playTranslation;
        if (playTranslation && typeof el.play === 'function') {
            const p = el.play();
            if (p && typeof p.catch === 'function') {
                p.catch((err) => {
                    this.notify(
                        '翻訳音声がブロックされました',
                        '画面を一度クリックしてから再度お試しください: ' +
                            this.extractErrorMessage(err),
                        'warning'
                    );
                });
            }
        }
    }

    /**
     * ✅ パスプロセッサの動作モードを同期
     *
     * 目的:
     *   本アプリは音声翻訳モードに固定（Path1: 音声認識のみ＝字幕、Path2: 音声翻訳）。
     *   「聞こえる音」は audioOutputMode（再生段）で制御し、翻訳生成は常に行う。
     *   ＝原音/字幕のみモードでも左右カラムの翻訳テキストは落とさない（底線）。
     */
    updateProcessorModes() {
        this.textPathProcessor.setMode(1);
        this.voicePathProcessor.mode = 1;
    }

    async loadSettings() {
        // ストレージから設定を読み込み
        const settings = {
            apiKey: await this.getFromStorage('openai_api_key'),
            // ✅ 修正: sourceLang は自動検出に変更、ストレージから読む必要なし
            // sourceLang: await this.getFromStorage('source_lang'),
            targetLang: await this.getFromStorage('target_lang'),
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

        // 音色/モデル選択UIは廃止。モデルは CONFIG / .env から決定する。

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
        const toggleSettings = ['vadEnabled', 'showInputTranscript', 'showOutputTranscript'];
        for (const id of toggleSettings) {
            const value = await this.getFromStorage(id);
            if (value === 'false') {
                this.elements[id].classList.remove('active');
            }
        }

        // ✅ 音声出力モード（聞こえる音）を復元（既定: 翻訳音声）。リロード後も選択を保持する。
        const savedOutputMode = await this.getFromStorage('audio_output_mode');
        this.state.audioOutputMode = savedOutputMode || 'translation';
        if (this.elements.audioOutputMode) {
            this.elements.audioOutputMode.value = this.state.audioOutputMode;
        }
        this.applyAudioOutputMode();
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
        } catch (error) {
            this.notify('警告', '環境設定の読み込みに失敗しました（既定値を使用します）', 'error');
        }
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
     * 仮想サウンドカード（VB-CABLE等）の入力デバイスを名前で自動検出する（手動選択UIは廃止）。
     *
     * 目的:
     *   システム音声(Electron)の原声分離で監視する入力デバイスを enumerateDevices() から自動選定する。
     *   見つかれば state.virtualCardDeviceId にセットする。見つからない場合は何もしない
     *   （呼び出し側 startVirtualCardCapture が明確なエラーと導入手順を案内する）。
     */
    async autoDetectVirtualCard() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                return;
            }
            let devices = await navigator.mediaDevices.enumerateDevices();
            let inputs = devices.filter((d) => d.kind === 'audioinput');

            // 権限未付与だと enumerateDevices のラベルが空になり名前マッチできないため、
            // 一度だけ音声権限を取り再列挙してから解放する（使い捨て・即停止）。
            const labelsEmpty = inputs.length > 0 && inputs.every((d) => !d.label);
            if (labelsEmpty) {
                try {
                    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
                    probe.getTracks().forEach((t) => t.stop());
                    devices = await navigator.mediaDevices.enumerateDevices();
                    inputs = devices.filter((d) => d.kind === 'audioinput');
                } catch (permErr) {
                    // 権限拒否時はラベル無しのまま続行（検出失敗→呼び出し側で案内）
                }
            }

            const virtualPattern = /CABLE|VB-Audio|VoiceMeeter|Virtual|仮想/i;
            const virtual = inputs.find((d) => virtualPattern.test(d.label || ''));
            if (virtual) {
                this.state.virtualCardDeviceId = virtual.deviceId;
            }
        } catch (err) {
            // 検出失敗は致命的でない（呼び出し側が未検出として案内する）
        }
    }

    /**
     * 翻訳音声の出力先（物理スピーカー/ヘッドホン）を名前で自動検出する。
     *
     * 目的:
     *   原声分離構成では既定出力を仮想サウンドカードに向けるため、翻訳音声(TTS)まで
     *   仮想カードへ流れて物理スピーカー/ヘッドホンから聞こえなくなる。これを避けるため
     *   出力デバイスを enumerateDevices() から自動選定し、setSinkId で固定する。
     *
     * 優先順位: ①ヘッドホン/イヤホン ②物理スピーカー ③物理が無ければ既定のまま('')
     *   結果は state.outputDeviceId にセットする（'' = 既定出力を使用＝検出済みだが物理なし）。
     *
     * ponytail: ラベル一致のヒューリスティック検出。Bluetooth等は製品名表示で耳機判定に漏れ得る。
     *   接続(connect)毎に再検出するため、途中でデバイスを抜き差ししたら再接続で反映される。
     */
    async autoDetectPhysicalSpeaker() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                this.state.outputDeviceId = '';
                return;
            }
            let devices = await navigator.mediaDevices.enumerateDevices();
            let outputs = devices.filter((d) => d.kind === 'audiooutput');

            // 権限未付与だとラベルが空で名前マッチできないため、一度だけ権限を取り再列挙する。
            const labelsEmpty = outputs.length > 0 && outputs.every((d) => !d.label);
            if (labelsEmpty) {
                try {
                    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
                    probe.getTracks().forEach((t) => t.stop());
                    devices = await navigator.mediaDevices.enumerateDevices();
                    outputs = devices.filter((d) => d.kind === 'audiooutput');
                } catch (permErr) {
                    // 権限拒否時はラベル無しのまま続行（既定出力にフォールバック）
                }
            }

            const virtualPattern = /CABLE|VB-Audio|VoiceMeeter|Virtual|仮想/i;
            const headphonePattern =
                /ヘッドホン|ヘッドセット|イヤホン|headphone|headset|earphone|earbud/i;
            // 仮想カードを除外した物理デバイスのみを候補にする（既定が仮想でも物理を選べる）
            const physical = outputs.filter((d) => !virtualPattern.test(d.label || ''));
            const headphone = physical.find((d) => headphonePattern.test(d.label || ''));
            const chosen = headphone || physical[0] || null;
            this.state.outputDeviceId = chosen != null ? chosen.deviceId : '';
        } catch (err) {
            // 検出失敗は致命的でない（既定出力にフォールバック）
            this.state.outputDeviceId = '';
        }
    }

    /**
     * 翻訳音声の出力先を物理スピーカー/ヘッドホンへ固定する（setSinkId）。
     *
     * @param {HTMLMediaElement|AudioContext} target setSinkId を持つ再生ターゲット
     *   （<audio> 要素 / 出力用 AudioContext のいずれも可）
     * @returns {Promise<void>}
     */
    async applyOutputSink(target) {
        if (target == null || typeof target.setSinkId !== 'function') {
            return;
        }
        // 未検出（null）なら一度だけ自動検出する（gaplessパスが接続前に走る場合の保険）
        if (this.state.outputDeviceId == null) {
            await this.autoDetectPhysicalSpeaker();
        }
        const deviceId = this.state.outputDeviceId;
        if (!deviceId) {
            return; // 物理デバイス無し→既定出力のまま（仮想カードしか無い環境のフォールバック）
        }
        try {
            await target.setSinkId(deviceId);
        } catch (err) {
            // setSinkId 失敗（未対応/権限/デバイス消失）は致命的でない。既定出力にフォールバック。
        }
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
    }

    async connect() {
        if (!this.state.apiKey) {
            this.notify('エラー', 'APIキーを入力してください', 'error');
            return;
        }

        // 接続開始時にトランスクリプトをクリア
        this.clearTranscript('both');
        this.normalizeRealtimeEndpointModel();

        // 翻訳音声の出力先(物理スピーカー/ヘッドホン)を毎接続で再検出する。
        // 既定出力が仮想サウンドカードでも、訳音は物理デバイスから聞こえるようにするため。
        await this.autoDetectPhysicalSpeaker();

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
                    // セッション開始失敗でも接続は続行（履歴は保存されない）
                    this.notify('警告', '会話履歴セッションの開始に失敗しました', 'error');
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
            } catch (error) {
                this.notify('警告', '会話履歴セッションの終了処理に失敗しました', 'error');
            }
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
     *   音声認識(左カラム)を有効にするための transcription 設定を返す。
     *   ※ このエンドポイントは language/prompt を受け付けないため model のみ。
     *
     * @returns {Object} audio.input.transcription に渡す設定
     */
    buildInputTranscriptionConfig() {
        // ※ /v1/realtime/translations の transcription が受理するのは `model` のみ。
        //   `language` を渡すと 400 Unknown parameter:
        //   'session.audio.input.transcription.language' になるため指定しない。
        //   入力言語(state.sourceLang)は Chat API 翻訳プロンプト・言語検出のバイアスとして使う。
        return {
            model: CONFIG.API.TRANSCRIBE_MODEL || 'gpt-realtime-whisper'
        };
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
            // 翻訳音声を物理スピーカー/ヘッドホンへ固定（既定出力が仮想カードでも聞こえるように）
            await this.applyOutputSink(audioEl);
            // 音声出力モードに応じてミュート/再生を反映
            this.applyAudioOutputMode();
            pc.ontrack = (event) => {
                if (event.streams && event.streams[0]) {
                    audioEl.srcObject = event.streams[0];
                    // トラック着信後にも再生状態を反映（autoplayブロック対策）
                    this.applyAudioOutputMode();
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
            } catch (e) {
                // 解放処理の失敗は無害なため無視
            }
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
            } catch (e) {
                // 解放処理の失敗は無害なため無視
            }
            this.state.pc = null;
        }
        if (this.state.translatedAudioEl) {
            try {
                this.state.translatedAudioEl.srcObject = null;
            } catch (e) {
                // 解放処理の失敗は無害なため無視
            }
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
            // ✅ キャプチャ方式はプラットフォームで自動決定（出力モードとは独立）
            //   Electron → 仮想サウンドカード(VB-CABLE)を監視（原声分離・回灌に最強）
            //   ブラウザ → getDisplayMedia（タブ音声共有）で会議タブを監視
            if (this.platform.isElectron) {
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
        // 手動選択UIは廃止。未取得なら自動検出を試みる。
        if (!this.state.virtualCardDeviceId) {
            await this.autoDetectVirtualCard();
        }
        const deviceId = this.state.virtualCardDeviceId;
        if (!deviceId) {
            // 仮想カード未検出のまま開始すると無音を監視し続けるため、明確にブロックして導入手順を案内する
            this.notify(
                '仮想サウンドカード未検出',
                'システム音声の翻訳には仮想サウンドカードが必要です。VB-CABLEを導入し、会議アプリ/既定の出力先を「CABLE Input」に設定してください。',
                'error'
            );
            throw new Error('仮想サウンドカードが見つかりません（VB-CABLE未導入/未配線）');
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
        // ※ マイクモードでは echoCancellation / noiseSuppression を強制ONにする。
        //   翻訳音声が同一マシンのスピーカーから出るため、ブラウザのAEC無しだと
        //   マイクが訳音声を拾い直して翻訳モデルが自分の出力を再入力→認識崩れ・取りこぼし
        //   （ループバック）が起きる。同時通訳アプリの標準対策。
        //   （監視/システム音声モードは startSystemAudioCapture 側で別途設定する）
        const config = {
            // ★マイクは sampleRate を固定しない（ネイティブ48k等で採集）。24k固定だと
            //   ブラウザのAEC(APM)が十分働かず、スピーカーの訳音がマイクに乗って認識が崩れる。
            //   入力AudioContextは24kのため取り込み時に自動で24kへ落ち、送信形式は不変（リサンプル不要）。
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true // 旧トグル既定値(ON)を固定
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
            // ★システム/タブ音声はデジタルのクリーン音源。マイク用の AEC/NS/AGC をかけると
            //   歪み・減衰で認識が劣化する（タブ捕獲に echoCancellation を当てる典型アンチパターン）。
            //   生音のまま STT へ渡す＝監視モードの認識強化。マイク採集(別経路)には影響しない。
            echoCancellation: false,
            noiseSuppression: false,
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
        } catch (error) {
            // キャプチャ停止は上で通知済み。停止処理の例外はここでは無視
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
                // ハンドラ内で通知済みのため無視
            }
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
        } catch (error) {
            // キャプチャ停止は上で通知済み。停止処理の例外はここでは無視
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
                // ハンドラ内で通知済みのため無視
            }
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

    /**
     * マイク入力をネイティブレートから送信用24kHz(CONFIG.AUDIO.SAMPLE_RATE)へ変換する。
     * 入力AudioContextをネイティブレート化（AEC有効化）したため、下流(VAD/バッファ/送信)が
     * 従来どおり24kを受け取れるよう、worklet/Processorの受信直後にここで24kへ落とす。
     * @param {Float32Array} input - ネイティブレートのモノラルPCM
     * @param {number} srcRate - 入力サンプルレート（this.state.audioContext.sampleRate）
     * @returns {Float32Array} 24kHzモノラルPCM（srcRate===24kやデータ空はそのまま返す）
     */
    resampleMicTo24k(input, srcRate) {
        const TARGET = CONFIG.AUDIO.SAMPLE_RATE; // 24000
        if (!input || input.length === 0 || !srcRate || srcRate === TARGET) {
            return input;
        }
        // 整数倍（48k→2, 96k→4）: グループ平均で間引き（アンチエイリアス付き・長さ厳密）
        if (srcRate % TARGET === 0) {
            const factor = srcRate / TARGET;
            const outLen = Math.floor(input.length / factor);
            const out = new Float32Array(outLen);
            for (let i = 0; i < outLen; i++) {
                let sum = 0;
                const base = i * factor;
                for (let j = 0; j < factor; j++) {
                    sum += input[base + j];
                }
                out[i] = sum / factor;
            }
            return out;
        }
        // 非整数（44.1k等）: フレーム内線形補間（STT用途で十分）
        const step = srcRate / TARGET;
        const outLen = Math.max(1, Math.floor(input.length / step));
        const out = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
            const pos = i * step;
            const idx = Math.floor(pos);
            const frac = pos - idx;
            const a = input[idx];
            const b = idx + 1 < input.length ? input[idx + 1] : a;
            out[i] = a + (b - a) * frac;
        }
        return out;
    }

    async setupAudioProcessing() {
        // AudioContext設定
        // ★入力はネイティブレートで採集する（sampleRateを固定しない）。
        //   24k固定だとブラウザのAEC(APM, ネイティブ48k等で動作)が無効化され、スピーカーの
        //   翻訳音(TTS)がマイクに乗って認識・再翻訳されてしまう（自己ループ）。ネイティブ採集で
        //   AECを効かせ、送信直前に resampleMicTo24k() で24kへ落とす（下流は従来どおり24k）。
        this.state.audioContext = new (globalThis.AudioContext || globalThis.webkitAudioContext)();

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

                    // ★ネイティブレート採集→送信用24kへ変換（下流は全て24k前提のまま）
                    const inputData = this.resampleMicTo24k(
                        event.data.data,
                        this.state.audioContext.sampleRate
                    );

                    // ✅ Phase 3: 音声データバッファリング（VAD有効無効に関わらず）
                    if (this.isBufferingAudio) {
                        // 音声データをバッファにコピー
                        const audioChunk = new Float32Array(inputData.length);
                        audioChunk.set(inputData);
                        this.audioBuffer.push(audioChunk);
                    }

                    // ✅ 監視先の無音自動検証（開始直後の一定時間だけエネルギーを観測）
                    //    ※ ScriptProcessor フォールバック経路と同様に必ず feed する。
                    //      これが無いと maxEnergy が 0 のままになり、実際は音が鳴っていても
                    //      「無音」と誤判定して監視先を勝手に切替→「音声が検出できません」を誤発火する。
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

                // ★ネイティブレート採集→送信用24kへ変換（下流は全て24k前提のまま）
                const inputData = this.resampleMicTo24k(
                    e.inputBuffer.getChannelData(0),
                    this.state.audioContext.sampleRate
                );

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
            } catch (e) {
                // 解放処理の失敗は無害なため無視
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
            } catch (e) {
                // 解放処理の失敗は無害なため無視
            }
            this.state.audioSource = null;
        }

        // GainNode
        if (this.state.inputGainNode) {
            try {
                this.state.inputGainNode.disconnect();
            } catch (e) {
                // 解放処理の失敗は無害なため無視
            }
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
            // 翻訳音声は既定スピーカーで再生（出力先分離は廃止）
        }

        // AudioContextがsuspended状態の場合はresume
        if (this.state.outputAudioContext.state === 'suspended') {
            await this.state.outputAudioContext.resume();
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
        // ✅ キューをクリア
        this.playbackQueue = [];

        // ✅ ギャップレス予約で先読みスケジュール済みのソースを全て停止（割込み）
        if (this._activeSources) {
            for (const source of this._activeSources) {
                try {
                    source.stop();
                } catch (error) {
                    // 既に停止している場合は無視
                }
            }
            this._activeSources.clear();
        }

        // ✅ 現在再生中の音声を停止
        if (this.currentAudioSource) {
            try {
                this.currentAudioSource.stop();
            } catch (error) {
                // 既に停止している場合はエラーを無視
            }
            this.currentAudioSource = null;
        }

        // ✅ 連結カーソルと直列チェーンをリセット（次の翻訳は現在時刻から開始）
        this._nextPlaybackTime = 0;
        this._playbackChain = null;

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

        // 出力言語を更新する。併せて入力転写(audio.input.transcription)も必ず再送する。
        // ※ このAPIは session.update の audio を「マージではなく置換」するため、
        //   output だけ送ると input.transcription が消え、左カラム(音声認識)が止まる。
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
