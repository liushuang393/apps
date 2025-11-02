/**
 * 音声キャプチャ戦略の基底クラス
 * 目的:
 *   プラットフォーム固有の音声キャプチャ実装を抽象化
 *   低結合・高凝集を実現
 * 設計原則:
 *   - Strategy パターンを適用
 *   - プラットフォーム判定を一箇所に集約
 *   - 共通処理は基底クラスで実装
 */

/**
 * 音声キャプチャ戦略インターフェース
 */
class AudioCaptureStrategy {
    /**
     * コンストラクタ
     *
     * @param {Object} config - 設定オブジェクト
     * @param {number} config.sampleRate - サンプルレート
     * @param {boolean} config.echoCancellation - エコーキャンセレーション
     * @param {boolean} config.noiseSuppression - ノイズ抑制
     * @param {boolean} config.autoGainControl - 自動ゲイン制御
     */
    constructor(config) {
        this.config = config;
    }

    /**
     * 音声キャプチャを開始
     *
     * @returns {Promise<MediaStream>} - 音声ストリーム
     * @throws {Error} - キャプチャ失敗時
     */
    async capture() {
        throw new Error('capture() must be implemented by subclass');
    }

    /**
     * 音声トラックの有効性をチェック
     *
     * @param {MediaStream} stream - 音声ストリーム
     * @returns {boolean} - 音声トラックが有効かどうか
     */
    validateAudioTrack(stream) {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn('[AudioCapture] 音声トラックがありません');
            return false;
        }
        console.info('[AudioCapture] 音声トラック検出:', audioTracks[0].label);
        return true;
    }

    /**
     * ビデオトラックを停止
     *
     * @param {MediaStream} stream - 音声ストリーム
     */
    stopVideoTracks(stream) {
        const videoTracks = stream.getVideoTracks();
        videoTracks.forEach((track) => {
            console.info('[AudioCapture] ビデオトラック停止:', track.label);
            track.stop();
        });
    }
}

/**
 * Electron環境用の音声キャプチャ戦略
 */
class ElectronAudioCaptureStrategy extends AudioCaptureStrategy {
    /**
     * コンストラクタ
     *
     * @param {Object} config - 設定オブジェクト
     * @param {string} config.sourceId - 音声ソースID
     */
    constructor(config) {
        super(config);
        this.sourceId = config.sourceId;
    }

    /**
     * Electron環境で音声キャプチャを開始
     *
     * @returns {Promise<MediaStream>} - 音声ストリーム
     */
    async capture() {
        console.info('[ElectronAudioCapture] 音声キャプチャ開始:', this.sourceId);

        try {
            // getUserMedia で音声をキャプチャ
            // Electron環境では mandatory 形式を使用（echoCancellation は使用不可）
            const constraints = {
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: this.sourceId
                    }
                },
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: this.sourceId
                    }
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            // ビデオトラックを停止
            this.stopVideoTracks(stream);

            // 音声トラックがない場合は警告（会議アプリで音声がまだ開始されていない可能性）
            if (!this.validateAudioTrack(stream)) {
                console.warn(
                    '[ElectronAudioCapture] 音声トラックがありません（会議が開始されていない可能性）'
                );
                // Electron環境では音声トラックがなくても続行（後で追加される可能性がある）
            }

            console.info('[ElectronAudioCapture] 音声キャプチャ成功');
            return stream;
        } catch (error) {
            console.error('[ElectronAudioCapture] 音声キャプチャ失敗:', error);
            throw new Error(
                '音声キャプチャに失敗しました。\n' + '会議アプリが起動しているか確認してください。'
            );
        }
    }
}

/**
 * ブラウザ環境用の音声キャプチャ戦略
 */
class BrowserAudioCaptureStrategy extends AudioCaptureStrategy {
    /**
     * コンストラクタ
     *
     * @param {Object} config - 設定オブジェクト
     * @param {MediaStream} config.preSelectedStream - 事前選択されたストリーム（オプション）
     */
    constructor(config) {
        super(config);
        this.preSelectedStream = config.preSelectedStream;
    }

