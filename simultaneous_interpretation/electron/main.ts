/**
 * Electron メインプロセス
 *
 * @description
 * VoiceTranslate Pro デスクトップアプリケーションのメインプロセス。
 * ウィンドウ管理、システム音声キャプチャ、IPC 通信を担当。
 *
 * @features
 * - ウィンドウ管理
 * - システムトレイ統合
 * - グローバルショートカット
 * - 自動更新
 * - システム音声キャプチャ
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import * as path from 'path';
import * as fs from 'fs';
import {
    app,
    BrowserWindow,
    ipcMain,
    Tray,
    Menu,
    globalShortcut,
    shell,
    systemPreferences,
    WebContents
} from 'electron';
import { ElectronAudioCapture } from './audioCapture';
import { RealtimeSessionManager } from './realtimeWebSocket';
import { ConversationDatabase, isElectronEnvironment } from './ConversationDatabase';
import type { SegmentTurnInput } from './ConversationDatabase';
import { CredentialService } from './CredentialService';
import { OpenAIConfigService } from './OpenAIConfigService';
import { TranslationGateway, TranslationRequest } from './TranslationGateway';

/**
 * .env から環境変数を読み込み、未設定の値を補完する
 */
function loadEnvironmentVariables(): void {
    // パッケージ版は起動ディレクトリの平文 .env を暗黙に読み込まない。
    // 開発時だけプロジェクトルートの .env を利用する。
    if (process.env['NODE_ENV'] !== 'development') {
        return;
    }
    const candidates = [
        path.resolve(process.cwd(), '.env'),
        path.resolve(__dirname, '..', '..', '.env')
    ];

    for (const envPath of candidates) {
        if (!fs.existsSync(envPath)) {
            continue;
        }

        try {
            const content = fs.readFileSync(envPath, 'utf-8');
            const lines = content.split(/\r?\n/);

            for (const rawLine of lines) {
                const line = rawLine.trim();

                if (!line || line.startsWith('#')) {
                    continue;
                }

                const separatorIndex = line.indexOf('=');
                if (separatorIndex <= 0) {
                    continue;
                }

                const key = line.slice(0, separatorIndex).trim();
                let value = line.slice(separatorIndex + 1).trim();

                if (
                    (value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))
                ) {
                    value = value.slice(1, -1);
                }

                if (!process.env[key]) {
                    process.env[key] = value;
                }
            }

            console.info(`[Env] Loaded environment variables from ${envPath}`);
            break;
        } catch (error) {
            console.error('[Env] Failed to load .env file:', error);
        }
    }
}

loadEnvironmentVariables();

/**
 * メインウィンドウ
 */
let mainWindow: InstanceType<typeof BrowserWindow> | null = null;

/**
 * システムトレイ
 */
let tray: InstanceType<typeof Tray> | null = null;

/**
 * 会話データベース
 */
let conversationDB: ConversationDatabase | null = null;

/** main プロセス専用サービス（app ready 後に userData を使って初期化） */
let credentialService: CredentialService | null = null;
let openAIConfigService: OpenAIConfigService | null = null;
let realtimeSessionManager: RealtimeSessionManager | null = null;
let translationGateway: TranslationGateway | null = null;

const MAIN_HTML_FILE = 'teams-realtime-translator.html';
const ALLOWED_EXTERNAL_HOSTS = new Set(['platform.openai.com', 'openai.com']);

function resolveAppResource(...segments: string[]): string {
    return path.join(app.getAppPath(), ...segments);
}

function isTrustedWebContents(webContents: WebContents): boolean {
    if (!mainWindow || webContents.id !== mainWindow.webContents.id || webContents.isDestroyed()) {
        return false;
    }
    try {
        const current = new URL(webContents.getURL());
        if (current.protocol !== 'file:') {
            return false;
        }
        return path.basename(decodeURIComponent(current.pathname)) === MAIN_HTML_FILE;
    } catch {
        return false;
    }
}

