import { CredentialService } from '../../electron/CredentialService';
import { OpenAIConfigService } from '../../electron/OpenAIConfigService';
import { TranslationGateway, TranslationRequest } from '../../electron/TranslationGateway';

const credentials = { getApiKey: () => 'test-key' } as unknown as CredentialService;
const config = new OpenAIConfigService({ OPENAI_CHAT_MODEL: 'test-model' });
const baseRequest: TranslationRequest = {
    sessionId: 1,
    generation: 'generation-1',
    segmentId: 'segment-1',
    text: 'hello',
    targetLanguage: 'ja'
};

function response(status: number, text = 'こんにちは'): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ choices: [{ message: { content: text } }] })
    } as Response;
}

describe('TranslationGateway', () => {
    it('builds a fixed translation request and returns an identity-bound result', async () => {
        const fetcher = jest.fn(async () => response(200));
        const gateway = new TranslationGateway(credentials, config, fetcher);
        await expect(gateway.translate(baseRequest)).resolves.toEqual({
            sessionId: 1,
            generation: 'generation-1',
            segmentId: 'segment-1',
            text: 'こんにちは',
            degraded: false
        });
        const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' });
        expect(JSON.parse(String(init.body))).toMatchObject({ model: 'test-model' });
    });

    it('never retries 400/401/403 failures', async () => {
        for (const status of [400, 401, 403]) {
            const fetcher = jest.fn(async () => response(status));
            const gateway = new TranslationGateway(credentials, config, fetcher);
            await expect(gateway.translate(baseRequest)).rejects.toThrow(String(status));
            expect(fetcher).toHaveBeenCalledTimes(1);
        }
    });

    it('retries a retryable response once', async () => {
        const fetcher = jest
            .fn()
            .mockResolvedValueOnce(response(503))
            .mockResolvedValueOnce(response(200, '再試行成功'));
        const gateway = new TranslationGateway(credentials, config, fetcher);
        await expect(gateway.translate(baseRequest)).resolves.toMatchObject({ text: '再試行成功' });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('limits active requests to two and cancels pending work by generation', async () => {
        const resolvers: Array<(value: Response) => void> = [];
        const fetcher = jest.fn(
            async () => await new Promise<Response>((resolve) => resolvers.push(resolve))
        );
        const gateway = new TranslationGateway(credentials, config, fetcher);
        const requests = [1, 2, 3].map((id) =>
            gateway.translate({ ...baseRequest, segmentId: `segment-${id}` })
        );
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(gateway.getStats()).toEqual({ active: 2, pending: 1 });

        gateway.cancelGeneration(baseRequest.generation);
        await expect(requests[2]).rejects.toThrow('キャンセル');
        resolvers.splice(0).forEach((resolve) => resolve(response(200)));
        await Promise.allSettled(requests.slice(0, 2));
        expect(gateway.getStats()).toEqual({ active: 0, pending: 0 });
    });

    it('rejects the 51st pending request while two are active', async () => {
        const fetcher = jest.fn(
            async (_input: string | URL | Request, init?: RequestInit) =>
                await new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        const error = new Error('aborted');
                        error.name = 'AbortError';
                        reject(error);
                    });
                })
        );
        const gateway = new TranslationGateway(credentials, config, fetcher);
        const accepted: Array<Promise<unknown>> = [];
        for (let index = 0; index < 52; index++) {
            accepted.push(
                gateway.translate({ ...baseRequest, segmentId: `queued-${index}` })
            );
        }
        await expect(
            gateway.translate({ ...baseRequest, segmentId: 'queue-overflow' })
        ).rejects.toThrow('満杯');
        gateway.dispose();
        await Promise.allSettled(accepted);
    });
});
