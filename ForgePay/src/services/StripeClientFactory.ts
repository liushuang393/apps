import crypto from 'crypto';
import { StripeClient } from './StripeClient';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Stripe キーの暗号化/復号化ユーティリティ
 * AES-256-GCM を使用
 */
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  // JWT_SECRET から暗号化キーを導出（32バイト = 256ビット）
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

/**
 * Stripe Secret Key を暗号化
 */
export function encryptStripeKey(plainKey: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(plainKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // IV + AuthTag + 暗号文を結合
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * 暗号化された Stripe Secret Key を復号化
 */
export function decryptStripeKey(encryptedKey: string): string {
  const key = getEncryptionKey();
  const parts = encryptedKey.split(':');

  if (parts.length !== 3) {
    throw new Error('無効な暗号化キー形式');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * StripeClientFactory - マルチテナント対応の Stripe クライアント管理
 * 
 * 責務:
 * - 開発者ごとの Stripe クライアントインスタンスを生成・キャッシュ
 * - 開発者が Stripe キー未設定の場合はグローバルキーにフォールバック
 * - Stripe キーの暗号化/復号化
 * 
 * キャッシュ戦略:
 * - LRU 風キャッシュ（最大100開発者分）
 * - TTL 30分でキャッシュ無効化（キー変更への対応）
 */
export class StripeClientFactory {
  private cache: Map<string, { client: StripeClient; createdAt: number }> = new Map();
  private readonly maxCacheSize = 100;
  private readonly cacheTtlMs = 30 * 60 * 1000; // 30分

  /**
   * 開発者用の Stripe クライアントを取得
   * 
   * @param developerStripeKeyEnc - 暗号化された開発者の Stripe Secret Key（null ならグローバルキー使用）
   * @param developerId - キャッシュキー用の開発者ID
   * @returns StripeClient インスタンス
   */
  getClient(developerStripeKeyEnc: string | null, developerId?: string): StripeClient {
    // 開発者のキーが未設定 → グローバルクライアントを返す
    if (!developerStripeKeyEnc) {
      return this.getGlobalClient();
    }

    const cacheKey = developerId || developerStripeKeyEnc;

    // キャッシュチェック
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < this.cacheTtlMs) {
      return cached.client;
    }

    // 復号化して新しいクライアントを作成
    try {
      const secretKey = decryptStripeKey(developerStripeKeyEnc);
      const client = new StripeClient(secretKey);

      // キャッシュに保存（サイズ制限チェック）
      if (this.cache.size >= this.maxCacheSize) {
        // 最も古いエントリを削除
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) {
          this.cache.delete(oldestKey);
        }
      }

      this.cache.set(cacheKey, { client, createdAt: Date.now() });

      logger.debug('開発者用 Stripe クライアント作成', { developerId });
      return client;
    } catch (error) {
      logger.error('Stripe キーの復号化に失敗、グローバルキーにフォールバック', {
        developerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getGlobalClient();
    }
  }

  /**
   * グローバル Stripe クライアントを取得
   */
  getGlobalClient(): StripeClient {
    const cached = this.cache.get('__global__');
    if (cached) {
      return cached.client;
    }

    const client = new StripeClient(config.stripe.secretKey);
    this.cache.set('__global__', { client, createdAt: Date.now() });
    return client;
  }

  /**
   * 特定の開発者のキャッシュをクリア（キー変更時に使用）
   */
  invalidateCache(developerId: string): void {
    this.cache.delete(developerId);
  }

  /**
   * 全キャッシュをクリア
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// シングルトンインスタンス
export const stripeClientFactory = new StripeClientFactory();
