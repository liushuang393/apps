/**
 * ResourcePreloader.ts
 *
 * 目的: リソースの事前ロードとプリフェッチを管理
 *
 * 機能:
 *   - AudioWorklet モジュールのプリロード
 *   - フォント、CSS、画像のプリロード
 *   - Service Worker 登録
 *   - プリロード状態の追跡
 *
 * 使用方法:
 *   const preloader = ResourcePreloader.getInstance();
 *   await preloader.preloadAll();
 *
 * 注意:
 *   - ブラウザ環境でのみ動作
 *   - AudioContext は別途 AudioContextPreloader を使用
 */

import { defaultLogger } from './Logger';

/**
 * プリロード対象リソースの種類
 */
export type ResourceType = 'script' | 'style' | 'font' | 'image' | 'audio' | 'worklet';

/**
 * プリロード設定
 */
export interface PreloadConfig {
    url: string;
    type: ResourceType;
    as?: string;
    crossOrigin?: 'anonymous' | 'use-credentials';
}

/**
 * プリロード統計
 */
export interface PreloadStatistics {
    totalResources: number;
    loadedResources: number;
    failedResources: number;
    preloadTime: number;
    resourceDetails: Array<{
        url: string;
        type: ResourceType;
        status: 'pending' | 'loaded' | 'failed';
        loadTime?: number | undefined;
    }>;
}

/**
 * ResourcePreloader クラス
 *
 * 目的: アプリケーション起動時にリソースを事前ロード
 */
export class ResourcePreloader {
    private static instance: ResourcePreloader | null = null;

    private preloadStartTime: number = 0;
    private resourceStatus: Map<
        string,
        { type: ResourceType; status: 'pending' | 'loaded' | 'failed'; loadTime?: number }
    > = new Map();

    private constructor() {
        // Singleton パターン
    }

    /**
     * シングルトンインスタンス取得
     */
    public static getInstance(): ResourcePreloader {
        if (!ResourcePreloader.instance) {
            ResourcePreloader.instance = new ResourcePreloader();
        }
        return ResourcePreloader.instance;
    }

    /**
     * すべてのリソースをプリロード
     *
     * @returns プリロード完了の Promise
     */
    public async preloadAll(): Promise<void> {
        defaultLogger.info('[ResourcePreloader] リソースプリロード開始');
        this.preloadStartTime = performance.now();

        const preloadConfigs = this.getPreloadConfigs();

        // 並列プリロード
        const promises = preloadConfigs.map((config) => this.preloadResource(config));

        await Promise.allSettled(promises);

        const stats = this.getStatistics();
        defaultLogger.info('[ResourcePreloader] リソースプリロード完了', {
            total: stats.totalResources,
            loaded: stats.loadedResources,
            failed: stats.failedResources,
            time: stats.preloadTime.toFixed(2) + 'ms'
        });
    }

    /**
     * プリロード設定を取得
     *
     * @returns プリロード設定配列
     */
    private getPreloadConfigs(): PreloadConfig[] {
        const configs: PreloadConfig[] = [];

        // AudioWorklet モジュール
        configs.push({
            url: '/audio-processor-worklet.js',
            type: 'worklet'
        });

        configs.push({
            url: '/echo-canceller-worklet.js',
            type: 'worklet'
        });

        // フォント（存在する場合）
        if (this.resourceExists('/fonts/Roboto-Regular.woff2')) {
            configs.push({
                url: '/fonts/Roboto-Regular.woff2',
                type: 'font',
                as: 'font',
                crossOrigin: 'anonymous'
            });
        }

        // CSS（存在する場合）
        if (this.resourceExists('/styles/main.css')) {
            configs.push({
                url: '/styles/main.css',
                type: 'style'
            });
        }

        return configs;
    }

    /**
     * リソースの存在確認
     *
     * @param _url リソースURL
     * @returns 存在する場合 true
     */
    private resourceExists(_url: string): boolean {
        // 実際の実装では HEAD リクエストで確認
        // ここでは簡略化のため常に false
        return false;
    }

