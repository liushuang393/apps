/**
 * VoiceTranslateCore.integration.example.ts
 *
 * 目的: ResponseStateManager と ImprovedResponseQueue の統合例
 *
 * このファイルは、既存の VoiceTranslateCore.ts に統合する方法を示します。
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { ResponseStateManager, ResponseState } from './ResponseStateManager';
import { ImprovedResponseQueue, ResponseRequest } from './ImprovedResponseQueue';
import { WebSocketManager } from './WebSocketManager';
import { AudioManager } from './AudioManager';
import { UIManager } from './UIManager';

/**
 * VoiceTranslateCore の統合例
 *
 * 既存のコードを以下のように変更します：
 */
export class VoiceTranslateCoreIntegrationExample {
    // ✅ 新しい状態管理
    private stateManager: ResponseStateManager;
    private responseQueue: ImprovedResponseQueue;

    // 既存のマネージャー
    private wsManager: WebSocketManager;
    private audioManager: AudioManager;
    private uiManager: UIManager;

    constructor() {
        // ✅ 状態マネージャーを初期化
        this.stateManager = new ResponseStateManager();

        // ✅ レスポンスキューを初期化
        this.responseQueue = new ImprovedResponseQueue(this.stateManager, {
            timeout: 30000,
            debugMode: true,
            processingDelay: 100
        });

        // 既存のマネージャー初期化
        this.wsManager = new WebSocketManager();
        this.audioManager = new AudioManager();
        this.uiManager = new UIManager();

        // ✅ WebSocket 送信関数を設定
        this.responseQueue.setSendFunction((message) => {
            this.wsManager.sendMessage(message);
        });

        // ✅ 状態遷移リスナーを設定（オプション）
        this.stateManager.addListener((event) => {
            console.info('[App] State transition:', event);
            this.updateUIForStateChange(event);
        });
    }

    /**
     * 初期化
     */
    async init(): Promise<void> {
        // WebSocket イベントハンドラーを設定
        this.setupWebSocketHandlers();

        // 既存の初期化処理...
    }

    /**
     * WebSocket イベントハンドラーを設定
     */
    private setupWebSocketHandlers(): void {
        this.wsManager.setMessageHandlers({
            // ✅ input_audio_buffer.committed
            onAudioBufferCommitted: () => {
                this.handleAudioBufferCommitted();
            },

            // ✅ response.created
            onResponseCreated: (responseId: string) => {
                this.handleResponseCreated(responseId);
            },

            // ✅ response.done
            onResponseDone: (responseId: string) => {
                this.handleResponseDone(responseId);
            },

            // ✅ error
            onError: (error: Error, code?: string) => {
                this.handleWSError(error, code);
            }
        });
    }

    /**
     * 音声バッファコミット処理
     *
     * ✅ 改善点:
     *   - stateManager.canCreateResponse() で状態チェック
     *   - responseQueue.enqueue() でキューイング
     *   - エラーハンドリング強化
     */
    private handleAudioBufferCommitted(): void {
        console.info('[Audio] Buffer committed');

        // ✅ 状態チェック
        if (!this.stateManager.canCreateResponse()) {
            console.warn('[Audio] Cannot create response:', {
                state: this.stateManager.getState(),
                activeId: this.stateManager.getActiveResponseId()
            });
            return;
        }

        // ✅ レスポンス作成
        this.createResponse();
    }

