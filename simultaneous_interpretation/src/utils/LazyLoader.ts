/**
 * LazyLoader.ts
 *
 * 目的: 非クリティカルモジュールの遅延ロード管理
 *
 * 機能:
 *   - Dynamic import による遅延ロード
 *   - モジュールキャッシュ管理
 *   - ロード状態の追跡
 *   - エラーハンドリング
 *
 * 使用方法:
 *   const module = await lazyLoad('TerminologyManager');
 *
 * 注意:
 *   - クリティカルパスのモジュールには使用しない
 *   - 初回ロード時のみ遅延が発生
 */

import { defaultLogger } from './Logger';

/**
 * 遅延ロード可能なモジュール名
 */
export type LazyModuleName =
    | 'TerminologyManager'
    | 'ConversationContext'
    | 'EchoCanceller'
    | 'NoiseSuppression'
    | 'TranslationCache'
    | 'PerformanceTestFramework'
    | 'QualityMetrics';

/**
 * モジュールロード状態
 */
export type LoadStatus = 'pending' | 'loading' | 'loaded' | 'failed';

/**
 * モジュール情報
 */
interface ModuleInfo {
    name: LazyModuleName;
    status: LoadStatus;
    module: unknown | null;
    loadTime?: number;
    error?: Error;
}

/**
 * LazyLoader クラス
 *
 * 目的: モジュールの遅延ロードを管理
 */
export class LazyLoader {
    private static instance: LazyLoader | null = null;

    private moduleCache: Map<LazyModuleName, ModuleInfo> = new Map();
    private loadingPromises: Map<LazyModuleName, Promise<unknown>> = new Map();

    private constructor() {
        // Singleton パターン
    }

    /**
     * シングルトンインスタンス取得
     */
    public static getInstance(): LazyLoader {
        if (!LazyLoader.instance) {
            LazyLoader.instance = new LazyLoader();
        }
        return LazyLoader.instance;
    }

    /**
     * モジュールを遅延ロード
     *
     * @param moduleName モジュール名
     * @returns ロードされたモジュール
     */
    public async load<T = unknown>(moduleName: LazyModuleName): Promise<T> {
        // キャッシュチェック
        const cached = this.moduleCache.get(moduleName);
        if (cached?.status === 'loaded' && cached.module) {
            defaultLogger.debug('[LazyLoader] キャッシュヒット', { moduleName });
            return cached.module as T;
        }

        // ロード中の場合は既存の Promise を返す
        const loadingPromise = this.loadingPromises.get(moduleName);
        if (loadingPromise) {
            defaultLogger.debug('[LazyLoader] ロード中', { moduleName });
            return loadingPromise as Promise<T>;
        }

        // 新規ロード
        const promise = this.loadModule<T>(moduleName);
        this.loadingPromises.set(moduleName, promise);

        try {
            const module = await promise;
            this.loadingPromises.delete(moduleName);
            return module;
        } catch (error) {
            this.loadingPromises.delete(moduleName);
            throw error;
        }
    }

    /**
     * モジュールをロード（内部実装）
     *
     * @param moduleName モジュール名
     * @returns ロードされたモジュール
     */
    private async loadModule<T>(moduleName: LazyModuleName): Promise<T> {
        const startTime = performance.now();

        // ステータス更新
        this.moduleCache.set(moduleName, {
            name: moduleName,
            status: 'loading',
            module: null
        });

        defaultLogger.info('[LazyLoader] モジュールロード開始', { moduleName });

        try {
            const module = await this.importModule<T>(moduleName);
            const loadTime = performance.now() - startTime;

            // ステータス更新
            this.moduleCache.set(moduleName, {
                name: moduleName,
                status: 'loaded',
                module,
                loadTime
            });

            defaultLogger.info('[LazyLoader] モジュールロード成功', {
                moduleName,
                time: loadTime.toFixed(2) + 'ms'
            });

            return module;
        } catch (error) {
            // ステータス更新
            this.moduleCache.set(moduleName, {
                name: moduleName,
                status: 'failed',
                module: null,
                error: error as Error
            });

            defaultLogger.error('[LazyLoader] モジュールロード失敗', {
                moduleName,
                error
            });

            throw error;
        }
    }

