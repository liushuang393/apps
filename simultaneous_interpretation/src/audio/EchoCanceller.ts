/**
 * EchoCanceller.ts
 *
 * 目的: NLMS適応フィルタによるエコーキャンセル機能の管理
 *
 * 機能:
 *   - AudioWorkletベースのエコーキャンセル
 *   - 遅延補償（最大50ms）
 *   - 双端通話検出
 *   - 残余回声抑制
 *   - エコー除去率測定
 *
 * 使用方法:
 *   const echoCanceller = new EchoCanceller(audioContext);
 *   await echoCanceller.initialize();
 *   const outputNode = await echoCanceller.process(micStream, speakerStream);
 *
 * 注意:
 *   - AudioWorklet対応ブラウザが必要
 *   - マイク入力とスピーカー出力の両方が必要
 *   - 処理遅延は約2.67ms（128サンプル @ 48kHz）
 */

import { defaultLogger } from '../utils/Logger';

/**
 * エコーキャンセル設定
 */
export interface EchoCancellerConfig {
    enabled: boolean; // エコーキャンセル有効化
    filterLength: number; // 適応フィルタ長（サンプル数）
    stepSize: number; // NLMS ステップサイズ（0.0-1.0）
    regularization: number; // 正則化パラメータ
    dtdThreshold: number; // 双端通話検出閾値
    resThreshold: number; // 残余回声抑制閾値
    maxDelay: number; // 最大遅延（サンプル数）
}

/**
 * エコーキャンセル統計
 */
export interface EchoCancellerStats {
    echoReductionDB: number; // エコー除去量（dB）
    filterConverged: boolean; // フィルタ収束状態
    doubleTalkDetected: boolean; // 双端通話検出状態
    processedFrames: number; // 処理フレーム数
}

/**
 * EchoCanceller クラス
 *
 * 目的: AudioWorkletベースのエコーキャンセル処理を管理
 */
export class EchoCanceller {
    private audioContext: AudioContext;
    private config: EchoCancellerConfig;
    private workletNode: AudioWorkletNode | null = null;
    private micSourceNode: MediaStreamAudioSourceNode | null = null;
    private speakerSourceNode: MediaStreamAudioSourceNode | null = null;
    private outputDestination: MediaStreamAudioDestinationNode | null = null;
    private isInitialized: boolean = false;
    private stats: EchoCancellerStats = {
        echoReductionDB: 0,
        filterConverged: false,
        doubleTalkDetected: false,
        processedFrames: 0
    };

    constructor(audioContext: AudioContext, config?: Partial<EchoCancellerConfig>) {
        this.audioContext = audioContext;
        this.config = {
            enabled: config?.enabled ?? true,
            filterLength: config?.filterLength ?? 512, // 約10.7ms @ 48kHz
            stepSize: config?.stepSize ?? 0.5,
            regularization: config?.regularization ?? 0.001,
            dtdThreshold: config?.dtdThreshold ?? 0.5,
            resThreshold: config?.resThreshold ?? 0.01,
            maxDelay: config?.maxDelay ?? 2400 // 50ms @ 48kHz
        };

        defaultLogger.info('[EchoCanceller] 初期化', this.config);
    }

    /**
     * AudioWorklet初期化
     *
     * 目的: echo-canceller-worklet.jsをロードして準備
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            defaultLogger.warn('[EchoCanceller] 既に初期化済み');
            return;
        }

        try {
            // AudioWorkletモジュールをロード
            await this.audioContext.audioWorklet.addModule('echo-canceller-worklet.js');

            defaultLogger.info('[EchoCanceller] AudioWorkletモジュールロード完了');
            this.isInitialized = true;
        } catch (error) {
            defaultLogger.error('[EchoCanceller] AudioWorkletモジュールロード失敗:', error);
            throw new Error('エコーキャンセルの初期化に失敗しました');
        }
    }

    /**
     * エコーキャンセル処理を適用
     *
     * 目的: マイク入力とスピーカー出力からエコーを除去
     *
     * @param micStream マイク入力ストリーム
     * @param speakerStream スピーカー出力ストリーム
     * @returns エコーキャンセル済み出力ノード
     */
    async process(
        micStream: MediaStream,
        speakerStream: MediaStream
    ): Promise<MediaStreamAudioDestinationNode> {
        if (!this.isInitialized) {
            throw new Error(
                'EchoCancellerが初期化されていません。initialize()を先に呼び出してください'
            );
        }

        if (!this.config.enabled) {
            // エコーキャンセル無効の場合はパススルー
            defaultLogger.info('[EchoCanceller] エコーキャンセル無効 - パススルー');
            return this.createPassthrough(micStream);
        }

        try {
            // AudioWorkletNode作成
            this.workletNode = new AudioWorkletNode(this.audioContext, 'echo-canceller-worklet', {
                numberOfInputs: 2, // マイク + スピーカー
                numberOfOutputs: 1, // エコーキャンセル済み出力
                processorOptions: this.config
            });

            // 統計情報受信
            this.workletNode.port.onmessage = (event) => {
                if (event.data.type === 'stats') {
                    this.stats = event.data.data;
                    defaultLogger.debug('[EchoCanceller] 統計更新', this.stats);
                }
            };

            // マイク入力ソース作成
            this.micSourceNode = this.audioContext.createMediaStreamSource(micStream);

            // スピーカー出力ソース作成
            this.speakerSourceNode = this.audioContext.createMediaStreamSource(speakerStream);

            // 出力先作成
            this.outputDestination = this.audioContext.createMediaStreamDestination();

            // 接続: マイク → WorkletNode(input 0)
            this.micSourceNode.connect(this.workletNode, 0, 0);

            // 接続: スピーカー → WorkletNode(input 1)
            this.speakerSourceNode.connect(this.workletNode, 0, 1);

            // 接続: WorkletNode → 出力
            this.workletNode.connect(this.outputDestination);

            defaultLogger.info('[EchoCanceller] エコーキャンセル処理開始');

            return this.outputDestination;
        } catch (error) {
            defaultLogger.error('[EchoCanceller] エコーキャンセル処理失敗:', error);
            throw error;
        }
    }

