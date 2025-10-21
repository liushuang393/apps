# VoiceTranslate Pro テスト計画書

## 📋 テスト戦略概要

### テスト目標
- ✅ コードカバレッジ 80% 以上
- ✅ 全ての重要機能の動作保証
- ✅ セキュリティ脆弱性の検出
- ✅ パフォーマンス基準の達成
- ✅ ユーザビリティの検証

### テストレベル
1. **単体テスト (Unit Tests)** - 個別関数・クラスのテスト
2. **統合テスト (Integration Tests)** - コンポーネント間の連携テスト
3. **E2Eテスト (End-to-End Tests)** - ユーザーフロー全体のテスト
4. **パフォーマンステスト** - 速度・メモリ・CPU使用率
5. **セキュリティテスト** - 脆弱性スキャン

---

## 🧪 Phase 0: 緊急修復 - テスト計画

### 0.1 HTML構造修復 - テスト

#### テストケース

**TC-0.1.1: HTML バリデーション**
```yaml
目的: HTML 構造が正しいことを確認
手順:
  1. teams-realtime-translator.html を W3C Validator で検証
  2. エラー・警告がないことを確認
期待結果:
  - バリデーションエラー: 0
  - 警告: 0
```

**TC-0.1.2: JavaScript ロード確認**
```yaml
目的: 外部 JavaScript が正しくロードされることを確認
手順:
  1. ブラウザで HTML ファイルを開く
  2. 開発者ツールのコンソールを確認
  3. Network タブで voicetranslate-pro.js のロードを確認
期待結果:
  - JavaScript ファイルが正常にロード
  - コンソールエラーなし
  - VoiceTranslateApp クラスが定義されている
```

**TC-0.1.3: UI レンダリング確認**
```yaml
目的: UI が正しく表示されることを確認
手順:
  1. ブラウザで HTML ファイルを開く
  2. 全ての UI 要素が表示されることを確認
期待結果:
  - ヘッダーが表示される
  - サイドバーが表示される
  - メインコンテンツが表示される
  - ビジュアライザーが表示される
```

#### 自動テスト

```typescript
// tests/html-structure.test.ts
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

describe('HTML Structure', () => {
    let dom: JSDOM;
    let document: Document;
    
    beforeAll(() => {
        const html = fs.readFileSync(
            path.join(__dirname, '../teams-realtime-translator.html'),
            'utf-8'
        );
        dom = new JSDOM(html, { runScripts: 'dangerously' });
        document = dom.window.document;
    });
    
    test('should have valid HTML structure', () => {
        expect(document.doctype).toBeTruthy();
        expect(document.documentElement.tagName).toBe('HTML');
    });
    
    test('should load external JavaScript', () => {
        const scripts = document.querySelectorAll('script[src]');
        const jsScript = Array.from(scripts).find(
            s => s.getAttribute('src') === 'voicetranslate-pro.js'
        );
        expect(jsScript).toBeTruthy();
    });
    
    test('should have all required UI elements', () => {
        expect(document.getElementById('apiKey')).toBeTruthy();
        expect(document.getElementById('connectBtn')).toBeTruthy();
        expect(document.getElementById('startBtn')).toBeTruthy();
        expect(document.getElementById('visualizer')).toBeTruthy();
    });
    
    test('should not have duplicate code after closing tags', () => {
        const bodyContent = document.body.innerHTML;
        const closingBodyIndex = bodyContent.lastIndexOf('</body>');
        
        // </body> タグの後にコンテンツがないことを確認
        if (closingBodyIndex !== -1) {
            const afterBody = bodyContent.substring(closingBodyIndex + 7).trim();
            expect(afterBody).toBe('');
        }
    });
});
```

---

### 0.2 WebSocket認証実装 - テスト

#### テストケース

**TC-0.2.1: 有効な API キーで接続成功**
```yaml
目的: 正しい API キーで WebSocket 接続が成功することを確認
前提条件:
  - 有効な OpenAI API キーを用意
手順:
  1. WebSocketManager インスタンスを作成
  2. connect() メソッドを呼び出し
  3. 接続状態を確認
期待結果:
  - 接続成功
  - onopen イベントが発火
  - 認証メッセージが送信される
```

