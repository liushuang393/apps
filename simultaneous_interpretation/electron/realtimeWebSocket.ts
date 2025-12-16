/**
 * OpenAI Realtime API WebSocket ハンドラー (Electron Main Process)
 *
 * @description
 * Authorizationヘッダーを使用したWebSocket接続を管理
 *
 * 目的:
 *   - Node.jsの`ws`ライブラリを使用してカスタムヘッダーを設定
 *   - renderer processとIPC経由で通信
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

import { ipcMain, BrowserWindow } from 'electron';
import WebSocket from 'ws';

/**
 * WebSocket接続設定
 */
interface WebSocketConfig {
    url: string;
    apiKey: string;
    model: string;
}

/**
 * アクティブなWebSocket接続
 */
let activeWebSocket: WebSocket | null = null;

/**
 * WebSocket接続ハンドラーを初期化
 *
 * 目的:
 *   IPCハンドラーを登録してrenderer processからの要求を処理
 */
export function initializeRealtimeWebSocket(): void {
    console.info('[Realtime WS] Initializing WebSocket handlers');

    // WebSocket接続を確立
    ipcMain.handle('realtime-ws-connect', async (event, config: WebSocketConfig) => {
        try {
            console.info('[Realtime WS] 接続要求を受信:', {
                url: config.url,
                model: config.model,
                apiKey: config.apiKey ? `${config.apiKey.substring(0, 7)}...` : 'なし'
            });

            // 既存の接続をクリーンアップ
            if (activeWebSocket) {
                console.info('[Realtime WS] 既存の接続をクローズ');
                activeWebSocket.close();
                activeWebSocket = null;
            }

            // WebSocket URL構築
            const wsUrl = `${config.url}?model=${config.model}`;
            console.info('[Realtime WS] 接続URL:', wsUrl);

            // Authorizationヘッダー付きでWebSocket作成
            activeWebSocket = new WebSocket(wsUrl, {
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'OpenAI-Beta': 'realtime=v1'
                }
            });

            // イベントハンドラー設定
            setupWebSocketHandlers(activeWebSocket, BrowserWindow.fromWebContents(event.sender));

            return { success: true, message: '接続を開始しました' };
        } catch (error) {
            console.error('[Realtime WS] 接続エラー:', error);
            return {
                success: false,
                message: `接続失敗: ${(error as Error).message}`
            };
        }
    });

    // メッセージ送信
    ipcMain.handle('realtime-ws-send', async (_event, message: string) => {
        try {
            if (!activeWebSocket || activeWebSocket.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocketが接続されていません');
            }

            activeWebSocket.send(message);
            // ログ削除: 頻繁すぎるため
            return { success: true };
        } catch (error) {
            console.error('[Realtime WS] 送信エラー:', error);
            return {
                success: false,
                message: `送信失敗: ${(error as Error).message}`
            };
        }
    });

    // 接続をクローズ
    ipcMain.handle('realtime-ws-close', async () => {
        try {
            if (activeWebSocket) {
                activeWebSocket.close();
                activeWebSocket = null;
                console.info('[Realtime WS] 接続をクローズしました');
            }
            return { success: true };
        } catch (error) {
            console.error('[Realtime WS] クローズエラー:', error);
            return {
                success: false,
                message: `クローズ失敗: ${(error as Error).message}`
            };
        }
    });

    // 接続状態を取得
    ipcMain.handle('realtime-ws-state', async () => {
        if (!activeWebSocket) {
            return { state: 'CLOSED', readyState: WebSocket.CLOSED };
        }

        const stateNames: { [key: number]: string } = {
            [WebSocket.CONNECTING]: 'CONNECTING',
            [WebSocket.OPEN]: 'OPEN',
            [WebSocket.CLOSING]: 'CLOSING',
            [WebSocket.CLOSED]: 'CLOSED'
        };

        return {
            state: stateNames[activeWebSocket.readyState] || 'UNKNOWN',
            readyState: activeWebSocket.readyState
        };
    });
}

/**
 * WebSocketイベントハンドラーを設定
 *
 * @param ws - WebSocketインスタンス
 * @param window - BrowserWindowインスタンス
 */
function setupWebSocketHandlers(ws: WebSocket, window: BrowserWindow | null): void {
    if (!window) {
        console.error('[Realtime WS] BrowserWindow not found');
        return;
    }

    // 接続成功
    ws.on('open', () => {
        console.info('[Realtime WS] WebSocket接続成功');
        window.webContents.send('realtime-ws-open');
    });

    // メッセージ受信
    ws.on('message', (data: WebSocket.Data) => {
        try {
            const message = data.toString();
            // ログ削除: 頻繁すぎるため（必要時はDEBUGモードで確認）
            window.webContents.send('realtime-ws-message', message);
        } catch (error) {
            console.error('[Realtime WS] メッセージ処理エラー:', error);
        }
    });

    // エラー
    ws.on('error', (error: Error) => {
        console.error('[Realtime WS] WebSocketエラー:', error);
        window.webContents.send('realtime-ws-error', {
            message: error.message,
            stack: error.stack
        });
    });

    // 接続クローズ
    ws.on('close', (code: number, reason: Buffer) => {
        console.info('[Realtime WS] WebSocket接続終了:', {
            code,
            reason: reason.toString()
        });
        window.webContents.send('realtime-ws-close', {
            code,
            reason: reason.toString()
        });
        activeWebSocket = null;
    });
}

/**
 * クリーンアップ
 *
 * 目的:
 *   アプリケーション終了時にWebSocket接続をクローズ
 */
export function cleanupRealtimeWebSocket(): void {
    if (activeWebSocket) {
        console.info('[Realtime WS] クリーンアップ: 接続をクローズ');
        activeWebSocket.close();
        activeWebSocket = null;
    }
}
