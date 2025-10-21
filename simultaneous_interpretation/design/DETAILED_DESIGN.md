# VoiceTranslate Pro 詳細設計書

## 📐 Phase 0: 緊急修復 - 詳細設計

---

### 0.1 HTML構造修復

#### 目的
teams-realtime-translator.html ファイルの構造エラーを修正し、正しい HTML 構造を確保する。

#### 現状の問題
- 第 829 行で HTML が正しく閉じられている
- 第 830-1355 行に重複した JavaScript コードが存在
- これにより HTML パーサーエラーが発生

#### 設計
```html
<!-- 正しい構造 -->
<!DOCTYPE html>
<html lang="ja">
<head>
    <!-- メタデータとスタイル -->
</head>
<body>
    <!-- UI コンテンツ -->
    
    <!-- 外部 JavaScript の読み込み -->
    <script src="voicetranslate-pro.js"></script>
</body>
</html>
```

#### 実装手順
1. 第 830-1355 行を完全削除
2. 第 825 行の `<script src="voicetranslate-pro.js"></script>` が正しく配置されていることを確認
3. HTML バリデーターで検証

#### テスト
- HTML バリデーター（W3C）で検証
- ブラウザの開発者ツールでエラーがないことを確認
- ページが正常にロードされることを確認

#### 成功基準
- ✅ HTML バリデーションエラー 0
- ✅ ブラウザコンソールエラー 0
- ✅ JavaScript が正常にロードされる

---

### 0.2 WebSocket認証実装

#### 目的
OpenAI Realtime API への WebSocket 接続時に正しい認証を実装する。

#### 現状の問題
```typescript
// 現在の実装（認証なし）
const wsUrl = `${CONFIG.API.REALTIME_URL}?model=${CONFIG.API.MODEL}`;
this.state.ws = new WebSocket(wsUrl);
```

#### 設計

**認証方式**: HTTP Header ベース認証

```typescript
/**
 * OpenAI Realtime API WebSocket 接続マネージャー
 * 
 * @description
 * WebSocket 接続の確立、認証、再接続を管理する
 * 
 * @input
 * - apiKey: OpenAI API キー（暗号化済み）
 * - model: 使用するモデル名
 * 
 * @output
 * - 認証済み WebSocket 接続
 * 
 * @throws
 * - AuthenticationError: API キーが無効
 * - ConnectionError: 接続失敗
 */
class WebSocketManager {
    private ws: WebSocket | null = null;
    private apiKey: string;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    
    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }
    
    /**
     * WebSocket 接続を確立
     */
    async connect(model: string): Promise<void> {
        const url = `wss://api.openai.com/v1/realtime?model=${model}`;
        
        // WebSocket は直接 header を設定できないため、
        // URL パラメータまたは最初のメッセージで認証
        this.ws = new WebSocket(url);
        
        this.ws.onopen = () => {
            // 接続後すぐに認証メッセージを送信
            this.authenticate();
        };
        
        this.ws.onerror = (error) => {
            this.handleError(error);
        };
        
        this.ws.onclose = () => {
            this.handleClose();
        };
    }
    
    /**
     * 認証メッセージを送信
     */
    private authenticate(): void {
        const authMessage = {
            type: 'session.update',
            session: {
                api_key: this.apiKey,
                model: CONFIG.API.MODEL
            }
        };
        
        this.send(authMessage);
    }
    
    /**
     * メッセージ送信
     */
    send(message: object): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            throw new Error('WebSocket is not connected');
        }
    }
    
    /**
     * エラーハンドリング
     */
    private handleError(error: Event): void {
        Logger.error('WebSocket error', error);
        
        // 認証エラーの場合
        if (this.isAuthenticationError(error)) {
            throw new AuthenticationError('Invalid API key');
        }
        
        // その他のエラーは再接続を試みる
        this.attemptReconnect();
    }
    
    /**
     * 再接続処理
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            
            Logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
            
            setTimeout(() => {
                this.connect(CONFIG.API.MODEL);
            }, delay);
        } else {
            Logger.error('Max reconnection attempts reached');
            throw new ConnectionError('Failed to connect after multiple attempts');
        }
    }
}
```

#### 実装手順
1. `WebSocketManager` クラスを作成
2. 認証ロジックを実装
3. エラーハンドリングと再接続ロジックを実装
4. 既存の WebSocket コードを置き換え

#### テスト
```typescript
describe('WebSocketManager', () => {
    it('should connect with valid API key', async () => {
        const manager = new WebSocketManager('sk-valid-key');
        await expect(manager.connect('gpt-4o-realtime-preview')).resolves.not.toThrow();
    });
    
    it('should throw error with invalid API key', async () => {
        const manager = new WebSocketManager('invalid-key');
        await expect(manager.connect('gpt-4o-realtime-preview')).rejects.toThrow(AuthenticationError);
    });
    
    it('should attempt reconnection on connection loss', async () => {
        const manager = new WebSocketManager('sk-valid-key');
        await manager.connect('gpt-4o-realtime-preview');
        
        // シミュレート接続切断
        manager.ws.close();
        
        // 再接続が試みられることを確認
        expect(manager.reconnectAttempts).toBeGreaterThan(0);
    });
});
```

#### 成功基準
- ✅ 有効な API キーで接続成功
- ✅ 無効な API キーで適切なエラー
- ✅ 接続切断時に自動再接続
- ✅ 最大再接続回数の制限

---

### 0.3 API Key暗号化ストレージ

#### 目的
API キーを安全に暗号化して保存し、セキュリティリスクを軽減する。

#### 現状の問題
```typescript
// 現在の実装（平文保存）
localStorage.setItem('openai_api_key', apiKey);
```

#### 設計

**暗号化方式**: AES-256-GCM

```typescript
/**
 * セキュアストレージマネージャー
 * 
 * @description
 * Web Crypto API を使用して API キーを暗号化して保存
 * 
 * @security
 * - AES-256-GCM 暗号化
 * - ランダム IV（初期化ベクトル）
 * - 暗号化キーは派生（PBKDF2）
 */