**TC-0.2.2: 無効な API キーで接続失敗**
```yaml
目的: 無効な API キーで適切にエラーハンドリングされることを確認
前提条件:
  - 無効な API キー（例: "invalid-key"）
手順:
  1. WebSocketManager インスタンスを作成
  2. connect() メソッドを呼び出し
  3. エラーを確認
期待結果:
  - AuthenticationError がスローされる
  - エラーメッセージが適切
```

**TC-0.2.3: 接続切断時の再接続**
```yaml
目的: 接続が切断された時に自動再接続されることを確認
手順:
  1. WebSocket 接続を確立
  2. 接続を強制的に切断
  3. 再接続の試行を確認
期待結果:
  - 再接続が試みられる
  - 指数バックオフが適用される
  - 最大再接続回数で停止
```

#### 自動テスト

```typescript
// tests/websocket-manager.test.ts
import { WebSocketManager } from '../src/WebSocketManager';
import { AuthenticationError, ConnectionError } from '../src/errors';

// WebSocket のモック
class MockWebSocket {
    readyState: number = WebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onerror: ((error: Event) => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    
    constructor(public url: string) {
        // 非同期で接続をシミュレート
        setTimeout(() => {
            this.readyState = WebSocket.OPEN;
            if (this.onopen) this.onopen();
        }, 10);
    }
    
    send(data: string): void {
        // メッセージ送信をシミュレート
    }
    
    close(): void {
        this.readyState = WebSocket.CLOSED;
        if (this.onclose) this.onclose();
    }
}

// グローバル WebSocket を置き換え
global.WebSocket = MockWebSocket as any;

describe('WebSocketManager', () => {
    let manager: WebSocketManager;
    
    beforeEach(() => {
        manager = new WebSocketManager('sk-test-valid-key');
    });
    
    test('should connect successfully with valid API key', async () => {
        await expect(
            manager.connect('gpt-4o-realtime-preview')
        ).resolves.not.toThrow();
        
        expect(manager.isConnected()).toBe(true);
    });
    
    test('should throw AuthenticationError with invalid API key', async () => {
        const invalidManager = new WebSocketManager('invalid-key');
        
        await expect(
            invalidManager.connect('gpt-4o-realtime-preview')
        ).rejects.toThrow(AuthenticationError);
    });
    
    test('should send authentication message on connect', async () => {
        const sendSpy = jest.spyOn(manager as any, 'send');
        
        await manager.connect('gpt-4o-realtime-preview');
        
        expect(sendSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'session.update',
                session: expect.objectContaining({
                    api_key: 'sk-test-valid-key'
                })
            })
        );
    });
    
    test('should attempt reconnection on connection loss', async () => {
        await manager.connect('gpt-4o-realtime-preview');
        
        // 接続を切断
        (manager as any).ws.close();
        
        // 少し待つ
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 再接続が試みられたことを確認
        expect((manager as any).reconnectAttempts).toBeGreaterThan(0);
    });
    
    test('should stop reconnecting after max attempts', async () => {
        await manager.connect('gpt-4o-realtime-preview');
        
        // 最大再接続回数を超えるまで切断を繰り返す
        for (let i = 0; i < 6; i++) {
            (manager as any).ws.close();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // ConnectionError がスローされることを確認
        expect((manager as any).reconnectAttempts).toBe(5);
    });
});
```

---

### 0.3 API Key暗号化ストレージ - テスト

#### テストケース

**TC-0.3.1: 暗号化と復号化の正確性**
```yaml
目的: データが正しく暗号化・復号化されることを確認
手順:
  1. テストデータを暗号化
  2. 暗号化されたデータを復号化
  3. 元のデータと比較
期待結果:
  - 復号化されたデータが元のデータと一致
```