function assertTrustedSender(webContents: WebContents): void {
    if (!isTrustedWebContents(webContents)) {
        throw new Error('信頼されていない renderer からの IPC を拒否しました');
    }
}

function isAllowedExternalUrl(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
            return false;
        }
        const configuredHosts = openAIConfigService
            ? [
                  openAIConfigService.getPublicConfig().chatHost,
                  openAIConfigService.getPublicConfig().realtimeHost
              ]
            : [];
        return ALLOWED_EXTERNAL_HOSTS.has(url.hostname) || configuredHosts.includes(url.host);
    } catch {
        return false;
    }
}

/**
 * アプリケーション設定
 */
interface AppConfig {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
    alwaysOnTop: boolean;
    startMinimized: boolean;
}

const defaultConfig: AppConfig = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    alwaysOnTop: false,
    startMinimized: false
};

/**
 * メインウィンドウを作成
 */
function createMainWindow(): void {
    const config = loadConfig();

    // 設定値の検証（異常に小さい値の場合はデフォルトを使用）
    const width = config.width >= 400 ? config.width : defaultConfig.width;
    const height = config.height >= 300 ? config.height : defaultConfig.height;

    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        minWidth: config.minWidth,
        minHeight: config.minHeight,
        alwaysOnTop: config.alwaysOnTop,
        show: !config.startMinimized,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true,
            allowRunningInsecureContent: false
        },
        icon: resolveAppResource('icons', 'icon.png'),
        title: 'VoiceTranslate Pro',
        backgroundColor: '#1a1a1a',
        autoHideMenuBar: true
    });

    // メディアアクセス権限のハンドラーを設定
    mainWindow.webContents.session.setPermissionRequestHandler(
        (webContents, permission, callback) => {
            console.info(`[Main] Permission requested: ${permission}`);

            // 信頼済みローカル画面に必要な音声/画面キャプチャ権限だけを許可する。
            const allowedPermissions = ['media', 'microphone', 'display-capture'];
            if (isTrustedWebContents(webContents) && allowedPermissions.includes(permission)) {
                console.info(`[Main] Permission granted: ${permission}`);
                callback(true);
            } else {
                console.info(`[Main] Permission denied: ${permission}`);
                callback(false);
            }
        }
    );

    // メディアアクセス権限チェック（macOS用）
    if (process.platform === 'darwin') {
        const micStatus = systemPreferences.getMediaAccessStatus('microphone');
        const screenStatus = systemPreferences.getMediaAccessStatus('screen');
        console.info(
            `[Main] macOS Media Access - Microphone: ${micStatus}, Screen: ${screenStatus}`
        );

        if (micStatus !== 'granted') {
            systemPreferences.askForMediaAccess('microphone');
        }
    }

    // Content Security Policy を設定（セキュリティ警告を回避）
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy':
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "connect-src 'self' https://api.openai.com wss://api.openai.com; " +
                    "media-src 'self' blob:; " +
                    "img-src 'self' data: blob:;"
            }
        });
    });

    // HTML ファイルをロード
    // 開発環境とビルド後の環境で適切にパスを解決
    const isDev = process.env['NODE_ENV'] === 'development';
    const htmlPath = isDev
        ? path.join(__dirname, '../../teams-realtime-translator.html')
        : resolveAppResource(MAIN_HTML_FILE);

    console.info(`[Main] Loading HTML from: ${htmlPath}`);
    mainWindow.loadFile(htmlPath).catch((error) => {
        console.error('[Main] Failed to load HTML:', error);
    });

    // 開発者ツール（開発環境のみ）
    if (process.env['NODE_ENV'] === 'development') {
        mainWindow.webContents.openDevTools();
    }

    // ウィンドウイベント
    mainWindow.on('closed', () => {
        void realtimeSessionManager?.cleanup();
        mainWindow = null;
    });

    mainWindow.on('resize', () => {
        if (mainWindow) {
            const size = mainWindow.getSize();
            const width = size[0] || config.width;
            const height = size[1] || config.height;
            saveConfig({ ...config, width, height });
        }
    });

    // 外部リンクをブラウザで開く
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedExternalUrl(url)) {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // preload API を持つウィンドウが外部/別ファイルへ遷移することを禁止する。
    mainWindow.webContents.on('will-navigate', (event, url) => {
        try {
            const target = new URL(url);
            const expected = new URL(`file:///${htmlPath.replace(/\\/g, '/')}`);
            if (
                target.protocol !== 'file:' ||
                decodeURIComponent(target.pathname) !== decodeURIComponent(expected.pathname)
            ) {
                event.preventDefault();
            }
        } catch {
            event.preventDefault();
        }
    });

    console.info('[Main] Main window created');
}

