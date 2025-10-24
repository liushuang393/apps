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
    systemPreferences
} from 'electron';
import { ElectronAudioCapture } from './audioCapture';
import { initializeRealtimeWebSocket, cleanupRealtimeWebSocket } from './realtimeWebSocket';

/**
 * .env から環境変数を読み込み、未設定の値を補完する
 */
function loadEnvironmentVariables(): void {
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
        icon: path.join(__dirname, '../icons/icon.png'),
        title: 'VoiceTranslate Pro',
        backgroundColor: '#1a1a1a',
        autoHideMenuBar: true
    });

    // メディアアクセス権限のハンドラーを設定
    mainWindow.webContents.session.setPermissionRequestHandler(
        (_webContents, permission, callback) => {
            console.info(`[Main] Permission requested: ${permission}`);

            // マイク、カメラ、画面キャプチャを自動許可
            const allowedPermissions = ['media', 'microphone', 'camera', 'desktop-capturer'];
            if (allowedPermissions.includes(permission)) {
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
                    "script-src 'self' 'unsafe-inline'; " +
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
        : path.join(app.getAppPath(), 'teams-realtime-translator.html');

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
        shell.openExternal(url);
        return { action: 'deny' };
    });

    console.info('[Main] Main window created');
}

/**
 * システムトレイを作成
 */