**TC-0.3.2: 間違ったパスワードで復号化失敗**
```yaml
目的: 間違ったパスワードで復号化が失敗することを確認
手順:
  1. データを password1 で暗号化
  2. password2 で復号化を試みる
期待結果:
  - 復号化が失敗
  - 適切なエラーがスローされる
```

**TC-0.3.3: API キーの保存と読み込み**
```yaml
目的: API キーが正しく保存・読み込みされることを確認
手順:
  1. API キーを保存
  2. API キーを読み込み
  3. 元のキーと比較
期待結果:
  - 読み込まれたキーが元のキーと一致
  - ストレージに平文が保存されていない
```

#### 自動テスト

```typescript
// tests/secure-storage.test.ts
import { SecureStorageManager } from '../src/SecureStorageManager';

describe('SecureStorageManager', () => {
    const testApiKey = 'sk-test-1234567890abcdefghijklmnopqrstuvwxyz';
    const testPassword = 'test-password-123';
    
    test('should encrypt and decrypt data correctly', async () => {
        const encrypted = await SecureStorageManager.encrypt(
            testApiKey,
            testPassword
        );
        
        // 暗号化されたデータが元のデータと異なることを確認
        expect(encrypted).not.toBe(testApiKey);
        
        const decrypted = await SecureStorageManager.decrypt(
            encrypted,
            testPassword
        );
        
        // 復号化されたデータが元のデータと一致することを確認
        expect(decrypted).toBe(testApiKey);
    });
    
    test('should fail to decrypt with wrong password', async () => {
        const encrypted = await SecureStorageManager.encrypt(
            testApiKey,
            'password1'
        );
        
        await expect(
            SecureStorageManager.decrypt(encrypted, 'password2')
        ).rejects.toThrow();
    });
    
    test('should generate different encrypted data each time', async () => {
        const encrypted1 = await SecureStorageManager.encrypt(
            testApiKey,
            testPassword
        );
        const encrypted2 = await SecureStorageManager.encrypt(
            testApiKey,
            testPassword
        );
        
        // ランダムな IV とソルトにより、毎回異なる暗号化データが生成される
        expect(encrypted1).not.toBe(encrypted2);
        
        // しかし、両方とも正しく復号化できる
        const decrypted1 = await SecureStorageManager.decrypt(
            encrypted1,
            testPassword
        );
        const decrypted2 = await SecureStorageManager.decrypt(
            encrypted2,
            testPassword
        );
        
        expect(decrypted1).toBe(testApiKey);
        expect(decrypted2).toBe(testApiKey);
    });
    
    test('should save and load API key', async () => {
        await SecureStorageManager.saveApiKey(testApiKey);
        
        const loaded = await SecureStorageManager.loadApiKey();
        
        expect(loaded).toBe(testApiKey);
    });
    
    test('should not store plaintext in localStorage', async () => {
        await SecureStorageManager.saveApiKey(testApiKey);
        
        const stored = localStorage.getItem('encrypted_api_key');
        
        // ストレージに保存されているデータが平文でないことを確認
        expect(stored).not.toBe(testApiKey);
        expect(stored).not.toContain('sk-');
    });
    
    test('should return null when no API key is stored', async () => {
        localStorage.clear();
        
        const loaded = await SecureStorageManager.loadApiKey();
        
        expect(loaded).toBeNull();
    });
});
```

---

### 0.4 ログシステム改造 - テスト

#### テストケース

**TC-0.4.1: ログレベルのフィルタリング**
```yaml
目的: ログレベルに応じて適切にフィルタリングされることを確認
手順:
  1. ログレベルを WARN に設定
  2. DEBUG, INFO, WARN, ERROR ログを出力
  3. 出力されたログを確認
期待結果:
  - DEBUG, INFO ログは出力されない
  - WARN, ERROR ログは出力される
```

**TC-0.4.2: ログ履歴の管理**
```yaml
目的: ログ履歴が正しく管理されることを確認
手順:
  1. 複数のログを出力
  2. ログ履歴を取得
  3. 履歴の内容を確認
期待結果:
  - 全てのログが履歴に記録される
  - 最大サイズを超えると古いログが削除される
```

