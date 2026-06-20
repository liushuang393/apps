/**
 * VoiceTranslateCore.ts 設定レイヤーのテスト
 *
 * 目的:
 *   設定の永続化 (localStorage) ・環境変数連携 (electronAPI) ・
 *   UIイベント配線・APIキー擬似検証の振る舞いを検証する。
 *
 * 注意:
 *   コンストラクタは async init() を内部で起動するため、各テストは
 *   DOM と localStorage を整えた後にインスタンスを生成し、対象メソッドを
 *   明示的に呼び出して検証する。CONFIG はモジュール共有のため毎回退避/復元する。
 */

import { VoiceTranslateCore } from '../../src/core/VoiceTranslateCore';
import { CONFIG } from '../../src/core/Config';

/** 設定UIの最小DOM (対象メソッドが参照する要素のみ) */
const SETTINGS_DOM = `
    <input id="apiKey" type="text" />
    <div id="apiKeyProgress"></div>
    <button id="validateBtn"><span id="validateBtnText">検証</span></button>
    <select id="sourceLang"><option value="auto">自動</option></select>
    <select id="targetLang"><option value="en">英語</option><option value="ja">日本語</option></select>
    <span id="targetLangDisplay"></span>
    <select id="voiceType"><option value="alloy">alloy</option><option value="echo">echo</option></select>
    <select id="realtimeModel"><option value="custom-rt">custom-rt</option><option value="stored-rt">stored-rt</option></select>
    <select id="chatModel"><option value="custom-chat">custom-chat</option><option value="stored-chat">stored-chat</option></select>
    <select id="vadSensitivity"><option value="low">低</option><option value="high">高</option></select>
    <div id="notification"></div>
    <div id="notificationTitle"></div>
    <div id="notificationMessage"></div>
`;

const VALID_API_KEY = 'sk-validApiKey1234567890';

/** 全マイクロタスク・即時マクロタスクを解放する */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * インスタンスを生成し、コンストラクタ内で起動される非同期 init() の
 * 完了を待つ。init() は loadApiKeyFromEnv() を await するため
 * initEventListeners() の配線は同期生成直後ではなく後続マイクロタスクで行われる。
 */
const createCore = async (): Promise<VoiceTranslateCore> => {
    const core = new VoiceTranslateCore();
    await flush();
    return core;
};

