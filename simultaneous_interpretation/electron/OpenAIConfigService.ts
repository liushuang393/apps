/** OpenAI 接続設定を main プロセスで検証・保持するサービス。 */

const DEFAULT_REALTIME_URL = 'wss://api.openai.com/v1/realtime/translations';
const DEFAULT_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-translate';
const DEFAULT_CHAT_MODEL = 'gpt-5.5';
const DEFAULT_TRANSCRIBE_MODEL = 'gpt-realtime-whisper';
const MAX_ENDPOINT_LENGTH = 2048;

export interface TranslationTurnConfig {
    turnMode?: string;
    vadType?: string;
    semanticEagerness?: string;
    maxSentences?: number;
    postSentenceHoldMs?: number;
    maxBufferMs?: number;
}

export interface OpenAIRuntimeConfig {
    realtimeUrl: string;
    chatUrl: string;
    realtimeModel: string;
    chatModel: string;
    transcribeModel: string;
    translation: TranslationTurnConfig;
}

export interface PublicOpenAIConfig {
    realtimeModel: string;
    chatModel: string;
    transcribeModel: string;
    realtimeHost: string;
    chatHost: string;
    translation: TranslationTurnConfig;
}

export class OpenAIConfigService {
    public constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

    public getRuntimeConfig(): OpenAIRuntimeConfig {
        const realtimeUrl = this.validateEndpoint(
            this.environment['OPENAI_REALTIME_URL'] ?? DEFAULT_REALTIME_URL,
            'wss:',
            'OPENAI_REALTIME_URL'
        );
        const chatUrl = this.validateEndpoint(
            this.environment['OPENAI_CHAT_URL'] ?? DEFAULT_CHAT_URL,
            'https:',
            'OPENAI_CHAT_URL'
        );

        return {
            realtimeUrl: realtimeUrl.toString(),
            chatUrl: chatUrl.toString(),
            realtimeModel: this.readModel('OPENAI_REALTIME_MODEL', DEFAULT_REALTIME_MODEL),
            chatModel: this.readModel('OPENAI_CHAT_MODEL', DEFAULT_CHAT_MODEL),
            transcribeModel:
                this.readOptionalModel('OPENAI_TRANSCRIBE_MODEL') ??
                this.readOptionalModel('OPENAI_TRANSCRIPTION_MODEL') ??
                DEFAULT_TRANSCRIBE_MODEL,
            translation: this.readTranslationConfig()
        };
    }

    public getPublicConfig(): PublicOpenAIConfig {
        const config = this.getRuntimeConfig();
        return {
            realtimeModel: config.realtimeModel,
            chatModel: config.chatModel,
            transcribeModel: config.transcribeModel,
            realtimeHost: new URL(config.realtimeUrl).host,
            chatHost: new URL(config.chatUrl).host,
            translation: config.translation
        };
    }

    public buildRealtimeUrl(): string {
        const config = this.getRuntimeConfig();
        const endpoint = new URL(config.realtimeUrl);
        endpoint.searchParams.set('model', config.realtimeModel);
        return endpoint.toString();
    }

    private validateEndpoint(
        rawValue: string,
        requiredProtocol: 'https:' | 'wss:',
        name: string
    ): URL {
        if (rawValue.length === 0 || rawValue.length > MAX_ENDPOINT_LENGTH) {
            throw new Error(`${name} の長さが不正です`);
        }

        let endpoint: URL;
        try {
            endpoint = new URL(rawValue);
        } catch {
            throw new Error(`${name} は有効な URL ではありません`);
        }

        if (endpoint.protocol !== requiredProtocol) {
            throw new Error(`${name} は ${requiredProtocol}// の安全な URL を指定してください`);
        }
        if (endpoint.username !== '' || endpoint.password !== '' || endpoint.hash !== '') {
            throw new Error(`${name} にユーザー情報やフラグメントを含めることはできません`);
        }
        if (endpoint.hostname === '') {
            throw new Error(`${name} にホスト名がありません`);
        }
        return endpoint;
    }

    private readModel(name: string, fallback: string): string {
        return this.readOptionalModel(name) ?? fallback;
    }

    private readOptionalModel(name: string): string | undefined {
        const raw = this.environment[name];
        if (raw === undefined || raw.trim() === '') {
            return undefined;
        }
        const value = raw.trim();
        if (value.length > 200 || !/^[A-Za-z0-9._:-]+$/u.test(value)) {
            throw new Error(`${name} の値が不正です`);
        }
        return value;
    }

    private readTranslationConfig(): TranslationTurnConfig {
        const parsePositiveInt = (name: string): number | undefined => {
            const raw = this.environment[name];
            if (raw === undefined || raw.trim() === '') {
                return undefined;
            }
            const value = Number.parseInt(raw, 10);
            if (!Number.isSafeInteger(value) || value <= 0) {
                throw new Error(`${name} は正の整数で指定してください`);
            }
            return value;
        };
        const readShortString = (name: string): string | undefined => {
            const raw = this.environment[name];
            if (raw === undefined || raw.trim() === '') {
                return undefined;
            }
            const value = raw.trim();
            if (value.length > 64) {
                throw new Error(`${name} が長すぎます`);
            }
            return value;
        };

        const turnMode = readShortString('TRANSLATION_TURN_MODE');
        const vadType = readShortString('TRANSLATION_VAD_TYPE');
        const semanticEagerness = readShortString('TRANSLATION_SEMANTIC_EAGERNESS');
        const maxSentences = parsePositiveInt('TRANSLATION_MAX_SENTENCES');
        const postSentenceHoldMs = parsePositiveInt('TRANSLATION_POST_SENTENCE_HOLD_MS');
        const maxBufferMs = parsePositiveInt('TRANSLATION_MAX_BUFFER_MS');
        return {
            ...(turnMode !== undefined ? { turnMode } : {}),
            ...(vadType !== undefined ? { vadType } : {}),
            ...(semanticEagerness !== undefined ? { semanticEagerness } : {}),
            ...(maxSentences !== undefined ? { maxSentences } : {}),
            ...(postSentenceHoldMs !== undefined ? { postSentenceHoldMs } : {}),
            ...(maxBufferMs !== undefined ? { maxBufferMs } : {})
        };
    }
}