#### 自動テスト

```typescript
// tests/logger.test.ts
import { Logger, LogLevel } from '../src/Logger';

describe('Logger', () => {
    beforeEach(() => {
        Logger.clearHistory();
    });
    
    test('should filter logs based on log level', () => {
        const logger = Logger.getInstance();
        (logger as any).logLevel = LogLevel.WARN;
        
        Logger.debug('Debug message');
        Logger.info('Info message');
        Logger.warn('Warning message');
        Logger.error('Error message');
        
        const history = Logger.getHistory();
        
        // WARN と ERROR のみが記録される
        expect(history.length).toBe(2);
        expect(history[0].level).toBe(LogLevel.WARN);
        expect(history[1].level).toBe(LogLevel.ERROR);
    });
    
    test('should record all log levels in DEBUG mode', () => {
        const logger = Logger.getInstance();
        (logger as any).logLevel = LogLevel.DEBUG;
        
        Logger.debug('Debug');
        Logger.info('Info');
        Logger.warn('Warn');
        Logger.error('Error');
        
        const history = Logger.getHistory();
        
        expect(history.length).toBe(4);
    });
    
    test('should include timestamp in log entries', () => {
        Logger.info('Test message');
        
        const history = Logger.getHistory();
        
        expect(history[0].timestamp).toBeInstanceOf(Date);
    });
    
    test('should include data in log entries', () => {
        const testData = { key: 'value', number: 123 };
        
        Logger.info('Test message', testData);
        
        const history = Logger.getHistory();
        
        expect(history[0].data).toEqual(testData);
    });
    
    test('should include stack trace for errors', () => {
        const error = new Error('Test error');
        
        Logger.error('Error occurred', error);
        
        const history = Logger.getHistory();
        
        expect(history[0].stack).toBeTruthy();
        expect(history[0].stack).toContain('Error: Test error');
    });
    
    test('should limit history size', () => {
        const logger = Logger.getInstance();
        (logger as any).maxHistorySize = 10;
        
        // 15 個のログを出力
        for (let i = 0; i < 15; i++) {
            Logger.info(`Message ${i}`);
        }
        
        const history = Logger.getHistory();
        
        // 最大 10 個まで保持
        expect(history.length).toBe(10);
        
        // 最も古いログが削除され、新しいログが保持される
        expect(history[0].message).toBe('Message 5');
        expect(history[9].message).toBe('Message 14');
    });
    
    test('should not output to console in production', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        
        Logger.error('Production error');
        
        // 本番環境ではコンソールに出力されない
        expect(consoleSpy).not.toHaveBeenCalled();
        
        process.env.NODE_ENV = originalEnv;
        consoleSpy.mockRestore();
    });
});
```

---

## 📊 テストカバレッジ目標

### Phase 0 カバレッジ目標

| コンポーネント | 目標カバレッジ | 優先度 |
|--------------|--------------|--------|
| SecureStorageManager | 90% | 高 |
| WebSocketManager | 85% | 高 |
| Logger | 80% | 中 |
| Utils | 90% | 中 |
| VAD | 75% | 中 |

### 全体目標
- **ライン カバレッジ**: 80% 以上
- **ブランチ カバレッジ**: 75% 以上
- **関数 カバレッジ**: 85% 以上

---

## 🚀 テスト実行

### セットアップ

```bash
# 依存関係のインストール
npm install --save-dev jest @types/jest ts-jest
npm install --save-dev @testing-library/react @testing-library/jest-dom
npm install --save-dev playwright

# Jest 設定
npx ts-jest config:init
```

### 実行コマンド

```bash
# 全テスト実行
npm test

# カバレッジレポート生成
npm test -- --coverage

# 特定のテストファイルのみ実行
npm test -- websocket-manager.test.ts

# ウォッチモード
npm test -- --watch
```

---

**次のドキュメント**: Phase 1-6 のテスト計画

