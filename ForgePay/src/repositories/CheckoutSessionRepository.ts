import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { CheckoutSessionStatus } from '../types';
import { logger } from '../utils/logger';

/**
 * CheckoutSession entity representing a checkout session in the database
 */
export interface CheckoutSession {
  id: string;
  developerId: string;
  stripeSessionId: string;
  purchaseIntentId: string;
  productId: string;
  priceId: string;
  customerId: string | null;
  status: CheckoutSessionStatus;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Parameters for creating a new checkout session
 */
export interface CreateCheckoutSessionParams {
  developerId: string;
  stripeSessionId: string;
  purchaseIntentId: string;
  productId: string;
  priceId: string;
  customerId?: string;
  status?: CheckoutSessionStatus;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

/**
 * Parameters for updating an existing checkout session
 */
export interface UpdateCheckoutSessionParams {
  customerId?: string;
  status?: CheckoutSessionStatus;
}

/**
 * CheckoutSessionRepository handles all database operations for checkout sessions
 * 
 * Responsibilities:
 * - Create, read, update checkout sessions
 * - Query by session ID, purchase intent ID
 * - Track session status
 * - Map between database rows and CheckoutSession entities
 * 
 * Requirements: 1.1, 4.2
 */
export class CheckoutSessionRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Create a new checkout session
   * 
   * @param params - CheckoutSession creation parameters
   * @param client - Optional database client for transactions
   * @returns The created checkout session
   */
  async create(
    params: CreateCheckoutSessionParams,
    client?: PoolClient
  ): Promise<CheckoutSession> {
    const dbClient = client || this.pool;

    const query = `
      INSERT INTO checkout_sessions (
        developer_id,
        stripe_session_id,
        purchase_intent_id,
        product_id,
        price_id,
        customer_id,
        status,
        success_url,
        cancel_url,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      params.developerId,
      params.stripeSessionId,
      params.purchaseIntentId,
      params.productId,
      params.priceId,
      params.customerId || null,
      params.status || 'open',
      params.successUrl,
      params.cancelUrl,
      params.expiresAt,
    ];

    try {
      const result = await dbClient.query(query, values);
      const checkoutSession = this.mapRowToCheckoutSession(result.rows[0]);

      logger.info('Checkout session created', {
        checkoutSessionId: checkoutSession.id,
        stripeSessionId: checkoutSession.stripeSessionId,
        purchaseIntentId: checkoutSession.purchaseIntentId,
      });

      return checkoutSession;
    } catch (error) {
      logger.error('Error creating checkout session', {
        error,
        params,
      });
      throw error;
    }
  }

  /**
   * Find a checkout session by ID
   * 
   * @param id - CheckoutSession ID
   * @param client - Optional database client for transactions
   * @returns The checkout session or null if not found
   */
  async findById(id: string, client?: PoolClient): Promise<CheckoutSession | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM checkout_sessions
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToCheckoutSession(result.rows[0]);
    } catch (error) {
      logger.error('Error finding checkout session by ID', {
        error,
        checkoutSessionId: id,
      });
      throw error;
    }
  }

  /**
   * Find a checkout session by Stripe session ID
   * 
   * @param stripeSessionId - Stripe session ID
   * @param client - Optional database client for transactions
   * @returns The checkout session or null if not found
   */
  async findByStripeSessionId(
    stripeSessionId: string,
    client?: PoolClient
  ): Promise<CheckoutSession | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM checkout_sessions
      WHERE stripe_session_id = $1
    `;

    try {
      const result = await dbClient.query(query, [stripeSessionId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToCheckoutSession(result.rows[0]);
    } catch (error) {
      logger.error('Error finding checkout session by Stripe session ID', {
        error,
        stripeSessionId,
      });
      throw error;
    }
  }

  /**
   * Find a checkout session by purchase intent ID
   * 
   * @param purchaseIntentId - OpenAI purchase intent ID
   * @param client - Optional database client for transactions
   * @returns The checkout session or null if not found
   */
  async findByPurchaseIntentId(
    purchaseIntentId: string,
    client?: PoolClient
  ): Promise<CheckoutSession | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM checkout_sessions
      WHERE purchase_intent_id = $1
    `;

    try {
      const result = await dbClient.query(query, [purchaseIntentId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToCheckoutSession(result.rows[0]);
    } catch (error) {
      logger.error('Error finding checkout session by purchase intent ID', {
        error,
        purchaseIntentId,
      });
      throw error;
    }
  }

  /**
   * Find checkout sessions by developer
   * 
   * @param developerId - Developer ID
   * @param status - Optional status filter
   * @param limit - Maximum number of results
   * @param client - Optional database client for transactions
   * @returns Array of checkout sessions
   */
  async findByDeveloperId(
    developerId: string,
    status?: CheckoutSessionStatus,
    limit: number = 100,
    client?: PoolClient
  ): Promise<CheckoutSession[]> {
    const dbClient = client || this.pool;

    let query = `
      SELECT * FROM checkout_sessions
      WHERE developer_id = $1
    `;

    const values: any[] = [developerId];

    if (status) {
      query += ` AND status = $2`;
      values.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${values.length + 1}`;
    values.push(limit);

    try {
      const result = await dbClient.query(query, values);
      return result.rows.map((row) => this.mapRowToCheckoutSession(row));
    } catch (error) {
      logger.error('Error finding checkout sessions by developer ID', {
        error,
        developerId,
      });
      throw error;
    }
  }

  /**
   * Update a checkout session
   * 
   * @param id - CheckoutSession ID
   * @param params - Update parameters
   * @param client - Optional database client for transactions
   * @returns The updated checkout session or null if not found
   */
  async update(
    id: string,
    params: UpdateCheckoutSessionParams,
    client?: PoolClient
  ): Promise<CheckoutSession | null> {
    const dbClient = client || this.pool;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.customerId !== undefined) {
      updates.push(`customer_id = $${paramIndex++}`);
      values.push(params.customerId);
    }

    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }

