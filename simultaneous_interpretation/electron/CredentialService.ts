/**
 * OpenAI 認証情報の管理サービス。
 *
 * 環境変数を最優先し、ユーザー入力のキーは Electron safeStorage で暗号化して
 * userData 配下へ保存する。平文へのフォールバックは行わない。
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeStorage } from 'electron';

const CREDENTIAL_FILE_NAME = 'credentials.json';
const CREDENTIAL_FILE_VERSION = 1;
const MAX_API_KEY_LENGTH = 4096;

export type CredentialSource = 'environment' | 'secure-storage' | 'memory' | 'none';

export interface CredentialStatus {
    configured: boolean;
    source: CredentialSource;
    storedFallbackExists: boolean;
    persistenceAvailable: boolean;
    storageError?: string;
}

export interface StoreCredentialResult {
    success: boolean;
    persisted: boolean;
    message?: string;
}

interface StoredCredentialFile {
    version: number;
    openaiApiKey: string;
}

export interface SafeStorageAdapter {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

export class CredentialService {
    private readonly credentialPath: string;
    private readonly storage: SafeStorageAdapter;
    private readonly environment: NodeJS.ProcessEnv;
    private memoryKey: string | null = null;
    private storageError: string | undefined;

    public constructor(
        userDataPath: string,
        storage: SafeStorageAdapter = safeStorage,
        environment: NodeJS.ProcessEnv = process.env
    ) {
        this.credentialPath = path.join(userDataPath, CREDENTIAL_FILE_NAME);
        this.storage = storage;
        this.environment = environment;
    }

    public getStatus(): CredentialStatus {
        const environmentKey = this.readEnvironmentKey();
        if (environmentKey !== null) {
            return {
                configured: true,
                source: 'environment',
                storedFallbackExists: this.hasStoredFallback(),
                persistenceAvailable: this.storage.isEncryptionAvailable(),
                ...(this.storageError !== undefined ? { storageError: this.storageError } : {})
            };
        }

        if (this.memoryKey !== null) {
            return {
                configured: true,
                source: 'memory',
                storedFallbackExists: this.hasStoredFallback(),
                persistenceAvailable: this.storage.isEncryptionAvailable(),
                ...(this.storageError !== undefined ? { storageError: this.storageError } : {})
            };
        }

        const storedKey = this.readStoredKey();
        return {
            configured: storedKey !== null,
            source: storedKey !== null ? 'secure-storage' : 'none',
            storedFallbackExists: storedKey !== null,
            persistenceAvailable: this.storage.isEncryptionAvailable(),
            ...(this.storageError !== undefined ? { storageError: this.storageError } : {})
        };
    }

    /** main 内部の OpenAI クライアントだけが使用する。renderer へ返してはならない。 */
    public getApiKey(): string | null {
        return this.readEnvironmentKey() ?? this.memoryKey ?? this.readStoredKey();
    }

    public storeKey(rawKey: string): StoreCredentialResult {
        const key = this.normalizeKey(rawKey);
        this.memoryKey = key;
        this.storageError = undefined;

        if (!this.storage.isEncryptionAvailable()) {
            this.storageError =
                'OS の暗号化ストレージを利用できないため、キーは今回の起動中のみ保持されます';
            return { success: true, persisted: false, message: this.storageError };
        }

        const encrypted = this.storage.encryptString(key);
        const stored: StoredCredentialFile = {
            version: CREDENTIAL_FILE_VERSION,
            openaiApiKey: encrypted.toString('base64')
        };

        this.writeAtomically(JSON.stringify(stored, null, 2));
        this.memoryKey = null;
        return { success: true, persisted: true };
    }

    public clearStoredKey(): void {
        this.memoryKey = null;
        this.storageError = undefined;
        try {
            fs.rmSync(this.credentialPath, { force: true });
        } catch (error) {
            throw new Error(
                `暗号化済み API キーを削除できませんでした: ${this.errorMessage(error)}`
            );
        }
    }

    private readEnvironmentKey(): string | null {
        const value =
            this.environment['OPENAI_API_KEY'] ??
            this.environment['OPENAI_REALTIME_API_KEY'] ??
            this.environment['VOICETRANSLATE_API_KEY'];
        if (value === undefined || value.trim() === '') {
            return null;
        }
        return value.trim();
    }

    private readStoredKey(): string | null {
        if (!fs.existsSync(this.credentialPath)) {
            return null;
        }
        if (!this.storage.isEncryptionAvailable()) {
            this.storageError =
                'OS の暗号化ストレージを利用できないため、保存済みキーを復号できません';
            return null;
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(this.credentialPath, 'utf8')) as unknown;
            if (!this.isStoredCredentialFile(parsed)) {
                throw new Error('認証情報ファイルの形式が不正です');
            }
            const decrypted = this.storage.decryptString(
                Buffer.from(parsed.openaiApiKey, 'base64')
            );
            return this.normalizeKey(decrypted);
        } catch (error) {
            this.storageError = '保存済み API キーを復号できません。キーを再入力してください';
            try {
                fs.rmSync(this.credentialPath, { force: true });
            } catch {
                // 元の復号エラーを優先し、削除失敗は次回の読み込みでも同じ安全な状態に留める。
            }
            return null;
        }
    }

    private hasStoredFallback(): boolean {
        return fs.existsSync(this.credentialPath);
    }

    private normalizeKey(rawKey: string): string {
        if (typeof rawKey !== 'string') {
            throw new TypeError('API キーは文字列で指定してください');
        }
        const key = rawKey.trim();
        if (key.length === 0 || key.length > MAX_API_KEY_LENGTH) {
            throw new Error('API キーの長さが不正です');
        }
        return key;
    }

    private writeAtomically(content: string): void {
        const directory = path.dirname(this.credentialPath);
        fs.mkdirSync(directory, { recursive: true });
        const temporaryPath = `${this.credentialPath}.${process.pid}.${Date.now()}.tmp`;
        try {
            fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
            fs.renameSync(temporaryPath, this.credentialPath);
        } catch (error) {
            try {
                fs.rmSync(temporaryPath, { force: true });
            } catch {
                // 一時ファイルの削除失敗より書き込みエラーを優先する。
            }
            throw new Error(`API キーを安全に保存できませんでした: ${this.errorMessage(error)}`);
        }
    }

    private isStoredCredentialFile(value: unknown): value is StoredCredentialFile {
        if (typeof value !== 'object' || value === null) {
            return false;
        }
        const candidate = value as Record<string, unknown>;
        return (
            candidate['version'] === CREDENTIAL_FILE_VERSION &&
            typeof candidate['openaiApiKey'] === 'string' &&
            candidate['openaiApiKey'].length > 0
        );
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
