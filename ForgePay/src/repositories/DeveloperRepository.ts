import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { buildUpdateSets } from '../utils/db';

/**
 * Developer entity
 */
export interface Developer {
  id: string;
  email: string;
  stripeAccountId: string | null;
  apiKeyHash: string;
  webhookSecret: string | null;
  testMode: boolean;
  /** 決済成功時のデフォルトリダイレクトURL */
  defaultSuccessUrl: string | null;
  /** 決済キャンセル時のデフォルトリダイレクトURL */
  defaultCancelUrl: string | null;
  /** デフォルトロケール */
  defaultLocale: string;
  /** デフォルト通貨 */
  defaultCurrency: string;
  /** デフォルト決済方法 */
  defaultPaymentMethods: string[];
  /** コールバックURL */
  callbackUrl: string | null;
  /** コールバック署名用シークレット */
  callbackSecret: string | null;
  /** 会社名/サービス名 */
  companyName: string | null;
  /** 暗号化された Stripe Secret Key */
  stripeSecretKeyEnc: string | null;
  /** Stripe Publishable Key */
  stripePublishableKey: string | null;
  /** Stripe Webhook Endpoint Secret */
  stripeWebhookEndpointSecret: string | null;
  /** Stripe 設定済みフラグ */
  stripeConfigured: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating a developer
 */
export interface CreateDeveloperParams {
  email: string;
  apiKeyHash: string;
  stripeAccountId?: string;
  webhookSecret?: string;
  testMode?: boolean;
}

/**
 * Parameters for updating a developer
 */
export interface UpdateDeveloperParams {
  email?: string;
  stripeAccountId?: string;
  webhookSecret?: string;
  testMode?: boolean;
  apiKeyHash?: string;
  defaultSuccessUrl?: string | null;
  defaultCancelUrl?: string | null;
  defaultLocale?: string;
  defaultCurrency?: string;
  defaultPaymentMethods?: string[];
  callbackUrl?: string | null;
  callbackSecret?: string | null;
  companyName?: string | null;
  stripeSecretKeyEnc?: string | null;
  stripePublishableKey?: string | null;
  stripeWebhookEndpointSecret?: string | null;
  stripeConfigured?: boolean;
}

/**
 * DeveloperRepository handles all database operations for developers
 * 
 * Requirements: 15.1, 15.2
 */
export class DeveloperRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Create a new developer
   */
  async create(
    params: CreateDeveloperParams,
    client?: PoolClient
  ): Promise<Developer> {
    const dbClient = client || this.pool;

    const query = `
      INSERT INTO developers (
        email, api_key_hash, stripe_account_id, webhook_secret, test_mode
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const values = [
      params.email,
      params.apiKeyHash,
      params.stripeAccountId || null,
      params.webhookSecret || null,
      params.testMode !== undefined ? params.testMode : true,
    ];

    try {
      const result = await dbClient.query(query, values);
      const developer = this.mapRowToDeveloper(result.rows[0]);

      logger.info('Developer created', {
        developerId: developer.id,
        email: '***',
      });

      return developer;
    } catch (error) {
      logger.error('Error creating developer', { error });
      throw error;
    }
  }

  /**
   * Find developer by ID
   */
  async findById(id: string, client?: PoolClient): Promise<Developer | null> {
    const dbClient = client || this.pool;

    const query = `SELECT * FROM developers WHERE id = $1`;

    try {
      const result = await dbClient.query(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToDeveloper(result.rows[0]);
    } catch (error) {
      logger.error('Error finding developer', { error, id });
      throw error;
    }
  }

  /**
   * Find developer by email
   */
  async findByEmail(email: string, client?: PoolClient): Promise<Developer | null> {
    const dbClient = client || this.pool;

    const query = `SELECT * FROM developers WHERE email = $1`;

    try {
      const result = await dbClient.query(query, [email]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToDeveloper(result.rows[0]);
    } catch (error) {
      logger.error('Error finding developer by email', { error });
      throw error;
    }
  }

  /**
   * Find developer by Stripe account ID
   */
  async findByStripeAccountId(
    stripeAccountId: string,
    client?: PoolClient
  ): Promise<Developer | null> {
    const dbClient = client || this.pool;

    const query = `SELECT * FROM developers WHERE stripe_account_id = $1`;

    try {
      const result = await dbClient.query(query, [stripeAccountId]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToDeveloper(result.rows[0]);
    } catch (error) {
      logger.error('Error finding developer by Stripe account', { error });
      throw error;
    }
  }

  /**
   * Find developer by API key hash
   */
  async findByApiKeyHash(
    apiKeyHash: string,
    client?: PoolClient
  ): Promise<Developer | null> {
    const dbClient = client || this.pool;

    const query = `SELECT * FROM developers WHERE api_key_hash = $1`;

    try {
      const result = await dbClient.query(query, [apiKeyHash]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToDeveloper(result.rows[0]);
    } catch (error) {
      logger.error('Error finding developer by API key', { error });
      throw error;
    }
  }

  /**
   * 開発者情報を更新する
   */
  async update(
    id: string,
    params: UpdateDeveloperParams,
    client?: PoolClient
  ): Promise<Developer | null> {
    const dbClient = client || this.pool;

    const normalizedParams: Record<string, unknown> = {
      ...params,
      defaultPaymentMethods: params.defaultPaymentMethods !== undefined
        ? JSON.stringify(params.defaultPaymentMethods)
        : undefined,
    };

    const { sets, values, nextIndex } = buildUpdateSets(normalizedParams, {
      email: 'email',
      stripeAccountId: 'stripe_account_id',
      webhookSecret: 'webhook_secret',
      testMode: 'test_mode',
      apiKeyHash: 'api_key_hash',
      defaultSuccessUrl: 'default_success_url',
      defaultCancelUrl: 'default_cancel_url',
      defaultLocale: 'default_locale',
      defaultCurrency: 'default_currency',
      defaultPaymentMethods: 'default_payment_methods',
      callbackUrl: 'callback_url',
      callbackSecret: 'callback_secret',
      companyName: 'company_name',
      stripeSecretKeyEnc: 'stripe_secret_key_enc',
      stripePublishableKey: 'stripe_publishable_key',
      stripeWebhookEndpointSecret: 'stripe_webhook_endpoint_secret',
      stripeConfigured: 'stripe_configured',
    });

    if (sets.length === 0) return this.findById(id, client);

    sets.push('updated_at = NOW()');
    values.push(id);

    const query = `
      UPDATE developers
      SET ${sets.join(', ')}
      WHERE id = $${nextIndex}
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, values);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToDeveloper(result.rows[0]);
    } catch (error) {
      logger.error('Error updating developer', { error, id });
      throw error;
    }
  }

  /**
   * Delete a developer
   */
  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || this.pool;

    const query = `DELETE FROM developers WHERE id = $1`;

    try {
      const result = await dbClient.query(query, [id]);
      const deleted = result.rowCount !== null && result.rowCount > 0;
      
      if (deleted) {
        logger.info('Developer deleted', { developerId: id });
      }
      
      return deleted;
    } catch (error) {
      logger.error('Error deleting developer', { error, id });
      throw error;
    }
  }

  /**
   * List all developers (with pagination)
   */
  async list(
    options?: { limit?: number; offset?: number; testMode?: boolean },
    client?: PoolClient
  ): Promise<{ developers: Developer[]; total: number }> {
    const dbClient = client || this.pool;
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    let query = `SELECT * FROM developers`;
    let countQuery = `SELECT COUNT(*) as total FROM developers`;
    const values: unknown[] = [];
    let paramIndex = 1;

    if (options?.testMode !== undefined) {
      query += ` WHERE test_mode = $${paramIndex}`;
      countQuery += ` WHERE test_mode = $${paramIndex}`;
      values.push(options.testMode);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    values.push(limit, offset);

    try {
      const [result, countResult] = await Promise.all([
        dbClient.query(query, values),
        dbClient.query(countQuery, values.slice(0, -2)), // Exclude limit/offset
      ]);

      return {
        developers: result.rows.map((row) => this.mapRowToDeveloper(row)),
        total: parseInt(countResult.rows[0].total, 10),
      };
    } catch (error) {
      logger.error('Error listing developers', { error });
      throw error;
    }
  }

  /**
   * Map database row to Developer entity
   */
  private mapRowToDeveloper(row: Record<string, unknown>): Developer {
    return {
      id: row.id as string,
      email: row.email as string,
      stripeAccountId: row.stripe_account_id as string | null,
      apiKeyHash: row.api_key_hash as string,
      webhookSecret: row.webhook_secret as string | null,
      testMode: row.test_mode as boolean,
      defaultSuccessUrl: (row.default_success_url as string) || null,
      defaultCancelUrl: (row.default_cancel_url as string) || null,
      defaultLocale: (row.default_locale as string) || 'auto',
      defaultCurrency: (row.default_currency as string) || 'usd',
      defaultPaymentMethods: (row.default_payment_methods as string[]) || ['card'],
      callbackUrl: (row.callback_url as string) || null,
      callbackSecret: (row.callback_secret as string) || null,
      companyName: (row.company_name as string) || null,
      stripeSecretKeyEnc: (row.stripe_secret_key_enc as string) || null,
      stripePublishableKey: (row.stripe_publishable_key as string) || null,
      stripeWebhookEndpointSecret: (row.stripe_webhook_endpoint_secret as string) || null,
      stripeConfigured: (row.stripe_configured as boolean) || false,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

// Export singleton instance
export const developerRepository = new DeveloperRepository();