describe('VoiceTranslateCore - 設定レイヤー', () => {
    let originalRealtimeModel: string;
    let originalChatModel: string;
    let originalRealtimeUrl: string;

    beforeEach(() => {
        originalRealtimeModel = CONFIG.API.REALTIME_MODEL;
        originalChatModel = CONFIG.API.CHAT_MODEL;
        originalRealtimeUrl = CONFIG.API.REALTIME_URL;
        localStorage.clear();
        document.body.innerHTML = SETTINGS_DOM;
        delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    });

    afterEach(() => {
        CONFIG.API.REALTIME_MODEL = originalRealtimeModel;
        CONFIG.API.CHAT_MODEL = originalChatModel;
        CONFIG.API.REALTIME_URL = originalRealtimeUrl;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe('loadSettings()', () => {
        it('APIキー・言語・音色を localStorage から復元し state と UI に反映する', async () => {
            localStorage.setItem('openai_api_key', VALID_API_KEY);
            localStorage.setItem('target_lang', 'ja');
            localStorage.setItem('voice_type', 'echo');

            const core = await createCore();
            core.loadSettings();

            expect(core.state.apiKey).toBe(VALID_API_KEY);
            expect((core.elements.apiKey as HTMLInputElement).value).toBe(VALID_API_KEY);
            expect((document.getElementById('apiKeyProgress') as HTMLElement).style.width).toBe(
                '100%'
            );
            expect(core.state.targetLang).toBe('ja');
            expect((core.elements.targetLang as HTMLSelectElement).value).toBe('ja');
            expect((core.elements.targetLangDisplay as HTMLElement).textContent).toBe('日本語');
            expect(core.state.voiceType).toBe('echo');
            expect((core.elements.voiceType as HTMLSelectElement).value).toBe('echo');
        });

        it('保存済みモデルを CONFIG とセレクトに反映する', async () => {
            localStorage.setItem('realtime_model', 'stored-rt');
            localStorage.setItem('chat_model', 'stored-chat');

            const core = await createCore();
            core.loadSettings();

            expect(CONFIG.API.REALTIME_MODEL).toBe('stored-rt');
            expect((core.elements.realtimeModel as HTMLSelectElement).value).toBe('stored-rt');
            expect(CONFIG.API.CHAT_MODEL).toBe('stored-chat');
            expect((core.elements.chatModel as HTMLSelectElement).value).toBe('stored-chat');
        });

        it('未保存時は現在の CONFIG 値をセレクトに反映する', async () => {
            CONFIG.API.REALTIME_MODEL = 'custom-rt';
            CONFIG.API.CHAT_MODEL = 'custom-chat';

            const core = await createCore();
            core.loadSettings();

            expect((core.elements.realtimeModel as HTMLSelectElement).value).toBe('custom-rt');
            expect((core.elements.chatModel as HTMLSelectElement).value).toBe('custom-chat');
        });

        it('VAD感度を localStorage から復元する', async () => {
            localStorage.setItem('vad_sensitivity', 'high');

            const core = await createCore();
            core.loadSettings();

            expect((core.elements.vadSensitivity as HTMLSelectElement).value).toBe('high');
        });
    });

    describe('initEventListeners() - change/input', () => {
        /** セレクトの値を設定し change イベントを発火する */
        const fireChange = (id: string, value: string): void => {
            const el = document.getElementById(id) as HTMLSelectElement;
            el.value = value;
            el.dispatchEvent(new Event('change'));
        };

        it('targetLang変更で state・localStorage・表示を更新する', async () => {
            const core = await createCore();
            fireChange('targetLang', 'ja');

            expect(core.state.targetLang).toBe('ja');
            expect(localStorage.getItem('target_lang')).toBe('ja');
            expect((core.elements.targetLangDisplay as HTMLElement).textContent).toBe('日本語');
        });

        it('voiceType変更で state・localStorage を更新する', async () => {
            const core = await createCore();
            fireChange('voiceType', 'echo');

            expect(core.state.voiceType).toBe('echo');
            expect(localStorage.getItem('voice_type')).toBe('echo');
        });

        it('realtimeModel変更で CONFIG・localStorage を更新する', async () => {
            const core = await createCore();
            fireChange('realtimeModel', 'stored-rt');

            expect(CONFIG.API.REALTIME_MODEL).toBe('stored-rt');
            expect(localStorage.getItem('realtime_model')).toBe('stored-rt');
        });

        it('接続中の realtimeModel変更は次回反映の通知を出す', async () => {
            const core = await createCore();
            core.state.isConnected = true;
            const notifySpy = jest.spyOn(core.uiManager, 'notify');

            fireChange('realtimeModel', 'stored-rt');

            expect(notifySpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'info', title: 'モデル変更' })
            );
        });

        it('chatModel変更で CONFIG・localStorage を更新する', async () => {
            const core = await createCore();
            fireChange('chatModel', 'stored-chat');

            expect(CONFIG.API.CHAT_MODEL).toBe('stored-chat');
            expect(localStorage.getItem('chat_model')).toBe('stored-chat');
        });

        it('vadSensitivity変更で localStorage を更新する', async () => {
            const core = await createCore();
            fireChange('vadSensitivity', 'high');

            expect(localStorage.getItem('vad_sensitivity')).toBe('high');
        });

        it('有効なAPIキー入力で state・localStorage・進捗バーを更新する', async () => {
            const core = await createCore();
            const input = document.getElementById('apiKey') as HTMLInputElement;
            input.value = VALID_API_KEY;
            input.dispatchEvent(new Event('input'));

            expect(core.state.apiKey).toBe(VALID_API_KEY);
            expect(localStorage.getItem('openai_api_key')).toBe(VALID_API_KEY);
            expect((document.getElementById('apiKeyProgress') as HTMLElement).style.width).toBe(
                '100%'
            );
        });

        it('短いAPIキー入力は保存せず進捗バーのみ更新する', async () => {
            const core = await createCore();
            const input = document.getElementById('apiKey') as HTMLInputElement;
            input.value = 'sk-ab';
            input.dispatchEvent(new Event('input'));

            expect(localStorage.getItem('openai_api_key')).toBeNull();
            expect((document.getElementById('apiKeyProgress') as HTMLElement).style.width).toBe(
                '10%'
            );
        });
    });

    describe('loadApiKeyFromEnv()', () => {
        it('electronAPI が無い環境では何もしない', async () => {
            const core = await createCore();
            await core.loadApiKeyFromEnv();

            expect(core.state.apiKey).toBe('');
        });

        it('electronAPI からキーとモデル設定を取得し state・CONFIG に反映する', async () => {
            const core = await createCore();
            (window as unknown as { electronAPI: unknown }).electronAPI = {
                getEnvApiKey: jest.fn().mockResolvedValue('sk-env-key'),
                getEnvConfig: jest.fn().mockResolvedValue({
                    realtimeModel: 'env-rt',
                    chatModel: 'env-chat',
                    realtimeUrl: 'wss://env.example/v1/realtime'
                })
            };

            await core.loadApiKeyFromEnv();

            expect(core.state.apiKey).toBe('sk-env-key');
            expect((core.elements.apiKey as HTMLInputElement).value).toBe('sk-env-key');
            expect(CONFIG.API.REALTIME_MODEL).toBe('env-rt');
            expect(CONFIG.API.CHAT_MODEL).toBe('env-chat');
            expect(CONFIG.API.REALTIME_URL).toBe('wss://env.example/v1/realtime');
        });
    });

    describe('validateApiKey()', () => {
        it('無効なキーはエラー通知を出しボタンを無効化しない', async () => {
            const core = await createCore();
            core.state.apiKey = '';
            const notifySpy = jest.spyOn(core.uiManager, 'notify');

            await core.validateApiKey();

            expect(notifySpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'error' })
            );
            expect((core.elements.validateBtn as HTMLButtonElement).disabled).toBe(false);
        });

        it('有効なキーは検証成功通知を出しボタン状態を復帰する', async () => {
            const core = await createCore();
            jest.useFakeTimers();
            core.state.apiKey = VALID_API_KEY;
            const notifySpy = jest.spyOn(core.uiManager, 'notify');

            const promise = core.validateApiKey();
            expect((core.elements.validateBtn as HTMLButtonElement).disabled).toBe(true);

            await jest.advanceTimersByTimeAsync(1000);
            await promise;

            expect(notifySpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'success' })
            );

            await jest.advanceTimersByTimeAsync(2000);
            expect((core.elements.validateBtn as HTMLButtonElement).disabled).toBe(false);
        });
    });

    describe('ストレージ例外耐性', () => {
        it('localStorage.setItem が例外でも change ハンドラは throw しない', async () => {
            const core = await createCore();
            jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('quota exceeded');
            });

            expect(() => {
                const el = document.getElementById('voiceType') as HTMLSelectElement;
                el.value = 'echo';
                el.dispatchEvent(new Event('change'));
            }).not.toThrow();
        });
    });
});
