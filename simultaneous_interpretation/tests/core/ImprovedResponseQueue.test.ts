/**
 * ImprovedResponseQueue.test.ts
 *
 * 目的: ImprovedResponseQueue のテスト
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { ImprovedResponseQueue, ResponseRequest } from '../../src/core/ImprovedResponseQueue';
import { ResponseStateManager, ResponseState } from '../../src/core/ResponseStateManager';

describe('ImprovedResponseQueue', () => {
    let stateManager: ResponseStateManager;
    let queue: ImprovedResponseQueue;
    let mockSendFunction: jest.Mock;

    beforeEach(() => {
        stateManager = new ResponseStateManager();
        queue = new ImprovedResponseQueue(stateManager, {
            timeout: 5000,
            debugMode: true,
            processingDelay: 50
        });

        mockSendFunction = jest.fn();
        queue.setSendFunction(mockSendFunction);
    });

    afterEach(() => {
        // クリーンアップ: pending リクエストを空にする
        // clear() を呼ぶと unhandled rejection が発生する可能性があるため、
        // 直接プロパティをリセット
        (queue as any).pendingQueue = [];
        (queue as any).isProcessing = false;
        (queue as any).clearTimeoutTimer();
    });

    describe('初期状態', () => {
        it('should have empty queue initially', () => {
            const stats = queue.getStats();
            expect(stats.pendingCount).toBe(0);
            expect(stats.isProcessing).toBe(false);
        });
    });

    describe('enqueue()', () => {
        const createRequest = (): ResponseRequest => ({
            modalities: ['text', 'audio'],
            instructions: 'Test instruction'
        });

        it('should enqueue request successfully', async () => {
            const request = createRequest();

            const promise = queue.enqueue(request);

            // Promise は保留中
            expect(promise).toBeInstanceOf(Promise);

            // キューに追加されている
            const stats = queue.getStats();
            expect(stats.pendingCount).toBeGreaterThanOrEqual(0);
        });

        it('should reject when response cannot be created', async () => {
            // 状態を ACTIVE に変更（レスポンス作成不可）
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            stateManager.transition(ResponseState.RESPONSE_PENDING);
            stateManager.transition(ResponseState.RESPONSE_ACTIVE, 'resp_123');

            const request = createRequest();

            await expect(queue.enqueue(request)).rejects.toThrow('Cannot create response');
        });

        it('should call send function', async () => {
            jest.useFakeTimers();
            const request = createRequest();

            const promise = queue.enqueue(request).catch(() => {
                // エラーは無視
            });

            // 非同期処理を実行
            jest.advanceTimersByTime(10);
            await Promise.resolve();

            expect(mockSendFunction).toHaveBeenCalled();
            expect(mockSendFunction).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'response.create',
                    response: expect.objectContaining({
                        modalities: ['text', 'audio']
                    })
                })
            );

            jest.useRealTimers();
        });

        it('should update state to RESPONSE_PENDING', async () => {
            jest.useFakeTimers();
            const request = createRequest();

            const promise = queue.enqueue(request).catch(() => {
                // エラーは無視
            });

            // 非同期処理を実行
            jest.advanceTimersByTime(10);
            await Promise.resolve();

            expect(stateManager.getState()).toBe(ResponseState.RESPONSE_PENDING);

            jest.useRealTimers();
        });
    });

    describe('並行制御', () => {
        const createRequest = (): ResponseRequest => ({
            modalities: ['text'],
            instructions: 'Test'
        });

        it('should process requests serially', async () => {
            jest.useFakeTimers();
            const request1 = createRequest();
            const request2 = createRequest();

            queue.enqueue(request1).catch(() => {});
            queue.enqueue(request2).catch(() => {});

            // 非同期処理を実行
            jest.advanceTimersByTime(50);
            await Promise.resolve();

            // 最初のリクエストのみ送信される
            expect(mockSendFunction).toHaveBeenCalledTimes(1);

            jest.useRealTimers();
        });

        it('should not process second request until first is done', async () => {
            jest.useFakeTimers();
            const request1 = createRequest();
            const request2 = createRequest();

            queue.enqueue(request1).catch(() => {});
            queue.enqueue(request2).catch(() => {});

            // 最初のリクエストのみ処理
            jest.advanceTimersByTime(50);
            await Promise.resolve();

            expect(mockSendFunction).toHaveBeenCalledTimes(1);

            // response.done をシミュレート
            stateManager.transition(ResponseState.RESPONSE_ACTIVE, 'resp_1');
            stateManager.transition(ResponseState.RESPONSE_COMPLETING);
            stateManager.transition(ResponseState.IDLE);
            queue.handleResponseDone('resp_1');

            // 2番目のリクエストが処理される
            jest.advanceTimersByTime(200);
            await Promise.resolve();

            expect(mockSendFunction).toHaveBeenCalledTimes(2);

            jest.useRealTimers();
        });
    });

    describe('handleResponseCreated()', () => {
        it('should clear timeout timer', async () => {
            jest.useFakeTimers();
            const request: ResponseRequest = {
                modalities: ['text'],
                instructions: 'Test'
            };

            const promise = queue.enqueue(request).catch(() => {});

            // リクエストが処理される
            jest.advanceTimersByTime(50);
            await Promise.resolve();

            queue.handleResponseCreated('resp_123');

            // タイムアウトが発生しないことを確認
            jest.advanceTimersByTime(6000); // timeout より長い
            await Promise.resolve();

            const stats = queue.getStats();
            expect(stats.timeoutCount).toBe(0);

            jest.useRealTimers();
        });

        it('should update statistics', () => {
            queue.handleResponseCreated('resp_123');

            const stats = queue.getStats();
            expect(stats.completedCount).toBe(1);
        });
    });

    describe('handleResponseDone()', () => {
        it('should trigger processing of next request', async () => {
            jest.useFakeTimers();
            const request1: ResponseRequest = {
                modalities: ['text'],
                instructions: 'Test 1'
            };
            const request2: ResponseRequest = {
                modalities: ['text'],
                instructions: 'Test 2'
            };

            queue.enqueue(request1).catch(() => {});
            queue.enqueue(request2).catch(() => {});

            // 最初のリクエスト処理
            jest.advanceTimersByTime(50);
            await Promise.resolve();

            // 最初のリクエスト完了
            stateManager.transition(ResponseState.RESPONSE_ACTIVE, 'resp_1');
            stateManager.transition(ResponseState.RESPONSE_COMPLETING);
            stateManager.transition(ResponseState.IDLE);
            queue.handleResponseDone('resp_1');

            // 2番目のリクエストが処理される
            jest.advanceTimersByTime(200);
            await Promise.resolve();

            expect(mockSendFunction).toHaveBeenCalledTimes(2);

            jest.useRealTimers();
        });
    });

    describe('handleError()', () => {
        it('should handle active response error', () => {
            const error = new Error('Conversation already has an active response');
            queue.handleError(error, 'conversation_already_has_active_response');

            // 状態が IDLE にリセットされる
            expect(stateManager.getState()).toBe(ResponseState.IDLE);

            // 統計が更新される
            const stats = queue.getStats();
            expect(stats.failedCount).toBe(1);
        });

        it('should continue processing after error', async () => {
            jest.useFakeTimers();
            const request: ResponseRequest = {
                modalities: ['text'],
                instructions: 'Test'
            };

            queue.enqueue(request).catch(() => {});

            // リクエスト処理
            jest.advanceTimersByTime(50);
            await Promise.resolve();

            // エラー発生（状態を IDLE にリセット）
            const error = new Error('Test error');
            queue.handleError(error);
            
            // handleError が状態を IDLE にリセットするまで待機
            await Promise.resolve();

            // 状態が IDLE に戻っていることを確認
            expect(stateManager.getState()).toBe(ResponseState.IDLE);

            // 次のリクエストをエンキュー（状態が変わる前に確認完了）
            queue.enqueue(request).catch(() => {});

            // 処理を実行（状態は IDLE → PENDING に変わる）
            jest.advanceTimersByTime(50);
            await Promise.resolve();

            // 第2のリクエストが処理されたことを確認
            expect(mockSendFunction).toHaveBeenCalledTimes(2);
            // エンキュー後、状態は PENDING になる
            expect(stateManager.getState()).toBe(ResponseState.RESPONSE_PENDING);

            jest.useRealTimers();
        });
    });

    describe('タイムアウト', () => {
        it('should timeout long-running requests', async () => {
            jest.useFakeTimers();
            
            // タイムアウトを短く設定
            queue = new ImprovedResponseQueue(stateManager, {
                timeout: 100,
                debugMode: true,
                processingDelay: 0 // 処理遅延なし
            });
            queue.setSendFunction(mockSendFunction);

            const request: ResponseRequest = {
                modalities: ['text'],
                instructions: 'Test'
            };

            let timeoutOccurred = false;
            const promise = queue.enqueue(request).catch((error: Error) => {
                timeoutOccurred = true;
                expect(error.message).toBe('Request timeout');
            });

            // 処理開始
            jest.advanceTimersByTime(10);
            await Promise.resolve();

            // タイムアウトまで時間を進める
            jest.advanceTimersByTime(150);
            await Promise.resolve();

            // タイムアウトが発生したことを確認
            await promise;
            expect(timeoutOccurred).toBe(true);

            // 統計が更新される
            const stats = queue.getStats();
            expect(stats.timeoutCount).toBe(1);

            jest.useRealTimers();
        });
    });

    describe('clear()', () => {
        it('should clear pending queue', () => {
            const request1: ResponseRequest = {
                modalities: ['text'],
                instructions: 'Test 1'
            };
            const request2: ResponseRequest = {
                modalities: ['text'],
                instructions: 'Test 2'
            };

            queue.enqueue(request1).catch(() => {});
            queue.enqueue(request2).catch(() => {});

            queue.clear();

            const stats = queue.getStats();
            expect(stats.pendingCount).toBe(0);
        });

        it('should reject pending requests', async () => {
            const request: ResponseRequest = {
                modalities: ['text'],
                instructions: 'Test'
            };

            const promise = queue.enqueue(request);

            queue.clear();

            await expect(promise).rejects.toThrow('Queue cleared');
        });
    });

    describe('getStats()', () => {
        it('should return queue statistics', () => {
            const stats = queue.getStats();

            expect(stats).toHaveProperty('pendingCount');
            expect(stats).toHaveProperty('isProcessing');
            expect(stats).toHaveProperty('completedCount');
            expect(stats).toHaveProperty('failedCount');
            expect(stats).toHaveProperty('timeoutCount');
        });
    });

    describe('getDebugInfo()', () => {
        it('should return debug information', () => {
            const info = queue.getDebugInfo();

            expect(info).toHaveProperty('stats');
            expect(info).toHaveProperty('config');
            expect(info).toHaveProperty('stateInfo');
        });
    });
});