class SecureStorageManager {
    private static readonly ALGORITHM = 'AES-GCM';
    private static readonly KEY_LENGTH = 256;
    private static readonly ITERATIONS = 100000;
    
    /**
     * マスターキーを派生
     * 
     * @param password - ユーザーパスワードまたはデバイス固有ID
     * @param salt - ソルト
     * @returns 派生された暗号化キー
     */
    private static async deriveKey(
        password: string,
        salt: Uint8Array
    ): Promise<CryptoKey> {
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);
        
        const baseKey = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveKey']
        );
        
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: this.ITERATIONS,
                hash: 'SHA-256'
            },
            baseKey,
            {
                name: this.ALGORITHM,
                length: this.KEY_LENGTH
            },
            false,
            ['encrypt', 'decrypt']
        );
    }
    
    /**
     * データを暗号化
     * 
     * @param data - 暗号化するデータ
     * @param password - 暗号化パスワード
     * @returns 暗号化されたデータ（Base64）
     */
    static async encrypt(data: string, password: string): Promise<string> {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        
        // ランダムソルトと IV を生成
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        // キーを派生
        const key = await this.deriveKey(password, salt);
        
        // 暗号化
        const encryptedBuffer = await crypto.subtle.encrypt(
            {
                name: this.ALGORITHM,
                iv: iv
            },
            key,
            dataBuffer
        );
        
        // ソルト + IV + 暗号化データを結合
        const combined = new Uint8Array(
            salt.length + iv.length + encryptedBuffer.byteLength
        );
        combined.set(salt, 0);
        combined.set(iv, salt.length);
        combined.set(new Uint8Array(encryptedBuffer), salt.length + iv.length);
        
        // Base64 エンコード
        return this.arrayBufferToBase64(combined);
    }
    
    /**
     * データを復号化
     * 
     * @param encryptedData - 暗号化されたデータ（Base64）
     * @param password - 復号化パスワード
     * @returns 復号化されたデータ
     */
    static async decrypt(encryptedData: string, password: string): Promise<string> {
        // Base64 デコード
        const combined = this.base64ToArrayBuffer(encryptedData);
        
        // ソルト、IV、暗号化データを分離
        const salt = combined.slice(0, 16);
        const iv = combined.slice(16, 28);
        const encrypted = combined.slice(28);
        
        // キーを派生
        const key = await this.deriveKey(password, salt);
        
        // 復号化
        const decryptedBuffer = await crypto.subtle.decrypt(
            {
                name: this.ALGORITHM,
                iv: iv
            },
            key,
            encrypted
        );
        
        // 文字列に変換
        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);
    }
    
    /**
     * API キーを保存
     */
    static async saveApiKey(apiKey: string): Promise<void> {
        // デバイス固有のパスワードを生成（実際の実装では改善が必要）
        const devicePassword = await this.getDevicePassword();
        
        // 暗号化
        const encrypted = await this.encrypt(apiKey, devicePassword);
        
        // 保存
        if (typeof chrome !== 'undefined' && chrome.storage) {
            await chrome.storage.local.set({ encrypted_api_key: encrypted });
        } else {
            localStorage.setItem('encrypted_api_key', encrypted);
        }
    }
    
    /**
     * API キーを読み込み
     */
    static async loadApiKey(): Promise<string | null> {
        // 暗号化データを取得
        let encrypted: string | null = null;
        
        if (typeof chrome !== 'undefined' && chrome.storage) {
            const result = await chrome.storage.local.get(['encrypted_api_key']);
            encrypted = result.encrypted_api_key;
        } else {
            encrypted = localStorage.getItem('encrypted_api_key');
        }
        
        if (!encrypted) {
            return null;
        }
        
        // デバイスパスワードを取得
        const devicePassword = await this.getDevicePassword();
        
        // 復号化
        try {
            return await this.decrypt(encrypted, devicePassword);
        } catch (error) {
            Logger.error('Failed to decrypt API key', error);
            return null;
        }
    }
    
    /**
     * デバイス固有のパスワードを生成
     * 
     * @note 実際の実装では、より安全な方法を使用すべき
     */
    private static async getDevicePassword(): Promise<string> {
        // ブラウザフィンガープリントを使用
        const fingerprint = [
            navigator.userAgent,
            navigator.language,
            new Date().getTimezoneOffset(),
            screen.width,
            screen.height
        ].join('|');
        
        // ハッシュ化
        const encoder = new TextEncoder();
        const data = encoder.encode(fingerprint);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        
        return this.arrayBufferToBase64(hashBuffer);
    }
    
    private static arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    private static base64ToArrayBuffer(base64: string): Uint8Array {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
}
```

#### 実装手順
1. `SecureStorageManager` クラスを作成
2. Web Crypto API を使用した暗号化/復号化を実装
3. 既存のストレージコードを置き換え
4. マイグレーション処理を実装（既存の平文キーを暗号化）

#### テスト
```typescript
describe('SecureStorageManager', () => {
    it('should encrypt and decrypt data correctly', async () => {
        const original = 'sk-test-api-key-12345';
        const password = 'test-password';
        
        const encrypted = await SecureStorageManager.encrypt(original, password);
        const decrypted = await SecureStorageManager.decrypt(encrypted, password);
        
        expect(decrypted).toBe(original);
    });
    
    it('should fail to decrypt with wrong password', async () => {
        const original = 'sk-test-api-key-12345';
        const encrypted = await SecureStorageManager.encrypt(original, 'password1');
        
        await expect(
            SecureStorageManager.decrypt(encrypted, 'password2')
        ).rejects.toThrow();
    });
    
    it('should save and load API key', async () => {
        const apiKey = 'sk-test-api-key-12345';
        
        await SecureStorageManager.saveApiKey(apiKey);
        const loaded = await SecureStorageManager.loadApiKey();
        
        expect(loaded).toBe(apiKey);
    });
});
```

#### 成功基準
- ✅ API キーが暗号化されて保存される
- ✅ 正しく復号化できる
- ✅ 間違ったパスワードで復号化失敗
- ✅ localStorage に平文が保存されない

---

### 0.4 ログシステム改造

#### 目的
console.log を専門的なログシステムに置き換え、本番環境での適切なログ管理を実現する。

#### 設計

```typescript
/**
 * ログレベル
 */
enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

/**
 * ログエントリー
 */
interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    message: string;
    data?: any;
    stack?: string;
}

/**
 * プロフェッショナルロガー
 * 
 * @description
 * 環境に応じたログレベル管理、ログ出力先の制御を提供
 * 
 * @features
 * - 環境別ログレベル（開発/本番）
 * - 構造化ログ
 * - エラー追跡
 * - ログ履歴管理
 */
class Logger {
    private static instance: Logger;
    private logLevel: LogLevel;
    private logHistory: LogEntry[] = [];
    private maxHistorySize: number = 1000;
    
    private constructor() {
        // 環境に応じてログレベルを設定
        this.logLevel = this.getEnvironmentLogLevel();
    }
    
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    
    /**
     * 環境に応じたログレベルを取得
     */
    private getEnvironmentLogLevel(): LogLevel {
        const env = process.env.NODE_ENV || 'development';
        
        switch (env) {
            case 'production':
                return LogLevel.WARN;
            case 'test':
                return LogLevel.ERROR;
            default:
                return LogLevel.DEBUG;
        }
    }
    
    /**
     * DEBUG ログ
     */
    static debug(message: string, data?: any): void {
        Logger.getInstance().log(LogLevel.DEBUG, message, data);
    }
    
    /**
     * INFO ログ
     */
    static info(message: string, data?: any): void {
        Logger.getInstance().log(LogLevel.INFO, message, data);
    }
    