function createTray(): void {
    const iconPath = path.join(__dirname, '../icons/tray-icon.png');

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

/**
 * IPC ハンドラーを登録
 */
function registerIPCHandlers(): void {
    // ウィンドウを最小化
    ipcMain.on('minimize-window', () => {
        if (mainWindow) {
            mainWindow.minimize();
        }
    });

    // ウィンドウを最大化/復元
    ipcMain.on('maximize-window', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    // ウィンドウを閉じる
    ipcMain.on('close-window', () => {
        if (mainWindow) {
            mainWindow.close();
        }
    });

    // 常に最前面に表示を切り替え
    ipcMain.on('toggle-always-on-top', () => {
        if (mainWindow) {
            const isAlwaysOnTop = !mainWindow.isAlwaysOnTop();
            mainWindow.setAlwaysOnTop(isAlwaysOnTop);
            saveConfig({ ...loadConfig(), alwaysOnTop: isAlwaysOnTop });
            mainWindow.webContents.send('always-on-top-changed', isAlwaysOnTop);
        }
    });

    // 設定を取得
    ipcMain.handle('get-config', () => {
        return loadConfig();
    });

    // 設定を保存
    ipcMain.handle('save-config', (_event, config: Partial<AppConfig>) => {
        saveConfig({ ...loadConfig(), ...config });
        return true;
    });

    // 音声ソースを取得
    ipcMain.handle('get-audio-sources', async (_event, types?: ('window' | 'screen')[]) => {
        return await ElectronAudioCapture.getAudioSources(types);
    });

    // 会議アプリを検出
    ipcMain.handle('detect-meeting-apps', async () => {
        return await ElectronAudioCapture.detectMeetingApps();
    });

    // 音声トラックの有無を確認（レンダラープロセスから呼ばれる）
    ipcMain.handle('check-audio-track', async (_event, sourceId: string) => {
        console.info(`[Main] ========== 音声トラック確認開始 ==========`);
        console.info(`[Main] ソースID: ${sourceId}`);

        // レンダラープロセスに確認を依頼
        if (mainWindow) {
            try {
                const result = await mainWindow.webContents.executeJavaScript(`
                    (async () => {
                        try {
                            console.info('[Audio Check] ストリーム取得開始...');
                            const constraints = {
                                audio: {
                                    mandatory: {
                                        chromeMediaSource: 'desktop',
                                        chromeMediaSourceId: '${sourceId}'
                                    }
                                },
                                video: {
                                    mandatory: {
                                        chromeMediaSource: 'desktop',
                                        chromeMediaSourceId: '${sourceId}'
                                    }
                                }
                            };
                            const stream = await navigator.mediaDevices.getUserMedia(constraints);
                            console.info('[Audio Check] ストリーム取得成功');

                            const audioTracks = stream.getAudioTracks();
                            const videoTracks = stream.getVideoTracks();
                            console.info('[Audio Check] トラック情報:', {
                                audio: audioTracks.length,
                                video: videoTracks.length
                            });

                            const hasAudio = audioTracks.length > 0;

                            // ストリームを停止
                            stream.getTracks().forEach(track => track.stop());
                            console.info('[Audio Check] ストリーム停止完了');

                            return hasAudio;
                        } catch (error) {
                            console.error('[Audio Check] エラー:', error.message);
                            return false;
                        }
                    })()
                `);

                console.info(`[Main] 音声トラック確認結果: ${result ? '音声あり' : '音声なし'}`);
                console.info(`[Main] ========== 音声トラック確認終了 ==========`);
                return result;
            } catch (error) {
                console.error(`[Main] executeJavaScript失敗:`, error);
                return false;
            }
        }

        console.info(`[Main] mainWindowが存在しません`);
        return false;
    });

    // 音声ソース ID を検証
    ipcMain.handle('validate-source-id', async (_event, sourceId: string) => {
        return await ElectronAudioCapture.validateSourceId(sourceId);
    });

    // 環境変数からAPIキーを取得
    ipcMain.handle('get-env-api-key', async () => {
        // 複数の環境変数名をチェック
        const apiKey =
            process.env['OPENAI_API_KEY'] ||
            process.env['OPENAI_REALTIME_API_KEY'] ||
            process.env['VOICETRANSLATE_API_KEY'] ||
            null;

        if (apiKey) {
            console.info('[Main] API key loaded from environment:', apiKey.substring(0, 7) + '...');
        } else {
            console.info('[Main] API key not found in environment variables');
        }

        return apiKey;
    });

    // 環境変数から設定を取得
    ipcMain.handle('get-env-config', async () => {
        const errors: string[] = [];

        // 2種類のモデル設定（環境変数から読み込み）
        // 優先順位: 環境変数 > .env ファイル > エラー

        // 1. REALTIME_MODEL: Realtime API用（音声→音声翻訳、音声認識）
        const realtimeModel = process.env['OPENAI_REALTIME_MODEL'];
        if (!realtimeModel) {
            errors.push('OPENAI_REALTIME_MODEL が設定されていません');
        }

        // 2. CHAT_MODEL: Chat Completions API用（言語検出、テキスト翻訳）
        const chatModel = process.env['OPENAI_CHAT_MODEL'];
        if (!chatModel) {
            errors.push('OPENAI_CHAT_MODEL が設定されていません');
        }

        // Realtime URL（オプション、デフォルト値あり）
        const realtimeUrl =
            process.env['OPENAI_REALTIME_URL'] || 'wss://api.openai.com/v1/realtime';

        // エラーがある場合は例外を投げる
        if (errors.length > 0) {
            const errorMessage =
                `設定エラー: 必須の環境変数が設定されていません\n` +
                `${errors.join('\n')}\n\n` +
                `.env ファイルに以下の設定を追加してください:\n` +
                `OPENAI_REALTIME_MODEL=gpt-realtime-2025-08-28\n` +
                `OPENAI_CHAT_MODEL=gpt-5-2025-08-07`;

            console.error('[Main]', errorMessage);
            throw new Error(errorMessage);
        }

        const config = {
            realtimeModel: realtimeModel!,
            chatModel: chatModel!,
            realtimeUrl
        };

        console.info('[Main] Config loaded from environment:', {
            realtimeModel: config.realtimeModel,
            chatModel: config.chatModel,
            realtimeUrl: config.realtimeUrl
        });

        return config;
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
            const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
            const screenStatus = systemPreferences.getMediaAccessStatus('screen');

            console.info(
                `[Main] macOS permissions - Microphone: ${micStatus}, Camera: ${cameraStatus}, Screen: ${screenStatus}`
            );

            if (micStatus !== 'granted') {
                console.info('[Main] Requesting microphone permission...');
                await systemPreferences.askForMediaAccess('microphone');
            }

            if (cameraStatus !== 'granted') {
                console.info('[Main] Requesting camera permission...');
                await systemPreferences.askForMediaAccess('camera');
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
app.whenReady().then(async () => {
    console.info('[Main] App is ready');

    // 全プラットフォーム対応: メディアアクセス権限を要求
    await requestMediaPermissions();

    createMainWindow();
    createTray();
    registerGlobalShortcuts();
    registerIPCHandlers();
    initializeRealtimeWebSocket();

    app.on('activate', () => {
        // macOS: Dock アイコンクリック時
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

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
    cleanupRealtimeWebSocket();
    console.info('[Main] App is quitting');
});

/**
 * アプリケーション終了時
 */
app.on('quit', () => {
    console.info('[Main] App has quit');
});