    if (updates.length === 0) {
      return this.findById(id, client);
    }

    values.push(id);

    const query = `
      UPDATE checkout_sessions
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      const checkoutSession = this.mapRowToCheckoutSession(result.rows[0]);

      logger.info('Checkout session updated', {
        checkoutSessionId: checkoutSession.id,
        updates: params,
      });

      return checkoutSession;
    } catch (error) {
      logger.error('Error updating checkout session', {
        error,
        checkoutSessionId: id,
        params,
      });
      throw error;
    }
  }

  /**
   * Mark a checkout session as complete
   * 
   * @param id - CheckoutSession ID
   * @param customerId - Customer ID (optional)
   * @param client - Optional database client for transactions
   * @returns The updated checkout session or null if not found
   */
  async markComplete(
    id: string,
    customerId?: string,
    client?: PoolClient
  ): Promise<CheckoutSession | null> {
    return this.update(id, { status: 'complete', customerId }, client);
  }

  /**
   * Mark a checkout session as expired
   * 
   * @param id - CheckoutSession ID
   * @param client - Optional database client for transactions
   * @returns The updated checkout session or null if not found
   */
  async markExpired(
    id: string,
    client?: PoolClient
  ): Promise<CheckoutSession | null> {
    return this.update(id, { status: 'expired' }, client);
  }

  /**
   * Find expired checkout sessions that need to be marked as expired
   * 
   * @param client - Optional database client for transactions
   * @returns Array of expired checkout sessions
   */
  async findExpiredSessions(client?: PoolClient): Promise<CheckoutSession[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM checkout_sessions
      WHERE status = 'open'
        AND expires_at < NOW()
    `;

    try {
      const result = await dbClient.query(query);
      return result.rows.map((row) => this.mapRowToCheckoutSession(row));
    } catch (error) {
      logger.error('Error finding expired checkout sessions', { error });
      throw error;
    }
  }

  /**
   * Delete a checkout session (hard delete - use with caution)
   * 
   * @param id - CheckoutSession ID
   * @param client - Optional database client for transactions
   * @returns True if deleted, false if not found
   */
  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || this.pool;

    const query = `
      DELETE FROM checkout_sessions
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info('Checkout session deleted', {
          checkoutSessionId: id,
        });
      }

      return deleted;
    } catch (error) {
      logger.error('Error deleting checkout session', {
        error,
        checkoutSessionId: id,
      });
      throw error;
    }
  }

  /**
   * Map a database row to a CheckoutSession entity
   * 
   * @param row - Database row
   * @returns CheckoutSession entity
   */
  private mapRowToCheckoutSession(row: any): CheckoutSession {
    return {
      id: row.id,
      developerId: row.developer_id,
      stripeSessionId: row.stripe_session_id,
      purchaseIntentId: row.purchase_intent_id,
      productId: row.product_id,
      priceId: row.price_id,
      customerId: row.customer_id,
      status: row.status as CheckoutSessionStatus,
      successUrl: row.success_url,
      cancelUrl: row.cancel_url,
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
    };
  }
}

// Export singleton instance
export const checkoutSessionRepository = new CheckoutSessionRepository();
