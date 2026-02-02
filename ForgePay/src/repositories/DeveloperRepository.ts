import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

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
   * Update a developer
   */
  async update(
    id: string,
    params: UpdateDeveloperParams,
    client?: PoolClient
  ): Promise<Developer | null> {
    const dbClient = client || this.pool;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(params.email);
    }
    if (params.stripeAccountId !== undefined) {
      updates.push(`stripe_account_id = $${paramIndex++}`);
      values.push(params.stripeAccountId);
    }
    if (params.webhookSecret !== undefined) {
      updates.push(`webhook_secret = $${paramIndex++}`);
      values.push(params.webhookSecret);
    }
    if (params.testMode !== undefined) {
      updates.push(`test_mode = $${paramIndex++}`);
      values.push(params.testMode);
    }
    if (params.apiKeyHash !== undefined) {
      updates.push(`api_key_hash = $${paramIndex++}`);
      values.push(params.apiKeyHash);
    }

    if (updates.length === 0) {
      return this.findById(id, client);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE developers
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
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
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

// Export singleton instance
export const developerRepository = new DeveloperRepository();
