import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { EntitlementStatus } from '../types';
import { logger } from '../utils/logger';

/**
 * Entitlement entity representing an entitlement in the database
 */
export interface Entitlement {
  id: string;
  customerId: string;
  productId: string;
  purchaseIntentId: string;
  paymentId: string;
  subscriptionId: string | null;
  status: EntitlementStatus;
  expiresAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating a new entitlement
 */
export interface CreateEntitlementParams {
  customerId: string;
  productId: string;
  purchaseIntentId: string;
  paymentId: string;
  subscriptionId?: string;
  status?: EntitlementStatus;
  expiresAt?: Date | null;
}

/**
 * Parameters for updating an existing entitlement
 */
export interface UpdateEntitlementParams {
  status?: EntitlementStatus;
  expiresAt?: Date | null;
  revokedReason?: string;
}

/**
 * EntitlementRepository handles all database operations for entitlements
 * 
 * Responsibilities:
 * - Create, read, update entitlements
 * - Query by purchase_intent_id, customer_id, and status
 * - Implement state transition methods
 * - Map between database rows and Entitlement entities
 * 
 * Requirements: 2.1, 2.2, 2.7
 */
export class EntitlementRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Create a new entitlement
   * 
   * @param params - Entitlement creation parameters
   * @param client - Optional database client for transactions
   * @returns The created entitlement
   */
  async create(
    params: CreateEntitlementParams,
    client?: PoolClient
  ): Promise<Entitlement> {
    const dbClient = client || this.pool;

    const query = `
      INSERT INTO entitlements (
        customer_id,
        product_id,
        purchase_intent_id,
        payment_id,
        subscription_id,
        status,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      params.customerId,
      params.productId,
      params.purchaseIntentId,
      params.paymentId,
      params.subscriptionId || null,
      params.status || 'active',
      params.expiresAt || null,
    ];

    try {
      const result = await dbClient.query(query, values);
      const entitlement = this.mapRowToEntitlement(result.rows[0]);

      logger.info('Entitlement created', {
        entitlementId: entitlement.id,
        customerId: entitlement.customerId,
        productId: entitlement.productId,
        purchaseIntentId: entitlement.purchaseIntentId,
        status: entitlement.status,
      });

      return entitlement;
    } catch (error) {
      logger.error('Error creating entitlement', {
        error,
        params,
      });
      throw error;
    }
  }

  /**
   * Find an entitlement by ID
   * 
   * @param id - Entitlement ID
   * @param client - Optional database client for transactions
   * @returns The entitlement or null if not found
   */
  async findById(id: string, client?: PoolClient): Promise<Entitlement | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM entitlements
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToEntitlement(result.rows[0]);
    } catch (error) {
      logger.error('Error finding entitlement by ID', {
        error,
        entitlementId: id,
      });
      throw error;
    }
  }

  /**
   * Find an entitlement by purchase intent ID
   * 
   * @param purchaseIntentId - Purchase intent ID from OpenAI
   * @param client - Optional database client for transactions
   * @returns The entitlement or null if not found
   */
  async findByPurchaseIntentId(
    purchaseIntentId: string,
    client?: PoolClient
  ): Promise<Entitlement | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM entitlements
      WHERE purchase_intent_id = $1
    `;

    try {
      const result = await dbClient.query(query, [purchaseIntentId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToEntitlement(result.rows[0]);
    } catch (error) {
      logger.error('Error finding entitlement by purchase intent ID', {
        error,
        purchaseIntentId,
      });
      throw error;
    }
  }

  /**
   * Find all entitlements for a customer
   * 
   * @param customerId - Customer ID
   * @param client - Optional database client for transactions
   * @returns Array of entitlements
   */
  async findByCustomerId(
    customerId: string,
    client?: PoolClient
  ): Promise<Entitlement[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM entitlements
      WHERE customer_id = $1
      ORDER BY created_at DESC
    `;

    try {
      const result = await dbClient.query(query, [customerId]);
      return result.rows.map((row) => this.mapRowToEntitlement(row));
    } catch (error) {
      logger.error('Error finding entitlements by customer ID', {
        error,
        customerId,
      });
      throw error;
    }
  }

  /**
   * Find active entitlements for a customer
   * 
   * @param customerId - Customer ID
   * @param client - Optional database client for transactions
   * @returns Array of active entitlements
   */
  async findActiveByCustomerId(
    customerId: string,
    client?: PoolClient
  ): Promise<Entitlement[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM entitlements
      WHERE customer_id = $1 
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
    `;

    try {
      const result = await dbClient.query(query, [customerId]);
      return result.rows.map((row) => this.mapRowToEntitlement(row));
    } catch (error) {
      logger.error('Error finding active entitlements by customer ID', {
        error,
        customerId,
      });
      throw error;
    }
  }

  /**
   * Find entitlements by status
   * 
   * @param status - Entitlement status
   * @param client - Optional database client for transactions
   * @returns Array of entitlements
   */
  async findByStatus(
    status: EntitlementStatus,
    client?: PoolClient
  ): Promise<Entitlement[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM entitlements
      WHERE status = $1
      ORDER BY created_at DESC
    `;

    try {
      const result = await dbClient.query(query, [status]);
      return result.rows.map((row) => this.mapRowToEntitlement(row));
    } catch (error) {
      logger.error('Error finding entitlements by status', {
        error,
        status,
      });
      throw error;
    }
  }

  /**
   * Find entitlement by subscription ID
   * 
   * @param subscriptionId - Stripe subscription ID
   * @param client - Optional database client for transactions
   * @returns The entitlement or null if not found
   */
  async findBySubscriptionId(
    subscriptionId: string,
    client?: PoolClient
  ): Promise<Entitlement | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM entitlements
      WHERE subscription_id = $1
    `;

    try {
      const result = await dbClient.query(query, [subscriptionId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToEntitlement(result.rows[0]);
    } catch (error) {
      logger.error('Error finding entitlement by subscription ID', {
        error,
        subscriptionId,
      });
      throw error;
    }
  }

  /**
   * Find entitlement by payment ID
   * 
   * @param paymentId - Stripe payment ID
   * @param client - Optional database client for transactions
   * @returns The entitlement or null if not found
   */
  async findByPaymentId(
    paymentId: string,
    client?: PoolClient
  ): Promise<Entitlement | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM entitlements
      WHERE payment_id = $1
    `;

    try {
      const result = await dbClient.query(query, [paymentId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToEntitlement(result.rows[0]);
    } catch (error) {
      logger.error('Error finding entitlement by payment ID', {
        error,
        paymentId,
      });
      throw error;
    }
  }

  /**
   * Update an entitlement
   * 
   * @param id - Entitlement ID
   * @param params - Update parameters
   * @param client - Optional database client for transactions
   * @returns The updated entitlement or null if not found
   */
  async update(
    id: string,
    params: UpdateEntitlementParams,
    client?: PoolClient
  ): Promise<Entitlement | null> {
    const dbClient = client || this.pool;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }

    if (params.expiresAt !== undefined) {
      updates.push(`expires_at = $${paramIndex++}`);
      values.push(params.expiresAt);
    }

    if (params.revokedReason !== undefined) {
      updates.push(`revoked_reason = $${paramIndex++}`);
      values.push(params.revokedReason);
    }

    // Always update updated_at
    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // Only updated_at would be updated, nothing to do
      return this.findById(id, client);
    }

    values.push(id);

    const query = `
      UPDATE entitlements
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      const entitlement = this.mapRowToEntitlement(result.rows[0]);

      logger.info('Entitlement updated', {
        entitlementId: entitlement.id,
        updates: params,
      });

      return entitlement;
    } catch (error) {
      logger.error('Error updating entitlement', {
        error,
        entitlementId: id,
        params,
      });
      throw error;
    }
  }

  /**
   * Suspend an entitlement
   * 
   * @param id - Entitlement ID
   * @param reason - Suspension reason
   * @param client - Optional database client for transactions
   * @returns The updated entitlement or null if not found
   */
  async suspend(
    id: string,
    reason: string,
    client?: PoolClient
  ): Promise<Entitlement | null> {
    return this.update(id, { status: 'suspended', revokedReason: reason }, client);
  }

  /**
   * Revoke an entitlement
   * 
   * @param id - Entitlement ID
   * @param reason - Revocation reason
   * @param client - Optional database client for transactions
   * @returns The updated entitlement or null if not found
   */
  async revoke(
    id: string,
    reason: string,
    client?: PoolClient
  ): Promise<Entitlement | null> {
    return this.update(id, { status: 'revoked', revokedReason: reason }, client);
  }

  /**
   * Reactivate an entitlement
   * 
   * @param id - Entitlement ID
   * @param client - Optional database client for transactions
   * @returns The updated entitlement or null if not found
   */
  async reactivate(
    id: string,
    client?: PoolClient
  ): Promise<Entitlement | null> {
    return this.update(id, { status: 'active', revokedReason: undefined }, client);
  }

  /**
   * Extend entitlement expiration (for subscription renewals)
   * 
   * @param id - Entitlement ID
   * @param newExpiresAt - New expiration date
   * @param client - Optional database client for transactions
   * @returns The updated entitlement or null if not found
   */
  async extendExpiration(
    id: string,
    newExpiresAt: Date,
    client?: PoolClient
  ): Promise<Entitlement | null> {
    return this.update(id, { expiresAt: newExpiresAt }, client);
  }

  /**
   * Delete an entitlement (hard delete - use with caution)
   * 
   * @param id - Entitlement ID
   * @param client - Optional database client for transactions
   * @returns True if deleted, false if not found
   */
  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || this.pool;

    const query = `
      DELETE FROM entitlements
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info('Entitlement deleted', {
          entitlementId: id,
        });
      }

      return deleted;
    } catch (error) {
      logger.error('Error deleting entitlement', {
        error,
        entitlementId: id,
      });
      throw error;
    }
  }

  /**
   * Find expired entitlements that need to be marked as expired
   * 
   * @param client - Optional database client for transactions
   * @returns Array of expired entitlements
   */
  async findExpiredEntitlements(client?: PoolClient): Promise<Entitlement[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM entitlements
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
    `;

    try {
      const result = await dbClient.query(query);
      return result.rows.map((row) => this.mapRowToEntitlement(row));
    } catch (error) {
      logger.error('Error finding expired entitlements', { error });
      throw error;
    }
  }

  /**
   * Map a database row to an Entitlement entity
   * 
   * @param row - Database row
   * @returns Entitlement entity
   */
  private mapRowToEntitlement(row: any): Entitlement {
    return {
      id: row.id,
      customerId: row.customer_id,
      productId: row.product_id,
      purchaseIntentId: row.purchase_intent_id,
      paymentId: row.payment_id,
      subscriptionId: row.subscription_id,
      status: row.status as EntitlementStatus,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      revokedReason: row.revoked_reason,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// Export singleton instance
export const entitlementRepository = new EntitlementRepository();