    /**
     * レスポンス作成
     *
     * ✅ 改善点:
     *   - async/await で実装
     *   - エラーハンドリング
     */
    private async createResponse(): Promise<void> {
        try {
            const request: ResponseRequest = {
                modalities: this.getModalities(),
                instructions: this.getInstructions()
            };

            // ✅ キューに追加（状態チェックは enqueue 内で実行）
            await this.responseQueue.enqueue(request);

            console.info('[Response] Request queued successfully');
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('Cannot create response')) {
                    // 作成不可（正常）
                    console.info('[Response] Skipped: active response exists');
                } else {
                    // その他のエラー
                    console.error('[Response] Failed to queue request:', error);
                    this.showError('レスポンス作成に失敗しました');
                }
            }
        }
    }

    /**
     * レスポンス作成通知を処理
     *
     * ✅ 改善点:
     *   - stateManager.transition() で状態遷移
     *   - responseQueue.handleResponseCreated() でキュー通知
     */
    private handleResponseCreated(responseId: string): void {
        console.info('[Response] Created:', responseId);

        try {
            // ✅ 状態遷移: PENDING → ACTIVE
            this.stateManager.transition(ResponseState.RESPONSE_ACTIVE, responseId);

            // ✅ キューに通知
            this.responseQueue.handleResponseCreated(responseId);

            // UI 更新
            this.uiManager.updateStatus('recording', '処理中...');
        } catch (error) {
            console.error('[Response] Failed to handle response.created:', error);
        }
    }

    /**
     * レスポンス完了通知を処理
     *
     * ✅ 改善点:
     *   - stateManager.transition() で状態遷移
     *   - responseQueue.handleResponseDone() でキュー通知
     */
    private handleResponseDone(responseId: string): void {
        console.info('[Response] Done:', responseId);

        try {
            // ✅ 状態遷移: ACTIVE → COMPLETING → IDLE
            this.stateManager.transition(ResponseState.RESPONSE_COMPLETING);
            this.stateManager.transition(ResponseState.IDLE);

            // ✅ キューに通知（次のリクエストを処理）
            this.responseQueue.handleResponseDone(responseId);

            // UI 更新
            this.uiManager.updateStatus('recording', '待機中');
        } catch (error) {
            console.error('[Response] Failed to handle response.done:', error);

            // エラー時は状態をリセット
            this.stateManager.reset();
        }
    }

    /**
     * WebSocket エラー処理
     *
     * ✅ 改善点:
     *   - responseQueue.handleError() でキュー通知
     *   - エラーコードに応じた処理
     */
    private handleWSError(error: Error, code?: string): void {
        console.error('[WebSocket] Error:', error, code);

        // ✅ キューにエラーを通知
        this.responseQueue.handleError(error, code);

        // エラーコード別処理
        if (code === 'conversation_already_has_active_response') {
            this.showWarning('前のレスポンスが処理中です。しばらくお待ちください。');
        } else if (code === 'invalid_api_key') {
            this.showError('API キーが無効です');
        } else {
            this.showError(`エラーが発生しました: ${error.message}`);
        }
    }

    /**
     * 状態変化に応じた UI 更新
     *
     * ✅ 新機能: 状態遷移をUIに反映
     */
    private updateUIForStateChange(event: {
        from: ResponseState;
        to: ResponseState;
        responseId?: string;
    }): void {
        // 状態に応じたUI更新
        switch (event.to) {
            case ResponseState.IDLE:
                this.uiManager.updateStatus('recording', '待機中');
                break;

            case ResponseState.AUDIO_BUFFERING:
                this.uiManager.updateStatus('recording', '音声バッファリング中');
                break;

            case ResponseState.RESPONSE_PENDING:
                this.uiManager.updateStatus('recording', 'リクエスト送信中');
                break;

            case ResponseState.RESPONSE_ACTIVE:
                this.uiManager.updateStatus('recording', '翻訳処理中');
                break;

            default:
                break;
        }
    }

    /**
     * デバッグ情報を表示
     */
    showDebugInfo(): void {
        const stateInfo = this.stateManager.getDebugInfo();
        const queueInfo = this.responseQueue.getDebugInfo();

        // eslint-disable-next-line no-console
        console.group('[Debug Info]');
        console.info('State:', stateInfo);
        console.info('Queue:', queueInfo);
        console.info('History:', this.stateManager.getHistory(5));
        // eslint-disable-next-line no-console
        console.groupEnd();
    }

    /**
     * ヘルパーメソッド
     */
    private getModalities(): string[] {
        // 既存のロジック
        return ['text', 'audio'];
    }

    private getInstructions(): string {
        // 既存のロジック
        return 'Translate to target language';
    }

    private showError(message: string): void {
        // 既存のロジック
        console.error(message);
    }

    private showWarning(message: string): void {
        // 既存のロジック
        console.warn(message);
    }

    /**
     * クリーンアップ
     */
    async dispose(): Promise<void> {
        // キューをクリア
        this.responseQueue.clear();

        // 既存のクリーンアップ処理...
        await this.audioManager.stopRecording();
        await this.wsManager.disconnect();
    }
}

/**
 * 使用例
 */
export async function example() {
    const app = new VoiceTranslateCoreIntegrationExample();

    try {
        // 初期化
        await app.init();

        // デバッグ情報を表示
        setInterval(() => {
            app.showDebugInfo();
        }, 5000);
    } catch (error) {
        console.error('Application failed to start:', error);
    }
}
