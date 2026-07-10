/** Electron main から実行する有界 Chat 翻訳ゲートウェイ。 */

import { CredentialService } from './CredentialService';
import { OpenAIConfigService } from './OpenAIConfigService';

const MAX_ACTIVE_REQUESTS = 2;
const MAX_PENDING_REQUESTS = 50;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 500;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export interface TranslationRequest {
    sessionId: number;
    generation: string;
    segmentId: string;
    text: string;
    sourceLanguage?: string;
    targetLanguage: string;
}

export interface TranslationResult {
    sessionId: number;
    generation: string;
    segmentId: string;
    text: string;
    degraded: boolean;
}

interface PendingTranslation {
    request: TranslationRequest;
    resolve: (result: TranslationResult) => void;
    reject: (error: Error) => void;
}

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class TranslationGateway {
    private readonly pending: PendingTranslation[] = [];
    private readonly activeControllers = new Map<string, Set<AbortController>>();
    private readonly cancelledGenerations = new Set<string>();
    private activeCount = 0;

    public constructor(
        private readonly credentials: CredentialService,
        private readonly config: OpenAIConfigService,
        private readonly fetchFunction: FetchFunction = globalThis.fetch
    ) {}

    public translate(request: TranslationRequest): Promise<TranslationResult> {
        this.validateRequest(request);
        if (this.cancelledGenerations.has(request.generation)) {
            return Promise.reject(new Error('翻訳セッションは既に終了しています'));
        }
        if (this.pending.length >= MAX_PENDING_REQUESTS) {
            return Promise.reject(new Error('翻訳補正キューが満杯です'));
        }

        return new Promise<TranslationResult>((resolve, reject) => {
            this.pending.push({ request, resolve, reject });
            this.drain();
        });
    }

    public cancelGeneration(generation: string): void {
        this.cancelledGenerations.add(generation);
        const controllers = this.activeControllers.get(generation);
        if (controllers !== undefined) {
            for (const controller of controllers) {
                controller.abort();
            }
        }

        for (let index = this.pending.length - 1; index >= 0; index -= 1) {
            const item = this.pending[index];
            if (item !== undefined && item.request.generation === generation) {
                this.pending.splice(index, 1);
                item.reject(new Error('翻訳セッションが終了したため処理をキャンセルしました'));
            }
        }
    }

    public dispose(): void {
        for (const generation of this.activeControllers.keys()) {
            this.cancelGeneration(generation);
        }
        for (const item of this.pending.splice(0)) {
            item.reject(new Error('翻訳ゲートウェイを終了しました'));
        }
    }

    public getStats(): { active: number; pending: number } {
        return { active: this.activeCount, pending: this.pending.length };
    }

    private drain(): void {
        while (this.activeCount < MAX_ACTIVE_REQUESTS && this.pending.length > 0) {
            const item = this.pending.shift();
            if (item === undefined) {
                return;
            }
            if (this.cancelledGenerations.has(item.request.generation)) {
                item.reject(new Error('翻訳セッションは既に終了しています'));
                continue;
            }

            this.activeCount += 1;
            void this.execute(item.request)
                .then(item.resolve, item.reject)
                .finally(() => {
                    this.activeCount -= 1;
                    this.drain();
                });
        }
    }

    private async execute(request: TranslationRequest): Promise<TranslationResult> {
        const apiKey = this.credentials.getApiKey();
        if (apiKey === null) {
            throw new Error('OpenAI API キーが設定されていません');
        }
        const runtime = this.config.getRuntimeConfig();
        const sourceInstruction =
            request.sourceLanguage !== undefined && request.sourceLanguage !== 'auto'
                ? ` from ${request.sourceLanguage}`
                : '';
        const body: Record<string, unknown> = {
            model: runtime.chatModel,
            messages: [
                {
                    role: 'system',
                    content:
                        `You are a professional simultaneous interpreter. Translate the user's text` +
                        `${sourceInstruction} to ${request.targetLanguage}. ` +
                        'Output ONLY the translation, no explanations, no commentary.'
                },
                { role: 'user', content: request.text }
            ],
            max_completion_tokens: 500
        };
        if (!runtime.chatModel.startsWith('gpt-5')) {
            body['temperature'] = 0;
        }

        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            if (this.cancelledGenerations.has(request.generation)) {
                throw new Error('翻訳セッションは既に終了しています');
            }
            const controller = new AbortController();
            this.registerController(request.generation, controller);
            const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            try {
                const response = await this.fetchFunction(runtime.chatUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                if (this.cancelledGenerations.has(request.generation)) {
                    throw new Error('翻訳セッションは既に終了しています');
                }
                if (!response.ok) {
                    if (attempt === 0 && RETRYABLE_STATUS.has(response.status)) {
                        await this.delay(RETRY_DELAY_MS);
                        continue;
                    }
                    lastError = new Error(`翻訳 API がエラーを返しました (${response.status})`);
                    break;
                }

                const data = (await response.json()) as unknown;
                if (this.cancelledGenerations.has(request.generation)) {
                    throw new Error('翻訳セッションは既に終了しています');
                }
                const translated = this.extractTranslatedText(data);
                return {
                    sessionId: request.sessionId,
                    generation: request.generation,
                    segmentId: request.segmentId,
                    text: translated,
                    degraded: false
                };
            } catch (error) {
                lastError = this.toError(error);
                if (controller.signal.aborted || attempt === 1) {
                    break;
                }
            } finally {
                clearTimeout(timer);
                this.unregisterController(request.generation, controller);
            }
        }
        throw lastError ?? new Error('翻訳に失敗しました');
    }

    private validateRequest(request: TranslationRequest): void {
        if (!Number.isSafeInteger(request.sessionId) || request.sessionId < 0) {
            throw new Error('sessionId が不正です');
        }
        for (const [name, value, max] of [
            ['generation', request.generation, 200],
            ['segmentId', request.segmentId, 200],
            ['text', request.text, 100_000],
            ['targetLanguage', request.targetLanguage, 64]
        ] as const) {
            if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
                throw new Error(`${name} が不正です`);
            }
        }
        if (request.sourceLanguage !== undefined && request.sourceLanguage.length > 64) {
            throw new Error('sourceLanguage が不正です');
        }
    }

    private extractTranslatedText(data: unknown): string {
        if (typeof data !== 'object' || data === null) {
            throw new Error('翻訳 API のレスポンス形式が不正です');
        }
        const choices = (data as Record<string, unknown>)['choices'];
        if (!Array.isArray(choices) || choices.length === 0) {
            throw new Error('翻訳 API のレスポンスに choices がありません');
        }
        const first = choices[0];
        if (typeof first !== 'object' || first === null) {
            throw new Error('翻訳 API の choice が不正です');
        }
        const message = (first as Record<string, unknown>)['message'];
        if (typeof message !== 'object' || message === null) {
            throw new Error('翻訳 API の message が不正です');
        }
        const content = (message as Record<string, unknown>)['content'];
        if (typeof content !== 'string' || content.trim() === '') {
            throw new Error('翻訳 API の訳文が空です');
        }
        return content.trim();
    }

    private registerController(generation: string, controller: AbortController): void {
        let controllers = this.activeControllers.get(generation);
        if (controllers === undefined) {
            controllers = new Set();
            this.activeControllers.set(generation, controllers);
        }
        controllers.add(controller);
    }

    private unregisterController(generation: string, controller: AbortController): void {
        const controllers = this.activeControllers.get(generation);
        if (controllers === undefined) {
            return;
        }
        controllers.delete(controller);
        if (controllers.size === 0) {
            this.activeControllers.delete(generation);
        }
    }

    private delay(milliseconds: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    private toError(error: unknown): Error {
        if (error instanceof Error) {
            return error.name === 'AbortError'
                ? new Error('翻訳 API がタイムアウトしました')
                : error;
        }
        return new Error(String(error));
    }
}