    /**
     * パススルー処理（エコーキャンセル無効時）
     *
     * @param micStream マイク入力ストリーム
     * @returns パススルー出力ノード
     */
    private createPassthrough(micStream: MediaStream): MediaStreamAudioDestinationNode {
        const source = this.audioContext.createMediaStreamSource(micStream);
        const destination = this.audioContext.createMediaStreamDestination();
        source.connect(destination);
        return destination;
    }

    /**
     * 設定更新
     *
     * @param config 新しい設定
     */
    updateConfig(config: Partial<EchoCancellerConfig>): void {
        this.config = {
            ...this.config,
            ...config
        };

        // WorkletNodeに設定を送信
        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'updateConfig',
                config: this.config
            });
        }

        defaultLogger.info('[EchoCanceller] 設定更新', this.config);
    }

    /**
     * リセット
     *
     * 目的: フィルタ係数とバッファをリセット
     */
    reset(): void {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'reset' });
            defaultLogger.info('[EchoCanceller] リセット完了');
        }
    }

    /**
     * 統計情報取得
     *
     * @returns エコーキャンセル統計
     */
    getStats(): EchoCancellerStats {
        return { ...this.stats };
    }

    /**
     * 統計情報を要求（非同期）
     *
     * @returns Promise<EchoCancellerStats>
     */
    async requestStats(): Promise<EchoCancellerStats> {
        return new Promise((resolve) => {
            if (!this.workletNode) {
                resolve(this.stats);
                return;
            }

            // 一時的なメッセージハンドラー
            const handler = (event: MessageEvent) => {
                if (event.data.type === 'stats') {
                    this.stats = event.data.data;
                    this.workletNode!.port.removeEventListener('message', handler);
                    resolve(this.stats);
                }
            };

            this.workletNode.port.addEventListener('message', handler);
            this.workletNode.port.postMessage({ type: 'getStats' });
        });
    }

    /**
     * クリーンアップ
     *
     * 目的: リソースを解放
     */
    cleanup(): void {
        defaultLogger.info('[EchoCanceller] クリーンアップ開始');

        // ノードの切断
        if (this.micSourceNode) {
            this.micSourceNode.disconnect();
            this.micSourceNode = null;
        }

        if (this.speakerSourceNode) {
            this.speakerSourceNode.disconnect();
            this.speakerSourceNode = null;
        }

        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        this.outputDestination = null;

        defaultLogger.info('[EchoCanceller] クリーンアップ完了');
    }
}

/**
 * シナリオ別推奨設定取得
 *
 * @param scenario シナリオ（'meeting', 'daily', 'presentation'）
 * @returns 推奨設定
 */
export function getRecommendedECConfig(scenario: string): Partial<EchoCancellerConfig> {
    switch (scenario) {
        case 'meeting':
            // 会議: 双端通話が多い
            return {
                enabled: true,
                filterLength: 512,
                stepSize: 0.3, // 保守的
                dtdThreshold: 0.3, // 低め（双端通話を積極的に検出）
                resThreshold: 0.015
            };
        case 'daily':
            // 日常会話: バランス重視
            return {
                enabled: true,
                filterLength: 512,
                stepSize: 0.5,
                dtdThreshold: 0.5,
                resThreshold: 0.01
            };
        case 'presentation':
            // プレゼン: 一方向が多い
            return {
                enabled: true,
                filterLength: 1024, // 長め
                stepSize: 0.7, // 積極的
                dtdThreshold: 0.7, // 高め
                resThreshold: 0.005
            };
        default:
            return {
                enabled: true,
                filterLength: 512,
                stepSize: 0.5,
                dtdThreshold: 0.5,
                resThreshold: 0.01
            };
    }
}
