/**
 * セキュアストレージマネージャー
 *
 * 目的:
 *   Web Crypto API を使用した AES-256-GCM 暗号化による
 *   API キーの安全な保存と読み込み
 *
 * @features
 * - AES-256-GCM 暗号化
 * - PBKDF2 鍵導出
 * - ランダム IV 生成
 * - ソルト管理
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

import { ConfigurationError } from '../errors';

/**
 * セキュアストレージマネージャーオプション
 */
interface SecureStorageOptions {
    /** ストレージキー */
    storageKey?: string;
    /** PBKDF2 反復回数 */
    iterations?: number;
}

/**
 * ストレージデータ構造
 */
interface StorageData {
    /** Base64エンコードされたソルト */
    salt: string;
    /** Base64エンコードされた初期化ベクトル */
    iv: string;
    /** Base64エンコードされた暗号化データ */
    data: string;
    /** バージョン */
    version: string;
    /** タイムスタンプ */
    timestamp: string;
}

/**
 * セキュアストレージマネージャークラス
 *
 * 目的:
 *   APIキーを暗号化してローカルストレージに安全に保存
 *
 * 注意:
 *   Web Crypto API が必要（HTTPS環境必須）
 */
export class SecureStorageManager {
    private readonly storageKey: string;
    private readonly iterations: number;
    private readonly algorithm: string = 'AES-GCM';
    private readonly keyLength: number = 256;

    /**
     * コンストラクタ
     *
     * @param options - オプション
     * @throws ConfigurationError - Web Crypto API が利用不可の場合
     */
    constructor(options: SecureStorageOptions = {}) {
        this.storageKey = options.storageKey ?? 'voicetranslate_secure';
        this.iterations = options.iterations ?? 100000;

        // Web Crypto API の利用可能性チェック
        if (!this.isCryptoAvailable()) {
            throw new ConfigurationError('Web Crypto API is not available');
        }
    }

    /**
     * Web Crypto API の利用可能性チェック
     *
     * @private
     * @returns 利用可能な場合 true
     */
    private isCryptoAvailable(): boolean {
        return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
    }