    /**
     * WARN ログ
     */
    static warn(message: string, data?: any): void {
        Logger.getInstance().log(LogLevel.WARN, message, data);
    }
    
    /**
     * ERROR ログ
     */
    static error(message: string, error?: Error | any): void {
        const stack = error instanceof Error ? error.stack : undefined;
        Logger.getInstance().log(LogLevel.ERROR, message, error, stack);
    }
    
    /**
     * ログを記録
     */
    private log(level: LogLevel, message: string, data?: any, stack?: string): void {
        if (level < this.logLevel) {
            return;
        }
        
        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            message,
            data,
            stack
        };
        
        // ログ履歴に追加
        this.addToHistory(entry);
        
        // コンソールに出力（開発環境のみ）
        if (process.env.NODE_ENV !== 'production') {
            this.outputToConsole(entry);
        }
        
        // エラーの場合は追加処理
        if (level === LogLevel.ERROR) {
            this.handleError(entry);
        }
    }
    
    /**
     * ログ履歴に追加
     */
    private addToHistory(entry: LogEntry): void {
        this.logHistory.push(entry);
        
        // 最大サイズを超えたら古いログを削除
        if (this.logHistory.length > this.maxHistorySize) {
            this.logHistory.shift();
        }
    }
    
    /**
     * コンソールに出力
     */
    private outputToConsole(entry: LogEntry): void {
        const prefix = `[${LogLevel[entry.level]}] ${entry.timestamp.toISOString()}`;
        const message = `${prefix} ${entry.message}`;
        
        switch (entry.level) {
            case LogLevel.DEBUG:
                // 開発環境でのみ出力
                break;
            case LogLevel.INFO:
                // 情報ログは出力しない
                break;
            case LogLevel.WARN:
                // eslint-disable-next-line no-console
                console.warn(message, entry.data);
                break;
            case LogLevel.ERROR:
                // eslint-disable-next-line no-console
                console.error(message, entry.data, entry.stack);
                break;
        }
    }
    
    /**
     * エラーハンドリング
     */
    private handleError(entry: LogEntry): void {
        // エラー報告サービスに送信（将来の実装）
        // 例: Sentry, LogRocket など
    }
    
    /**
     * ログ履歴を取得
     */
    static getHistory(): LogEntry[] {
        return Logger.getInstance().logHistory;
    }
    
    /**
     * ログ履歴をクリア
     */
    static clearHistory(): void {
        Logger.getInstance().logHistory = [];
    }
}
```

#### 実装手順
1. `Logger` クラスを作成
2. 全ての `console.log` を `Logger.debug` に置き換え
3. 全ての `console.error` を `Logger.error` に置き換え
4. ESLint ルールで `console.*` を禁止

#### 成功基準
- ✅ console.log 使用箇所 0
- ✅ 本番環境で DEBUG ログが出力されない
- ✅ エラーログが正しく記録される

---

**次のセクション**: 0.5 TypeScript移行、0.6 ESLint、0.7 テスト、0.8 エラーハンドリング

