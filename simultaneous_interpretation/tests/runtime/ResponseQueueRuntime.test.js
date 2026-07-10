const { ResponseQueue } = require('../../voicetranslate-utils.js');

describe('production ResponseQueue', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('awaits async send and retries according to retryOnError/maxRetries', async () => {
        const send = jest
            .fn()
            .mockRejectedValueOnce(new Error('temporary'))
            .mockResolvedValueOnce({ success: true });
        const queue = new ResponseQueue(send, { retryOnError: true, maxRetries: 1 });
        const completion = queue.enqueue({ instructions: 'translate' });
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(send).toHaveBeenCalledTimes(2);

        queue.handleResponseCreated('response-1');
        queue.handleResponseDone('response-1');
        await expect(completion).resolves.toBe('response-1');
        expect(queue.getStats()).toMatchObject({ completedRequests: 1, failedRequests: 0 });
    });

    it('settles a hung request on timeout and continues with bounded state', async () => {
        jest.useFakeTimers();
        const send = jest.fn(async () => await new Promise(() => undefined));
        const queue = new ResponseQueue(send, { timeout: 100 });
        const completion = queue.enqueue({ instructions: 'translate' });
        jest.advanceTimersByTime(100);
        await expect(completion).rejects.toThrow('Response timeout');
        expect(queue.getStats()).toMatchObject({
            processingCount: 0,
            pendingCount: 0,
            failedRequests: 1
        });
    });

    it('settles both processing and pending promises when cleared', async () => {
        const send = jest.fn(async () => await new Promise(() => undefined));
        const queue = new ResponseQueue(send);
        const first = queue.enqueue({ id: 1 });
        const second = queue.enqueue({ id: 2 });
        queue.clear();
        await expect(first).rejects.toThrow('Queue cleared');
        await expect(second).rejects.toThrow('Queue cleared');
        expect(queue.getStats()).toMatchObject({ processingCount: 0, pendingCount: 0 });
    });
});
