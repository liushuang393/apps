/**
 * BrowserAdapter.ts
 * 
 * 目的: ブラウザAPI適応層
 * Chrome Extension API を抽象化し、プラットフォーム非依存のインターフェースを提供
 */

import type {
    IPlatformAdapter,
    IStorageAdapter,
    NotificationOptions,
    StorageKey
} from '../../src/interfaces/ICoreTypes';

/**
 * Chrome Storage Adapter
 * chrome.storage.local を使用したストレージ実装
 */
export class ChromeStorageAdapter implements IStorageAdapter {
    /**
     * データを保存
     */
    async save(key: StorageKey, value: any): Promise<void> {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [key]: value }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * データを読み込み
     */
    async load(key: StorageKey): Promise<any> {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get([key], (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(result[key]);
                }
            });
        });
    }

    /**
     * データを削除
     */
    async remove(key: StorageKey): Promise<void> {
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove([key], () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * すべてのデータをクリア
     */
    async clear(): Promise<void> {
        return new Promise((resolve, reject) => {
            chrome.storage.local.clear(() => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });
    }
}

/**
 * Browser Platform Adapter
 * ブラウザ拡張機能用のプラットフォーム適応層
 */
export class BrowserPlatformAdapter implements IPlatformAdapter {
    storage: IStorageAdapter;

    constructor() {
        this.storage = new ChromeStorageAdapter();
    }

    /**
     * 要素を取得
     */
    getElementById(id: string): HTMLElement | null {
        return document.getElementById(id);
    }

    /**
     * 通知を表示
     */
    notify(options: NotificationOptions): void {
        // ブラウザ拡張機能では、UI内に通知を表示
        const notificationContainer = this.getElementById('notification-container');
        if (!notificationContainer) {
            console.warn('[BrowserAdapter] Notification container not found');
            return;
        }

        const notification = document.createElement('div');
        notification.className = `notification notification-${options.type}`;
        notification.innerHTML = `
            <div class="notification-title">${options.title}</div>
            <div class="notification-message">${options.message}</div>
        `;

        notificationContainer.appendChild(notification);

        // 自動削除
        const duration = options.duration || 3000;
        setTimeout(() => {
            notification.remove();
        }, duration);
    }

    /**
     * マイク権限をチェック
     */
    async checkMicrophonePermission(): Promise<boolean> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (error) {
            console.error('[BrowserAdapter] Microphone permission denied:', error);
            return false;
        }
    }

    /**
     * 音声ソースを検出
     */
    async detectAudioSources(): Promise<MediaDeviceInfo[]> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(device => device.kind === 'audioinput');
        } catch (error) {
            console.error('[BrowserAdapter] Failed to detect audio sources:', error);
            return [];
        }
    }

    /**
     * タブキャプチャを開始
     */
    async startTabCapture(): Promise<MediaStream> {
        return new Promise((resolve, reject) => {
            chrome.tabCapture.capture(
                { audio: true, video: false },
                (stream) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (stream) {
                        resolve(stream);
                    } else {
                        reject(new Error('Failed to capture tab audio'));
                    }
                }
            );
        });
    }

    /**
     * 現在のタブを取得
     */
    async getCurrentTab(): Promise<chrome.tabs.Tab | null> {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                resolve(tabs[0] || null);
            });
        });
    }

    /**
     * バックグラウンドにメッセージを送信
     */
    async sendMessageToBackground(message: any): Promise<any> {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    /**
     * バックグラウンドからのメッセージをリスン
     */
    onMessageFromBackground(callback: (message: any, sender: chrome.runtime.MessageSender) => void): void {
        chrome.runtime.onMessage.addListener((message, sender) => {
            callback(message, sender);
            return false; // 同期レスポンス
        });
    }
}

/**
 * グローバルインスタンス
 */
export const browserAdapter = new BrowserPlatformAdapter();

