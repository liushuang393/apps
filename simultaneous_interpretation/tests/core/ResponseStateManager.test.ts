/**
 * ResponseStateManager.test.ts
 *
 * 目的: ResponseStateManager のテスト
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { ResponseStateManager, ResponseState } from '../../src/core/ResponseStateManager';

describe('ResponseStateManager', () => {
    let stateManager: ResponseStateManager;

    beforeEach(() => {
        stateManager = new ResponseStateManager();
    });

    describe('初期状態', () => {
        it('should start in IDLE state', () => {
            expect(stateManager.getState()).toBe(ResponseState.IDLE);
        });

        it('should have no active response', () => {
            expect(stateManager.getActiveResponseId()).toBeNull();
        });

        it('should allow response creation', () => {
            expect(stateManager.canCreateResponse()).toBe(true);
        });

        it('should not be processing', () => {
            expect(stateManager.isProcessing()).toBe(false);
        });
    });

    describe('状態遷移', () => {
        it('should transition from IDLE to AUDIO_BUFFERING', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            expect(stateManager.getState()).toBe(ResponseState.AUDIO_BUFFERING);
        });

        it('should transition through valid state flow', () => {
            // IDLE → BUFFERING
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            expect(stateManager.getState()).toBe(ResponseState.AUDIO_BUFFERING);

            // BUFFERING → COMMITTED
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            expect(stateManager.getState()).toBe(ResponseState.AUDIO_COMMITTED);

            // COMMITTED → PENDING
            stateManager.transition(ResponseState.RESPONSE_PENDING);
            expect(stateManager.getState()).toBe(ResponseState.RESPONSE_PENDING);

            // PENDING → ACTIVE
            stateManager.transition(ResponseState.RESPONSE_ACTIVE, 'resp_123');
            expect(stateManager.getState()).toBe(ResponseState.RESPONSE_ACTIVE);
            expect(stateManager.getActiveResponseId()).toBe('resp_123');

            // ACTIVE → COMPLETING
            stateManager.transition(ResponseState.RESPONSE_COMPLETING);
            expect(stateManager.getState()).toBe(ResponseState.RESPONSE_COMPLETING);

            // COMPLETING → IDLE
            stateManager.transition(ResponseState.IDLE);
            expect(stateManager.getState()).toBe(ResponseState.IDLE);
            expect(stateManager.getActiveResponseId()).toBeNull();
        });

        it('should reject invalid transitions', () => {
            // IDLE → ACTIVE（スキップ）
            expect(() => {
                stateManager.transition(ResponseState.RESPONSE_ACTIVE);
            }).toThrow('Invalid state transition');

            // IDLE → COMPLETING（スキップ）
            expect(() => {
                stateManager.transition(ResponseState.RESPONSE_COMPLETING);
            }).toThrow('Invalid state transition');
        });

        it('should allow cancel transition from BUFFERING to IDLE', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.IDLE); // キャンセル
            expect(stateManager.getState()).toBe(ResponseState.IDLE);
        });

        it('should allow error recovery from COMMITTED to IDLE', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            stateManager.transition(ResponseState.IDLE); // エラー
            expect(stateManager.getState()).toBe(ResponseState.IDLE);
        });
    });

    describe('canCreateResponse()', () => {
        it('should return true in IDLE state', () => {
            expect(stateManager.canCreateResponse()).toBe(true);
        });

        it('should return true in AUDIO_BUFFERING state', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            expect(stateManager.canCreateResponse()).toBe(true);
        });

        it('should return false in AUDIO_COMMITTED state', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            expect(stateManager.canCreateResponse()).toBe(false);
        });

        it('should return false in RESPONSE_PENDING state', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            stateManager.transition(ResponseState.RESPONSE_PENDING);
            expect(stateManager.canCreateResponse()).toBe(false);
        });

        it('should return false in RESPONSE_ACTIVE state', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            stateManager.transition(ResponseState.RESPONSE_PENDING);
            stateManager.transition(ResponseState.RESPONSE_ACTIVE, 'resp_123');
            expect(stateManager.canCreateResponse()).toBe(false);
        });
    });

    describe('isProcessing()', () => {
        it('should return false in IDLE state', () => {
            expect(stateManager.isProcessing()).toBe(false);
        });

        it('should return false in AUDIO_BUFFERING state', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            expect(stateManager.isProcessing()).toBe(false);
        });

        it('should return true in RESPONSE_PENDING state', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            stateManager.transition(ResponseState.RESPONSE_PENDING);
            expect(stateManager.isProcessing()).toBe(true);
        });

        it('should return true in RESPONSE_ACTIVE state', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            stateManager.transition(ResponseState.RESPONSE_PENDING);
            stateManager.transition(ResponseState.RESPONSE_ACTIVE, 'resp_123');
            expect(stateManager.isProcessing()).toBe(true);
        });

        it('should return true in RESPONSE_COMPLETING state', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            stateManager.transition(ResponseState.RESPONSE_PENDING);
            stateManager.transition(ResponseState.RESPONSE_ACTIVE, 'resp_123');
            stateManager.transition(ResponseState.RESPONSE_COMPLETING);
            expect(stateManager.isProcessing()).toBe(true);
        });
    });

    describe('履歴管理', () => {
        it('should record state transitions', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);

            const history = stateManager.getHistory();
            expect(history.length).toBe(2);
            expect(history[0]!.from).toBe(ResponseState.IDLE);
            expect(history[0]!.to).toBe(ResponseState.AUDIO_BUFFERING);
            expect(history[1]!.from).toBe(ResponseState.AUDIO_BUFFERING);
            expect(history[1]!.to).toBe(ResponseState.AUDIO_COMMITTED);
        });

        it('should limit history size', () => {
            // 51回遷移（maxHistorySize = 50）
            for (let i = 0; i < 51; i++) {
                stateManager.transition(ResponseState.AUDIO_BUFFERING);
                stateManager.transition(ResponseState.IDLE);
            }

            const history = stateManager.getHistory(1000);
            expect(history.length).toBeLessThanOrEqual(50);
        });
    });

    describe('リスナー', () => {
        it('should notify listeners on state transition', () => {
            const listener = jest.fn();
            stateManager.addListener(listener);

            stateManager.transition(ResponseState.AUDIO_BUFFERING);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    from: ResponseState.IDLE,
                    to: ResponseState.AUDIO_BUFFERING
                })
            );
        });

        it('should remove listener', () => {
            const listener = jest.fn();
            stateManager.addListener(listener);
            stateManager.removeListener(listener);

            stateManager.transition(ResponseState.AUDIO_BUFFERING);

            expect(listener).not.toHaveBeenCalled();
        });

        it('should handle listener errors gracefully', () => {
            const errorListener = jest.fn(() => {
                throw new Error('Listener error');
            });
            const normalListener = jest.fn();

            stateManager.addListener(errorListener);
            stateManager.addListener(normalListener);

            // エラーが発生しても他のリスナーは実行される
            expect(() => {
                stateManager.transition(ResponseState.AUDIO_BUFFERING);
            }).not.toThrow();

            expect(errorListener).toHaveBeenCalled();
            expect(normalListener).toHaveBeenCalled();
        });
    });

    describe('reset()', () => {
        it('should reset state to IDLE', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            stateManager.transition(ResponseState.RESPONSE_PENDING);

            stateManager.reset();

            expect(stateManager.getState()).toBe(ResponseState.IDLE);
            expect(stateManager.getActiveResponseId()).toBeNull();
        });

        it('should notify listeners on reset', () => {
            const listener = jest.fn();
            stateManager.addListener(listener);

            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            listener.mockClear(); // クリア

            stateManager.reset();

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: ResponseState.IDLE
                })
            );
        });
    });

    describe('getDebugInfo()', () => {
        it('should return debug information', () => {
            const info = stateManager.getDebugInfo();

            expect(info).toHaveProperty('state');
            expect(info).toHaveProperty('activeResponseId');
            expect(info).toHaveProperty('isProcessing');
            expect(info).toHaveProperty('canCreateResponse');
            expect(info).toHaveProperty('historyCount');
            expect(info).toHaveProperty('listenerCount');
        });

        it('should reflect current state', () => {
            stateManager.transition(ResponseState.AUDIO_BUFFERING);
            stateManager.transition(ResponseState.AUDIO_COMMITTED);
            stateManager.transition(ResponseState.RESPONSE_PENDING);
            stateManager.transition(ResponseState.RESPONSE_ACTIVE, 'resp_123');

            const info = stateManager.getDebugInfo();

            expect(info.state).toBe(ResponseState.RESPONSE_ACTIVE);
            expect(info.activeResponseId).toBe('resp_123');
            expect(info.isProcessing).toBe(true);
            expect(info.canCreateResponse).toBe(false);
            expect(info.historyCount).toBe(4);
        });
    });
});