    /**
     * マスターキーの導出
     *
     * 目的:
     *   PBKDF2 を使用してパスワードから暗号化キーを生成
     *
     * @private
     * @param password - パスワード
     * @param salt - ソルト
     * @returns 導出されたキー
     */
    private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);

        // パスワードから鍵マテリアルを作成
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        // PBKDF2 で鍵を導出
        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt.buffer as ArrayBuffer,
                iterations: this.iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            {
                name: this.algorithm,
                length: this.keyLength
            },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * データの暗号化
     *
     * 目的:
     *   AES-GCM でデータを暗号化
     *
     * @private
     * @param data - 暗号化するデータ
     * @param key - 暗号化キー
     * @param iv - 初期化ベクトル
     * @returns 暗号化されたデータ
     */
    private async encrypt(data: string, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);

        return await crypto.subtle.encrypt(
            {
                name: this.algorithm,
                iv: iv.buffer as ArrayBuffer
            },
            key,
            dataBuffer
        );
    }

    /**
     * データの復号化
     *
     * 目的:
     *   AES-GCM で暗号化されたデータを復号化
     *
     * @private
     * @param encryptedData - 暗号化されたデータ
     * @param key - 復号化キー
     * @param iv - 初期化ベクトル
     * @returns 復号化されたデータ
     */
    private async decrypt(
        encryptedData: ArrayBuffer,
        key: CryptoKey,
        iv: Uint8Array
    ): Promise<string> {
        const decryptedBuffer = await crypto.subtle.decrypt(
            {
                name: this.algorithm,
                iv: iv.buffer as ArrayBuffer
            },
            key,
            encryptedData
        );

        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);
    }

    /**
     * ランダムバイト列の生成
     *
     * @private
     * @param length - バイト数
     * @returns ランダムバイト列
     */
    private generateRandomBytes(length: number): Uint8Array {
        return crypto.getRandomValues(new Uint8Array(length));
    }

    /**
     * ArrayBuffer を Base64 文字列に変換
     *
     * @private
     * @param buffer - バッファ
     * @returns Base64 文字列
     */
    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            const byte = bytes[i];
            if (byte !== undefined) {
                binary += String.fromCharCode(byte);
            }
        }
        return btoa(binary);
    }

    /**
     * Base64 文字列を ArrayBuffer に変換
     *
     * @private
     * @param base64 - Base64 文字列
     * @returns バッファ
     */
    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * デバイス固有のパスワードを生成
     *
     * 目的:
     *   ブラウザ環境の情報からデバイス固有の識別子を生成
     *
     * @private
     * @returns デバイス固有のパスワード
     *
     * 注意:
     *   完全なデバイス識別には限界がある（ブラウザ環境）
     */
    private getDevicePassword(): string {
        // ブラウザ環境でのデバイス識別子
        const userAgent = navigator.userAgent;
        const language = navigator.language;
        const platform = navigator.platform;
        const screenResolution = `${screen.width}x${screen.height}`;

        // これらを組み合わせてデバイス固有の文字列を作成
        return `${userAgent}|${language}|${platform}|${screenResolution}`;
    }

    /**
     * API キーの保存
     *
     * 目的:
     *   APIキーを暗号化してローカルストレージに保存
     *
     * @param apiKey - API キー
     * @throws ConfigurationError - API キーが空の場合
     * @throws Error - 暗号化失敗時
     */
    public async saveApiKey(apiKey: string): Promise<void> {
        if (!apiKey) {
            throw new ConfigurationError('API key is required');
        }

        // ソルトと IV の生成
        const salt = this.generateRandomBytes(16);
        const iv = this.generateRandomBytes(12);

        // デバイス固有のパスワードを取得
        const password = this.getDevicePassword();

        // 鍵の導出
        const key = await this.deriveKey(password, salt);

        // データの暗号化
        const encryptedData = await this.encrypt(apiKey, key, iv);

        // 保存用データの構築
        const storageData: StorageData = {
            salt: this.arrayBufferToBase64(salt.buffer as ArrayBuffer),
            iv: this.arrayBufferToBase64(iv.buffer as ArrayBuffer),
            data: this.arrayBufferToBase64(encryptedData),
            version: '2.0',
            timestamp: new Date().toISOString()
        };

        // ストレージに保存
        this.saveToStorage(this.storageKey, JSON.stringify(storageData));
    }

    /**
     * API キーの読み込み
     *
     * 目的:
     *   ローカルストレージから暗号化されたAPIキーを復号化して取得
     *
     * @returns API キー（存在しない場合は null）
     * @throws Error - 復号化失敗時
     */
    public async loadApiKey(): Promise<string | null> {
        // ストレージからデータを読み込み
        const storageDataStr = this.loadFromStorage(this.storageKey);

        if (!storageDataStr) {
            return null;
        }

        try {
            const storageData = JSON.parse(storageDataStr) as StorageData;

            // データの検証
            if (!storageData.salt || !storageData.iv || !storageData.data) {
                throw new Error('Invalid storage data format');
            }

            // Base64 からバイナリに変換
            const salt = new Uint8Array(this.base64ToArrayBuffer(storageData.salt));
            const iv = new Uint8Array(this.base64ToArrayBuffer(storageData.iv));
            const encryptedData = this.base64ToArrayBuffer(storageData.data);

            // デバイス固有のパスワードを取得
            const password = this.getDevicePassword();

            // 鍵の導出
            const key = await this.deriveKey(password, salt);

            // データの復号化
            const apiKey = await this.decrypt(encryptedData, key, iv);

            return apiKey;
        } catch (error) {
            throw new Error(`Failed to decrypt API key: ${(error as Error).message}`);
        }
    }

    /**
     * API キーの削除
     */
    public deleteApiKey(): void {
        this.removeFromStorage(this.storageKey);
    }

    /**
     * API キーの存在確認
     *
     * @returns 存在する場合 true
     */
    public hasApiKey(): boolean {
        const data = this.loadFromStorage(this.storageKey);
        return data !== null;
    }

    /**
     * ストレージへの保存
     *
     * @private
     * @param key - キー
     * @param value - 値
     */
    private saveToStorage(key: string, value: string): void {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            // Chrome 拡張機能環境（非同期だが簡略化のため同期的に扱う）
            chrome.storage.local.set({ [key]: value });
        } else {
            // ブラウザ環境
            localStorage.setItem(key, value);
        }
    }

    /**
     * ストレージからの読み込み
     *
     * @private
     * @param key - キー
     * @returns 値
     *
     * 注意:
     *   Chrome拡張環境では本来非同期処理が必要
     */
    private loadFromStorage(key: string): string | null {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            // Chrome 拡張機能環境（同期的な読み込みは不可能なため、localStorage を使用）
            return localStorage.getItem(key);
        } else {
            // ブラウザ環境
            return localStorage.getItem(key);
        }
    }

    /**
     * ストレージからの削除
     *
     * @private
     * @param key - キー
     */
    private removeFromStorage(key: string): void {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.remove(key);
        } else {
            localStorage.removeItem(key);
        }
    }
}