    /**
     * Dynamic import でモジュールをインポート
     *
     * @param moduleName モジュール名
     * @returns インポートされたモジュール
     */
    private async importModule<T>(moduleName: LazyModuleName): Promise<T> {
        switch (moduleName) {
            case 'TerminologyManager': {
                const module = await import('../context/TerminologyManager');
                return module.TerminologyManager as T;
            }
            case 'ConversationContext': {
                const module = await import('../context/ConversationContext');
                return module.ConversationContext as T;
            }
            case 'EchoCanceller': {
                const module = await import('../audio/EchoCanceller');
                return module.EchoCanceller as T;
            }
            case 'NoiseSuppression': {
                const module = await import('../audio/NoiseSuppression');
                return module.NoiseSuppression as T;
            }
            case 'TranslationCache': {
                const module = await import('./TranslationCache');
                return module.TranslationCache as T;
            }
            case 'PerformanceTestFramework': {
                const module = await import('../test/PerformanceTestFramework');
                return module.PerformanceTestFramework as T;
            }
            case 'QualityMetrics': {
                const module = await import('../test/QualityMetrics');
                return module as T;
            }
            default: {
                const exhaustiveCheck: never = moduleName;
                throw new Error(`Unknown module: ${exhaustiveCheck}`);
            }
        }
    }

    /**
     * モジュールのロード状態を取得
     *
     * @param moduleName モジュール名
     * @returns ロード状態
     */
    public getStatus(moduleName: LazyModuleName): LoadStatus {
        const info = this.moduleCache.get(moduleName);
        return info?.status ?? 'pending';
    }

    /**
     * すべてのモジュールのロード状態を取得
     *
     * @returns モジュール情報の配列
     */
    public getAllStatus(): Array<{
        name: LazyModuleName;
        status: LoadStatus;
        loadTime?: number | undefined;
    }> {
        return Array.from(this.moduleCache.values()).map((info) => ({
            name: info.name,
            status: info.status,
            loadTime: info.loadTime
        }));
    }

    /**
     * モジュールをプリロード（バックグラウンドでロード）
     *
     * @param moduleNames プリロードするモジュール名の配列
     */
    public async preload(moduleNames: LazyModuleName[]): Promise<void> {
        defaultLogger.info('[LazyLoader] モジュールプリロード開始', {
            modules: moduleNames
        });

        const promises = moduleNames.map((name) =>
            this.load(name).catch((error) => {
                defaultLogger.warn('[LazyLoader] プリロード失敗', { name, error });
            })
        );

        await Promise.allSettled(promises);

        defaultLogger.info('[LazyLoader] モジュールプリロード完了');
    }

    /**
     * キャッシュをクリア
     */
    public clearCache(): void {
        this.moduleCache.clear();
        this.loadingPromises.clear();
        defaultLogger.info('[LazyLoader] キャッシュクリア完了');
    }

    /**
     * 統計情報を取得
     *
     * @returns 統計情報
     */
    public getStatistics(): {
        totalModules: number;
        loadedModules: number;
        failedModules: number;
        averageLoadTime: number;
    } {
        const modules = Array.from(this.moduleCache.values());
        const totalModules = modules.length;
        const loadedModules = modules.filter((m) => m.status === 'loaded').length;
        const failedModules = modules.filter((m) => m.status === 'failed').length;

        const loadTimes = modules.filter((m) => m.loadTime !== undefined).map((m) => m.loadTime!);
        const averageLoadTime =
            loadTimes.length > 0
                ? loadTimes.reduce((sum, time) => sum + time, 0) / loadTimes.length
                : 0;

        return {
            totalModules,
            loadedModules,
            failedModules,
            averageLoadTime
        };
    }
}

/**
 * グローバルインスタンス取得
 */
export function getLazyLoader(): LazyLoader {
    return LazyLoader.getInstance();
}

/**
 * モジュールを遅延ロード（便利関数）
 *
 * @param moduleName モジュール名
 * @returns ロードされたモジュール
 */
export async function lazyLoad<T = unknown>(moduleName: LazyModuleName): Promise<T> {
    const loader = LazyLoader.getInstance();
    return loader.load<T>(moduleName);
}

/**
 * 複数モジュールをプリロード（便利関数）
 *
 * @param moduleNames モジュール名の配列
 */
export async function preloadModules(moduleNames: LazyModuleName[]): Promise<void> {
    const loader = LazyLoader.getInstance();
    await loader.preload(moduleNames);
}
