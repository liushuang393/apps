import { OpenAIConfigService } from '../../electron/OpenAIConfigService';

describe('OpenAIConfigService', () => {
    it('uses official secure defaults without exposing full URLs publicly', () => {
        const service = new OpenAIConfigService({});
        expect(service.getRuntimeConfig()).toMatchObject({
            realtimeUrl: 'wss://api.openai.com/v1/realtime/translations',
            chatUrl: 'https://api.openai.com/v1/chat/completions'
        });
        expect(service.getPublicConfig()).toMatchObject({
            realtimeHost: 'api.openai.com',
            chatHost: 'api.openai.com'
        });
    });

    it('accepts custom HTTPS/WSS hosts from main environment only', () => {
        const service = new OpenAIConfigService({
            OPENAI_REALTIME_URL: 'wss://realtime.example.jp/openai',
            OPENAI_CHAT_URL: 'https://chat.example.jp/v1/chat',
            OPENAI_REALTIME_MODEL: 'realtime-custom',
            OPENAI_CHAT_MODEL: 'chat-custom'
        });
        expect(service.buildRealtimeUrl()).toBe(
            'wss://realtime.example.jp/openai?model=realtime-custom'
        );
        expect(service.getPublicConfig()).toMatchObject({
            realtimeHost: 'realtime.example.jp',
            chatHost: 'chat.example.jp',
            chatModel: 'chat-custom'
        });
    });

    it.each([
        [{ OPENAI_CHAT_URL: 'http://example.com' }, 'https:'],
        [{ OPENAI_REALTIME_URL: 'ws://example.com' }, 'wss:'],
        [{ OPENAI_CHAT_URL: 'https://user:pass@example.com' }, 'ユーザー情報'],
        [{ OPENAI_CHAT_URL: 'https://example.com/path#secret' }, 'フラグメント'],
        [{ OPENAI_CHAT_URL: 'not a url' }, '有効な URL']
    ])('rejects unsafe endpoint configuration %#', (environment, message) => {
        expect(() => new OpenAIConfigService(environment).getRuntimeConfig()).toThrow(message);
    });
});