/**
 * システムトレイを作成
 */
function createTray(): void {
    const iconPath = resolveAppResource('icons', 'tray-icon.png');

    // アイコンが存在しない場合はスキップ
    if (!fs.existsSync(iconPath)) {
        console.warn('[Main] Tray icon not found, skipping tray creation');
        return;
    }

    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'VoiceTranslate Pro を表示',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: '常に最前面に表示',
            type: 'checkbox',
            checked: mainWindow?.isAlwaysOnTop() || false,
            click: (menuItem) => {
                if (mainWindow) {
                    mainWindow.setAlwaysOnTop(menuItem.checked);
                    saveConfig({ ...loadConfig(), alwaysOnTop: menuItem.checked });
                }
            }
        },
        { type: 'separator' },
        {
            label: '設定',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                    mainWindow.webContents.send('open-settings');
                }
            }
        },
        { type: 'separator' },
        {
            label: '終了',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip('VoiceTranslate Pro');

    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });

    console.info('[Main] System tray created');
}

/**
 * グローバルショートカットを登録
 */
function registerGlobalShortcuts(): void {
    // Ctrl+Shift+V: ウィンドウを表示/非表示
    try {
        globalShortcut.register('CommandOrControl+Shift+V', () => {
            if (mainWindow) {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        });

        console.info('[Main] Global shortcut registered: CommandOrControl+Shift+V');
    } catch (error) {
        console.error('[Main] Error registering global shortcut:', error);
    }
}

function validWindowDimension(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number
): number {
    return typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= minimum &&
        value <= maximum
        ? Math.round(value)
        : fallback;
}

function validateIdentifier(value: string, name: string): void {
    if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
        throw new Error(`${name} が不正です`);
    }
}

function requireCredentialService(): CredentialService {
    if (credentialService === null) {
        throw new Error('CredentialService が初期化されていません');
    }
    return credentialService;
}

function requireOpenAIConfigService(): OpenAIConfigService {
    if (openAIConfigService === null) {
        throw new Error('OpenAIConfigService が初期化されていません');
    }
    return openAIConfigService;
}

function requireRealtimeSessionManager(): RealtimeSessionManager {
    if (realtimeSessionManager === null) {
        throw new Error('RealtimeSessionManager が初期化されていません');
    }
    return realtimeSessionManager;
}

function requireTranslationGateway(): TranslationGateway {
    if (translationGateway === null) {
        throw new Error('TranslationGateway が初期化されていません');
    }
    return translationGateway;
}

/**
 * IPC ハンドラーを登録
 */
