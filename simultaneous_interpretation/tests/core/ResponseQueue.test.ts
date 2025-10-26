/**
 * ResponseQueue.ts のテスト
 */

import { ResponseQueue } from '../../src/core/ResponseQueue';

describe('ResponseQueue', () => {
    let queue: ResponseQueue;
    let sendMessageMock: jest.Mock;

    beforeEach(() => {
        sendMessageMock = jest.fn();
        queue = new ResponseQueue(sendMessageMock, {
            maxQueueSize: 10,
            debugMode: false
        });
    });

    describe('constructor', () => {
        it('should initialize with default options', () => {
            const defaultQueue = new ResponseQueue(sendMessageMock);
            expect(defaultQueue).toBeDefined();
        });

        it('should initialize with custom options', () => {
            const customQueue = new ResponseQueue(sendMessageMock, {
                maxQueueSize: 5,
                debugMode: true
            });
            expect(customQueue).toBeDefined();
        });
    });

    describe('enqueue', () => {
        it('should enqueue a request', async () => {
            const request = { test: 'data' };
            const promise = queue.enqueue(request);
            
            expect(sendMessageMock).toHaveBeenCalledWith({
                type: 'response.create',
                response: request
            });
            
            // Simulate response.done
            queue.handleResponseDone('test-id');
            
            await expect(promise).resolves.toBe('test-id');
        });

        it('should reject concurrent requests due to processing limit', async () => {
            const request = { test: 'data' };

            // Enqueue first request (will be processing)
            const promise1 = queue.enqueue(request);

            // Try to enqueue more requests while first is processing
            // These should be rejected due to concurrent control
            const rejectPromises = [];
            for (let i = 0; i < 5; i++) {
                rejectPromises.push(queue.enqueue(request).catch(e => e));
            }

            // Wait for all rejections
            const results = await Promise.all(rejectPromises);
            results.forEach(result => {
                expect(result).toBeInstanceOf(Error);
                expect(result.message).toBe('Previous response is still in progress');
            });

            // Complete first request
            queue.handleResponseDone('test-id-1');
            await promise1;
        });

        it('should reject concurrent requests', async () => {
            const request1 = { test: 'data1' };
            const request2 = { test: 'data2' };
            
            // Enqueue first request
            const promise1 = queue.enqueue(request1);
            
            // Try to enqueue second request immediately (should be rejected)
            await expect(queue.enqueue(request2)).rejects.toThrow('Previous response is still in progress');
            
            // Complete first request
            queue.handleResponseDone('test-id-1');
            await promise1;
        });
    });

    describe('handleResponseCreated', () => {
        it('should handle response.created event', () => {
            const consoleSpy = jest.spyOn(console, 'info').mockImplementation();
            
            const debugQueue = new ResponseQueue(sendMessageMock, {
                debugMode: true
            });
            
            debugQueue.handleResponseCreated('test-id');
            
            expect(consoleSpy).toHaveBeenCalledWith('[ResponseQueue] レスポンス作成:', 'test-id');
            consoleSpy.mockRestore();
        });
    });

    describe('handleResponseDone', () => {
        it('should complete pending request', async () => {
            const request = { test: 'data' };
            const promise = queue.enqueue(request);
            
            queue.handleResponseDone('test-id');
            
            await expect(promise).resolves.toBe('test-id');
        });

        it('should process next request in queue', async () => {
            const request1 = { test: 'data1' };
            const request2 = { test: 'data2' };
            
            // Enqueue first request
            const promise1 = queue.enqueue(request1);
            
            // Complete first request
            queue.handleResponseDone('test-id-1');
            await promise1;
            
            // Now second request should be processed
            const promise2 = queue.enqueue(request2);
            expect(sendMessageMock).toHaveBeenCalledTimes(2);
            
            queue.handleResponseDone('test-id-2');
            await promise2;
        });
    });

    describe('handleError', () => {
        it('should handle general errors', async () => {
            const request = { test: 'data' };
            const promise = queue.enqueue(request);
            
            const error = new Error('Test error');
            queue.handleError(error);
            
            await expect(promise).rejects.toThrow('Test error');
        });

        it('should handle conversation_already_has_active_response error via code flag', async () => {
            const request = { test: 'data' };
            const promise = queue.enqueue(request);
            
            const error = new Error('Conversation already has an active response in progress: resp_test');
            queue.handleError(error, 'conversation_already_has_active_response');
            
            await expect(promise).rejects.toThrow();
        });
    });

    describe('clear', () => {
        it('should clear all pending requests', async () => {
            const request = { test: 'data' };
            const promise1 = queue.enqueue(request);
            
            queue.clear();
            
            await expect(promise1).rejects.toThrow('Queue cleared');
        });
    });

    describe('getStats', () => {
        it('should return correct statistics', async () => {
            const request = { test: 'data' };
            
            // Initial stats
            let stats = queue.getStats();
            expect(stats.totalRequests).toBe(0);
            expect(stats.completedRequests).toBe(0);
            expect(stats.failedRequests).toBe(0);
            expect(stats.pendingCount).toBe(0);
            expect(stats.processingCount).toBe(0);
            
            // Enqueue a request
            const promise = queue.enqueue(request);
            
            stats = queue.getStats();
            expect(stats.totalRequests).toBe(1);
            expect(stats.processingCount).toBe(1);
            
            // Complete the request
            queue.handleResponseDone('test-id');
            await promise;
            
            stats = queue.getStats();
            expect(stats.completedRequests).toBe(1);
            expect(stats.processingCount).toBe(0);
        });

        it('should track failed requests', async () => {
            const request = { test: 'data' };
            const promise = queue.enqueue(request);
            
            const error = new Error('Test error');
            queue.handleError(error);
            
            await expect(promise).rejects.toThrow();
            
            const stats = queue.getStats();
            expect(stats.failedRequests).toBe(1);
        });
    });

    describe('getStatus', () => {
        it('should return same as getStats', () => {
            const stats = queue.getStats();
            const status = queue.getStatus();
            expect(status).toEqual(stats);
        });
    });

    describe('concurrent request handling', () => {
        it('should process requests sequentially', async () => {
            const request1 = { test: 'data1' };
            const request2 = { test: 'data2' };
            const request3 = { test: 'data3' };
            
            // Enqueue first request
            const promise1 = queue.enqueue(request1);
            expect(sendMessageMock).toHaveBeenCalledTimes(1);

            // Try to enqueue second and third (should be rejected due to concurrent control)
            const rejectPromise2 = queue.enqueue(request2).catch(e => e);
            const rejectPromise3 = queue.enqueue(request3).catch(e => e);

            const result2 = await rejectPromise2;
            const result3 = await rejectPromise3;
            expect(result2).toBeInstanceOf(Error);
            expect(result3).toBeInstanceOf(Error);

            // Complete first request
            queue.handleResponseDone('test-id-1');
            await promise1;

            // Now we can enqueue new requests
            const promise2 = queue.enqueue(request2);
            expect(sendMessageMock).toHaveBeenCalledTimes(2);

            queue.handleResponseDone('test-id-2');
            await promise2;
        });
    });
});