    /**
     * ブラウザ環境で音声キャプチャを開始
     *
     * @returns {Promise<MediaStream>} - 音声ストリーム
     */
    async capture() {
        console.info('[BrowserAudioCapture] 音声キャプチャ開始');

        try {
            let stream;

            // 事前選択されたストリームがある場合はそれを使用
            if (this.preSelectedStream) {
                console.info('[BrowserAudioCapture] 事前選択されたストリームを使用');
                stream = this.preSelectedStream;
            } else {
                // getDisplayMedia で選択ダイアログを表示
                console.info('[BrowserAudioCapture] 画面/ウィンドウ選択ダイアログを表示');

                // ブラウザ環境の場合、設定に基づいて回音消除を適用
                const constraints = {
                    audio: {
                        channelCount: 1,
                        sampleRate: this.config.sampleRate,
                        echoCancellation: this.config.echoCancellation,
                        noiseSuppression: this.config.noiseSuppression,
                        autoGainControl: this.config.autoGainControl
                    },
                    video: true // 互換性のため
                };

                stream = await navigator.mediaDevices.getDisplayMedia(constraints);

                // ビデオトラックを停止
                this.stopVideoTracks(stream);
            }

            // ✅ 音声トラックの有効性をチェック（ブラウザ環境では必須）
            if (!this.validateAudioTrack(stream)) {
                // 音声トラックがない場合はストリームを停止してエラー
                stream.getTracks().forEach((track) => track.stop());

                throw new Error(
                    '音声トラックが検出されませんでした。\n\n' +
                        '【重要】getDisplayMedia() で音声をキャプチャするには:\n' +
                        '1. 「タブ」を選択してください（画面/ウィンドウでは音声が含まれません）\n' +
                        '2. または、音声ソースを「マイク」に変更してください\n\n' +
                        '詳細: Chromeの仕様により、画面全体やウィンドウを選択した場合、\n' +
                        '音声トラックは含まれません。タブを選択すると音声が含まれます。'
                );
            }

            console.info('[BrowserAudioCapture] 音声キャプチャ成功');
            return stream;
        } catch (error) {
            console.error('[BrowserAudioCapture] 音声キャプチャ失敗:', error);

            // エラーメッセージがすでに詳細な場合はそのまま投げる
            if (error.message.includes('getDisplayMedia')) {
                throw error;
            }

            throw new Error(
                'システム音声のキャプチャに失敗しました。\n' + 'ブラウザタブを選択してください。'
            );
        }
    }
}

/**
 * マイク用の音声キャプチャ戦略
 */
class MicrophoneAudioCaptureStrategy extends AudioCaptureStrategy {
    /**
     * マイクで音声キャプチャを開始
     *
     * @returns {Promise<MediaStream>} - 音声ストリーム
     */
    async capture() {
        console.info('[MicrophoneAudioCapture] マイクキャプチャ開始');

        try {
            const constraints = {
                audio: {
                    channelCount: 1,
                    sampleRate: this.config.sampleRate,
                    echoCancellation: this.config.echoCancellation,
                    noiseSuppression: this.config.noiseSuppression,
                    autoGainControl: this.config.autoGainControl
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            console.info('[MicrophoneAudioCapture] マイクキャプチャ成功');
            return stream;
        } catch (error) {
            console.error('[MicrophoneAudioCapture] マイクキャプチャ失敗:', error);

            if (error.name === 'NotAllowedError') {
                throw new Error(
                    'マイク権限が拒否されました。\n' +
                        'ブラウザの設定からマイクへのアクセスを許可してください。'
                );
            } else if (error.name === 'NotFoundError') {
                throw new Error(
                    'マイクが見つかりません。\n' + 'マイクが接続されているか確認してください。'
                );
            }

            throw new Error('マイクアクセスに失敗しました: ' + error.message);
        }
    }
}

/**
 * 音声キャプチャ戦略ファクトリー
 *
 * 目的:
 *   プラットフォームと音声ソースタイプに応じた戦略を生成
 *   プラットフォーム判定を一箇所に集約
 */
class AudioCaptureStrategyFactory {
    /**
     * 音声キャプチャ戦略を作成
     *
     * @param {Object} options - オプション
     * @param {string} options.sourceType - 音声ソースタイプ ('system' | 'microphone')
     * @param {Object} options.config - 音声設定
     * @param {string} options.sourceId - 音声ソースID（Electron環境のみ）
     * @param {MediaStream} options.preSelectedStream - 事前選択されたストリーム（ブラウザ環境のみ）
     * @param {string} options.deviceId - 音声入力デバイスID（マイクモードのみ）
     * @returns {AudioCaptureStrategy} - 音声キャプチャ戦略
     */
    static createStrategy(options) {
        const { sourceType, config, sourceId, preSelectedStream } = options;

        // マイクの場合
        if (sourceType === 'microphone') {
            return new MicrophoneAudioCaptureStrategy(config);
        }

        // システム音声の場合
        const isElectron =
            typeof globalThis.window !== 'undefined' && globalThis.window.electronAPI;

        if (isElectron) {
            // Electron環境
            return new ElectronAudioCaptureStrategy({
                ...config,
                sourceId
            });
        } else {
            // ブラウザ環境
            return new BrowserAudioCaptureStrategy({
                ...config,
                preSelectedStream
            });
        }
    }
}

// エクスポート
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AudioCaptureStrategy,
        ElectronAudioCaptureStrategy,
        BrowserAudioCaptureStrategy,
        MicrophoneAudioCaptureStrategy,
        AudioCaptureStrategyFactory
    };
}