function registerIPCHandlers(): void {
    const requireTrusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void => {
        assertTrustedSender(event.sender);
    };

    // ウィンドウを最小化
    ipcMain.on('minimize-window', (event) => {
        requireTrusted(event);
        if (mainWindow) {
            mainWindow.minimize();
        }
    });

    // ウィンドウを最大化/復元
    ipcMain.on('maximize-window', (event) => {
        requireTrusted(event);
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    // ウィンドウを閉じる
    ipcMain.on('close-window', (event) => {
        requireTrusted(event);
        if (mainWindow) {
            mainWindow.close();
        }
    });

    // 常に最前面に表示を切り替え
    ipcMain.on('toggle-always-on-top', (event) => {
        requireTrusted(event);
        if (mainWindow) {
            const isAlwaysOnTop = !mainWindow.isAlwaysOnTop();
            mainWindow.setAlwaysOnTop(isAlwaysOnTop);
            saveConfig({ ...loadConfig(), alwaysOnTop: isAlwaysOnTop });
            mainWindow.webContents.send('always-on-top-changed', isAlwaysOnTop);
        }
    });

    // 設定を取得
    ipcMain.handle('get-config', (event) => {
        requireTrusted(event);
        return loadConfig();
    });

    // 設定を保存
    ipcMain.handle('save-config', (event, config: Partial<AppConfig>) => {
        requireTrusted(event);
        if (typeof config !== 'object' || config === null || Array.isArray(config)) {
            throw new Error('設定オブジェクトが不正です');
        }
        const current = loadConfig();
        const next: AppConfig = {
            width: validWindowDimension(config.width, current.width, 400, 8_000),
            height: validWindowDimension(config.height, current.height, 300, 8_000),
            minWidth: validWindowDimension(config.minWidth, current.minWidth, 400, 8_000),
            minHeight: validWindowDimension(config.minHeight, current.minHeight, 300, 8_000),
            alwaysOnTop:
                typeof config.alwaysOnTop === 'boolean' ? config.alwaysOnTop : current.alwaysOnTop,
            startMinimized:
                typeof config.startMinimized === 'boolean'
                    ? config.startMinimized
                    : current.startMinimized
        };
        saveConfig(next);
        return true;
    });

    // 音声ソースを取得
    ipcMain.handle('get-audio-sources', async (event, types?: ('window' | 'screen')[]) => {
        requireTrusted(event);
        if (
            types !== undefined &&
            (!Array.isArray(types) || types.some((type) => type !== 'window' && type !== 'screen'))
        ) {
            throw new Error('音声ソース種別が不正です');
        }
        return await ElectronAudioCapture.getAudioSources(types);
    });

    // 会議アプリを検出
    ipcMain.handle('detect-meeting-apps', async (event) => {
        requireTrusted(event);
        return await ElectronAudioCapture.detectMeetingApps();
    });

    ipcMain.handle('credentials:get-status', (event) => {
        requireTrusted(event);
        const status = requireCredentialService().getStatus();
        return {
            configured: status.configured,
            source:
                status.source === 'environment' || status.source === 'secure-storage'
                    ? status.source
                    : 'none',
            storedFallbackExists: status.storedFallbackExists
        };
    });
    ipcMain.handle('credentials:store-key', (event, key: string) => {
        requireTrusted(event);
        return requireCredentialService().storeKey(key);
    });
    ipcMain.handle('credentials:clear-key', (event) => {
        requireTrusted(event);
        requireCredentialService().clearStoredKey();
    });
    ipcMain.handle('runtime:get-public-config', (event) => {
        requireTrusted(event);
        return requireOpenAIConfigService().getPublicConfig();
    });
    ipcMain.handle('realtime:connect', async (event) => {
        requireTrusted(event);
        return await requireRealtimeSessionManager().connect(event.sender);
    });
    ipcMain.handle('realtime:send', (event, connectionId: string, message: unknown) => {
        requireTrusted(event);
        validateIdentifier(connectionId, 'connectionId');
        const manager = requireRealtimeSessionManager();
        if (!manager.ownsConnection(connectionId, event.sender)) {
            throw new Error('この renderer が所有していない接続です');
        }
        return manager.send(connectionId, message);
    });
    ipcMain.handle('realtime:close', async (event, connectionId: string) => {
        requireTrusted(event);
        validateIdentifier(connectionId, 'connectionId');
        const manager = requireRealtimeSessionManager();
        if (manager.ownsConnection(connectionId, event.sender)) {
            await manager.close(connectionId);
            requireTranslationGateway().cancelGeneration(connectionId);
        }
    });
    ipcMain.handle('realtime:get-state', (event) => {
        requireTrusted(event);
        return requireRealtimeSessionManager().getState();
    });
    ipcMain.handle('translation:translate', async (event, request: TranslationRequest) => {
        requireTrusted(event);
        return await requireTranslationGateway().translate(request);
    });

    // ✅ 会話データベース IPC ハンドラー
    // セッション開始
    ipcMain.handle(
        'conversation:start-session',
        (event, sourceLanguage?: string, targetLanguage?: string) => {
            requireTrusted(event);
            if (!conversationDB) {
                throw new Error('Conversation database not initialized');
            }
            return conversationDB.startSession(sourceLanguage, targetLanguage);
        }
    );

    // セッション終了
    ipcMain.handle('conversation:end-session', (event) => {
        requireTrusted(event);
        if (!conversationDB) {
            throw new Error('Conversation database not initialized');
        }
        conversationDB.endSession();
    });

    ipcMain.handle('conversation:upsert-segment-turn', (event, turn: SegmentTurnInput) => {
        requireTrusted(event);
        if (!conversationDB) {
            throw new Error('Conversation database not initialized');
        }
        return conversationDB.upsertSegmentTurn(turn);
    });

    // すべてのセッションを取得
    ipcMain.handle('conversation:get-all-sessions', (event, limit: number = 100) => {
        requireTrusted(event);
        if (!conversationDB) {
            throw new Error('Conversation database not initialized');
        }
        return conversationDB.getAllSessions(limit);
    });

    // セッションのすべてのターンを取得
    ipcMain.handle('conversation:get-session-turns', (event, sessionId: number) => {
        requireTrusted(event);
        if (!conversationDB) {
            throw new Error('Conversation database not initialized');
        }
        return conversationDB.getSessionTurns(sessionId);
    });

    ipcMain.handle('conversation:clear-all', (event) => {
        requireTrusted(event);
        if (!conversationDB) {
            throw new Error('Conversation database not initialized');
        }
        return conversationDB.clearAll();
    });

    console.info('[Main] IPC handlers registered');
}

/**
 * 設定を読み込み
 */
function loadConfig(): AppConfig {
    const configPath = path.join(app.getPath('userData'), 'config.json');

    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            return { ...defaultConfig, ...JSON.parse(data) };
        }
    } catch (error) {
        console.error('[Main] Failed to load config:', error);
    }

    return defaultConfig;
}

