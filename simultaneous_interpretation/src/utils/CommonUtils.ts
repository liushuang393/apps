/**
 * 共通ユーティリティ関数
 *
 * @description
 * 汎用的なユーティリティ関数を提供
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * 共通ユーティリティクラス
 */
export class CommonUtils {
    /**
     * 時間をフォーマット (HH:MM:SS)
     */
    static formatTime(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    /**
     * 言語コードから英語名を取得
     */
    static getLanguageName(code: string): string {
        const names: Record<string, string> = {
            'ja': 'Japanese',
            'en': 'English',
            'zh': 'Chinese',
            'ko': 'Korean',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'pt': 'Portuguese'
        };
        return names[code] || code;
    }

    /**
     * 言語コードからネイティブ名を取得
     */
    static getNativeLanguageName(code: string): string {
        const names: Record<string, string> = {
            'ja': '日本語',
            'en': 'English',
            'zh': '中文',
            'ko': '한국어',
            'es': 'Español',
            'fr': 'Français',
            'de': 'Deutsch',
            'pt': 'Português'
        };
        return names[code] || code;
    }

    /**
     * ディープコピー
     */
    static deepClone<T>(obj: T): T {
        return JSON.parse(JSON.stringify(obj));
    }

    /**
     * デバウンス関数
     */
    static debounce<T extends (...args: any[]) => any>(
        func: T,
        wait: number
    ): (...args: Parameters<T>) => void {
        let timeout: NodeJS.Timeout | number | null = null;
        
        return function(this: any, ...args: Parameters<T>) {
            const context = this;
            
            if (timeout !== null) {
                clearTimeout(timeout as number);
            }
            
            timeout = setTimeout(() => {
                func.apply(context, args);
            }, wait);
        };
    }

    /**
     * スロットル関数
     */
    static throttle<T extends (...args: any[]) => any>(
        func: T,
        limit: number
    ): (...args: Parameters<T>) => void {
        let inThrottle = false;
        
        return function(this: any, ...args: Parameters<T>) {
            const context = this;
            
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                }, limit);
            }
        };
    }

    /**
     * スリープ
     */
    static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * リトライ実行
     */
    static async retry<T>(
        fn: () => Promise<T>,
        maxAttempts = 3,
        delay = 1000
    ): Promise<T> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error as Error;
                console.warn(`[Retry] Attempt ${attempt}/${maxAttempts} failed:`, error);
                
                if (attempt < maxAttempts) {
                    await this.sleep(delay * attempt);
                }
            }
        }
        
        throw lastError;
    }

    /**
     * タイムアウト付き実行
     */
    static async withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        timeoutError = 'Operation timed out'
    ): Promise<T> {
        const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(timeoutError)), timeoutMs);
        });
        
        return Promise.race([promise, timeout]);
    }

    /**
     * UUID 生成
     */
    static generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * ランダム文字列生成
     */
    static generateRandomString(length = 16): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * オブジェクトが空かチェック
     */
    static isEmpty(obj: any): boolean {
        if (obj == null) return true;
        if (Array.isArray(obj) || typeof obj === 'string') return obj.length === 0;
        if (typeof obj === 'object') return Object.keys(obj).length === 0;
        return false;
    }

    /**
     * 安全な JSON パース
     */
    static safeJSONParse<T>(json: string, defaultValue: T): T {
        try {
            return JSON.parse(json);
        } catch {
            return defaultValue;
        }
    }

    /**
     * ファイルサイズをフォーマット
     */
    static formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * パーセンテージを計算
     */
    static calculatePercentage(value: number, total: number): number {
        if (total === 0) return 0;
        return Math.round((value / total) * 100);
    }
}