    /**
     * 単一リソースをプリロード
     *
     * @param config プリロード設定
     */
    private async preloadResource(config: PreloadConfig): Promise<void> {
        const startTime = performance.now();
        this.resourceStatus.set(config.url, {
            type: config.type,
            status: 'pending'
        });

        try {
            if (config.type === 'worklet') {
                await this.preloadWorklet(config.url);
            } else {
                await this.preloadWithLinkTag(config);
            }

            const loadTime = performance.now() - startTime;
            this.resourceStatus.set(config.url, {
                type: config.type,
                status: 'loaded',
                loadTime
            });

            defaultLogger.debug('[ResourcePreloader] リソースロード成功', {
                url: config.url,
                type: config.type,
                time: loadTime.toFixed(2) + 'ms'
            });
        } catch (error) {
            this.resourceStatus.set(config.url, {
                type: config.type,
                status: 'failed'
            });

            defaultLogger.warn('[ResourcePreloader] リソースロード失敗', {
                url: config.url,
                error
            });
        }
    }

    /**
     * AudioWorklet モジュールをプリロード
     *
     * @param url モジュールURL
     */
    private async preloadWorklet(url: string): Promise<void> {
        // AudioWorklet は AudioContextPreloader で処理
        // ここでは fetch でキャッシュに保存
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch worklet: ${response.status}`);
        }
        await response.text(); // キャッシュに保存
    }

    /**
     * link タグでプリロード
     *
     * @param config プリロード設定
     */
    private async preloadWithLinkTag(config: PreloadConfig): Promise<void> {
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = config.url;

            if (config.as) {
                link.as = config.as;
            }

            if (config.crossOrigin) {
                link.crossOrigin = config.crossOrigin;
            }

            link.onload = () => resolve();
            link.onerror = () => reject(new Error(`Failed to preload: ${config.url}`));

            document.head.appendChild(link);
        });
    }

    /**
     * Service Worker 登録
     *
     * @param scriptUrl Service Worker スクリプトURL
     */
    public async registerServiceWorker(scriptUrl: string = '/sw.js'): Promise<void> {
        if (!('serviceWorker' in navigator)) {
            defaultLogger.warn('[ResourcePreloader] Service Worker 非対応');
            return;
        }

        try {
            const registration = await navigator.serviceWorker.register(scriptUrl);
            defaultLogger.info('[ResourcePreloader] Service Worker 登録成功', {
                scope: registration.scope
            });
        } catch (error) {
            defaultLogger.error('[ResourcePreloader] Service Worker 登録失敗', error);
        }
    }

    /**
     * プリロード統計を取得
     *
     * @returns プリロード統計
     */
    public getStatistics(): PreloadStatistics {
        const resourceDetails = Array.from(this.resourceStatus.entries()).map(([url, info]) => ({
            url,
            type: info.type,
            status: info.status,
            loadTime: info.loadTime
        }));

        const totalResources = resourceDetails.length;
        const loadedResources = resourceDetails.filter((r) => r.status === 'loaded').length;
        const failedResources = resourceDetails.filter((r) => r.status === 'failed').length;
        const preloadTime =
            this.preloadStartTime > 0 ? performance.now() - this.preloadStartTime : 0;

        return {
            totalResources,
            loadedResources,
            failedResources,
            preloadTime,
            resourceDetails
        };
    }

    /**
     * プリロード状態をリセット
     */
    public reset(): void {
        this.resourceStatus.clear();
        this.preloadStartTime = 0;
    }
}

/**
 * グローバルインスタンス取得
 */
export function getResourcePreloader(): ResourcePreloader {
    return ResourcePreloader.getInstance();
}

/**
 * すべてのリソースをプリロード（便利関数）
 */
export async function preloadAllResources(): Promise<void> {
    const preloader = ResourcePreloader.getInstance();
    await preloader.preloadAll();
}