/**
 * 設定を保存
 */
function saveConfig(config: AppConfig): void {
    const configPath = path.join(app.getPath('userData'), 'config.json');

    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
        console.error('[Main] Failed to save config:', error);
    }
}

/**
 * Chrome 命令行参数设置 - 禁用 DevTools 自动填充错误
 *
 * 目的:
 *   彻底禁用 Chrome DevTools 的 Autofill 协议，避免 "Autofill.setAddresses" 错误
 *
 * 原理:
 *   通过禁用 Chrome 的自动填充相关特性，防止 DevTools 尝试调用不存在的 API
 */
const chromiumCommandLine = app?.commandLine;
if (chromiumCommandLine && typeof chromiumCommandLine.appendSwitch === 'function') {
    chromiumCommandLine.appendSwitch('disable-features', 'Autofill,AutofillServerCommunication');
} else {
    console.warn('[Main] Failed to configure Chromium command line switches');
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

/**
 * メディアアクセス権限を要求（全プラットフォーム対応）
 *
 * 目的:
 *   マイク・カメラ・画面キャプチャの権限を取得
 *
 * 対応プラットフォーム:
 *   - macOS: systemPreferences.askForMediaAccess()
 *   - Windows: 自動的に権限ダイアログが表示される
 *   - Linux: PulseAudio/ALSA経由で自動的に処理される
 */
async function requestMediaPermissions(): Promise<void> {
    const platform = process.platform;
    console.info(`[Main] Platform: ${platform}`);

    if (platform === 'darwin') {
        // macOS: Request media access explicitly
        console.info('[Main] macOS: Requesting media access permissions...');

        try {
            const micStatus = systemPreferences.getMediaAccessStatus('microphone');
            const screenStatus = systemPreferences.getMediaAccessStatus('screen');

            console.info(
                `[Main] macOS permissions - Microphone: ${micStatus}, Screen: ${screenStatus}`
            );

            if (micStatus !== 'granted') {
                console.info('[Main] Requesting microphone permission...');
                await systemPreferences.askForMediaAccess('microphone');
            }

            console.info('[Main] macOS: Media access permissions request completed');
        } catch (error) {
            console.error('[Main] macOS permission request error:', error);
        }
    } else if (platform === 'win32') {
        // Windows: Permission dialog will be shown automatically
        console.info('[Main] Windows: Media access permissions will be requested automatically');
        console.info('[Main] Windows: Permission dialog will appear on first use');
    } else if (platform === 'linux') {
        // Linux: Handled automatically via PulseAudio/ALSA
        console.info('[Main] Linux: Media access permissions managed by system');
        console.info('[Main] Linux: Check PulseAudio/ALSA configuration if needed');
    } else {
        console.warn(`[Main] Unsupported platform: ${platform}`);
    }
}

/**
 * アプリケーション起動時
 */
async function initializeMainServices(): Promise<void> {
    credentialService = new CredentialService(app.getPath('userData'));
    openAIConfigService = new OpenAIConfigService();
    realtimeSessionManager = new RealtimeSessionManager(credentialService, openAIConfigService);
    translationGateway = new TranslationGateway(credentialService, openAIConfigService);
}

async function initializeConversationDatabase(): Promise<void> {
    if (!isElectronEnvironment()) {
        console.info('[Main] Skipping database initialization (not in Electron environment)');
        return;
    }
    try {
        const customDbPath = process.env['CONVERSATION_DB_PATH'];
        conversationDB = new ConversationDatabase(customDbPath);
        console.info('[Main] Conversation database initialized');
    } catch (error) {
        console.error('[Main] Failed to initialize conversation database:', error);
    }
}

async function runSmokeTest(): Promise<void> {
    const requiredResources = [
        resolveAppResource(MAIN_HTML_FILE),
        resolveAppResource('icons', 'tray-icon.png'),
        resolveAppResource('audio-processor-worklet.js')
    ];
    for (const resource of requiredResources) {
        if (!fs.existsSync(resource)) {
            throw new Error(`必要なリソースが見つかりません: ${resource}`);
        }
    }
    requireCredentialService().getStatus();
    requireOpenAIConfigService().getPublicConfig();
    if (conversationDB === null) {
        throw new Error('会話データベースを初期化できませんでした');
    }
    conversationDB.close();
    conversationDB = null;
}

if (hasSingleInstanceLock) {
    void app.whenReady().then(async () => {
        console.info('[Main] App is ready');

        await initializeMainServices();
        await initializeConversationDatabase();

        if (process.argv.includes('--smoke-test')) {
            try {
                await runSmokeTest();
                console.info('[Smoke] Packaged application smoke test passed');
                app.exit(0);
            } catch (error) {
                console.error('[Smoke] Packaged application smoke test failed:', error);
                app.exit(1);
            }
            return;
        }

        // 全プラットフォーム対応: メディアアクセス権限を要求
        await requestMediaPermissions();

        createMainWindow();
        createTray();
        registerGlobalShortcuts();
        registerIPCHandlers();

        app.on('activate', () => {
            // macOS: Dock アイコンクリック時
            if (BrowserWindow.getAllWindows().length === 0) {
                createMainWindow();
            }
        });
    });
}

/**
 * 全ウィンドウが閉じられた時
 */
app.on('window-all-closed', () => {
    // macOS 以外: アプリケーションを終了
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

/**
 * アプリケーション終了前
 */
app.on('will-quit', () => {
    // グローバルショートカットを解除
    globalShortcut.unregisterAll();
    // WebSocket接続をクリーンアップ
    void realtimeSessionManager?.cleanup();
    translationGateway?.dispose();
    // ✅ 会話データベースを閉じる
    if (conversationDB) {
        conversationDB.close();
        conversationDB = null;
    }
    console.info('[Main] App is quitting');
});

/**
 * アプリケーション終了時
 */
app.on('quit', () => {
    console.info('[Main] App has quit');
});
