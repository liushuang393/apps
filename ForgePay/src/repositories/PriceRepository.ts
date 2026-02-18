import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { buildUpdateSets } from '../utils/db';

/**
 * Price entity representing a price in the database
 */
export interface Price {
  id: string;
  productId: string;
  stripePriceId: string;
  amount: number;
  currency: string;
  interval: 'month' | 'year' | null;
  active: boolean;
  createdAt: Date;
}

/**
 * Parameters for creating a new price
 */
export interface CreatePriceParams {
  productId: string;
  stripePriceId: string;
  amount: number;
  currency: string;
  interval?: 'month' | 'year' | null;
  active?: boolean;
}

/**
 * Parameters for updating an existing price
 */
export interface UpdatePriceParams {
  active?: boolean;
}

/**
 * PriceRepository handles all database operations for prices
 * 
 * Responsibilities:
 * - Create, read, update prices
 * - Query prices by product and currency
 * - Map between database rows and Price entities
 * 
 * Requirements: 5.3, 6.1
 */
export class PriceRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Create a new price
   * 
   * @param params - Price creation parameters
   * @param client - Optional database client for transactions
   * @returns The created price
   */
  async create(
    params: CreatePriceParams,
    client?: PoolClient
  ): Promise<Price> {
    const dbClient = client || this.pool;

    const query = `
      INSERT INTO prices (
        product_id,
        stripe_price_id,
        amount,
        currency,
        interval,
        active
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const values = [
      params.productId,
      params.stripePriceId,
      params.amount,
      params.currency.toLowerCase(),
      params.interval || null,
      params.active !== undefined ? params.active : true,
    ];

    try {
      const result = await dbClient.query(query, values);
      const price = this.mapRowToPrice(result.rows[0]);

      logger.info('Price created', {
        priceId: price.id,
        productId: price.productId,
        amount: price.amount,
        currency: price.currency,
      });

      return price;
    } catch (error) {
      logger.error('Error creating price', {
        error,
        params,
      });
      throw error;
    }
  }

  /**
   * Find a price by ID
   * 
   * @param id - Price ID
   * @param client - Optional database client for transactions
   * @returns The price or null if not found
   */
  async findById(id: string, client?: PoolClient): Promise<Price | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM prices
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToPrice(result.rows[0]);
    } catch (error) {
      logger.error('Error finding price by ID', {
        error,
        priceId: id,
      });
      throw error;
    }
  }

  /**
   * Find a price by Stripe price ID
   * 
   * @param stripePriceId - Stripe price ID
   * @param client - Optional database client for transactions
   * @returns The price or null if not found
   */
  async findByStripePriceId(
    stripePriceId: string,
    client?: PoolClient
  ): Promise<Price | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM prices
      WHERE stripe_price_id = $1
    `;

    try {
      const result = await dbClient.query(query, [stripePriceId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToPrice(result.rows[0]);
    } catch (error) {
      logger.error('Error finding price by Stripe price ID', {
        error,
        stripePriceId,
      });
      throw error;
    }
  }

  /**
   * Find all prices for a product
   * 
   * @param productId - Product ID
   * @param activeOnly - If true, only return active prices
   * @param client - Optional database client for transactions
   * @returns Array of prices
   */
  async findByProductId(
    productId: string,
    activeOnly: boolean = false,
    client?: PoolClient
  ): Promise<Price[]> {
    const dbClient = client || this.pool;

    let query = `
      SELECT * FROM prices
      WHERE product_id = $1
    `;

    const values: any[] = [productId];

    if (activeOnly) {
      query += ` AND active = true`;
    }

    query += ` ORDER BY created_at DESC`;

    try {
      const result = await dbClient.query(query, values);
      return result.rows.map((row) => this.mapRowToPrice(row));
    } catch (error) {
      logger.error('Error finding prices by product ID', {
        error,
        productId,
        activeOnly,
      });
      throw error;
    }
  }

  /**
   * Find all active prices for a product
   * 
   * @param productId - Product ID
   * @param client - Optional database client for transactions
   * @returns Array of active prices
   */
  async findActiveByProductId(
    productId: string,
    client?: PoolClient
  ): Promise<Price[]> {
    return this.findByProductId(productId, true, client);
  }

  /**
   * Find prices by product and currency
   * 
   * @param productId - Product ID
   * @param currency - Currency code (e.g., 'usd', 'eur')
   * @param activeOnly - If true, only return active prices
   * @param client - Optional database client for transactions
   * @returns Array of prices
   */
  async findByProductIdAndCurrency(
    productId: string,
    currency: string,
    activeOnly: boolean = false,
    client?: PoolClient
  ): Promise<Price[]> {
    const dbClient = client || this.pool;

    let query = `
      SELECT * FROM prices
      WHERE product_id = $1 AND currency = $2
    `;

    const values: any[] = [productId, currency.toLowerCase()];

    if (activeOnly) {
      query += ` AND active = true`;
    }

    query += ` ORDER BY created_at DESC`;

    try {
      const result = await dbClient.query(query, values);
      return result.rows.map((row) => this.mapRowToPrice(row));
    } catch (error) {
      logger.error('Error finding prices by product ID and currency', {
        error,
        productId,
        currency,
        activeOnly,
      });
      throw error;
    }
  }

  /**
   * Find active prices by product and currency
   * 
   * @param productId - Product ID
   * @param currency - Currency code (e.g., 'usd', 'eur')
   * @param client - Optional database client for transactions
   * @returns Array of active prices
   */
  async findActiveByProductIdAndCurrency(
    productId: string,
    currency: string,
    client?: PoolClient
  ): Promise<Price[]> {
    return this.findByProductIdAndCurrency(productId, currency, true, client);
  }

  /**
   * Find prices by currency across all products
   * 
   * @param currency - Currency code (e.g., 'usd', 'eur')
   * @param activeOnly - If true, only return active prices
   * @param client - Optional database client for transactions
   * @returns Array of prices
   */
  async findByCurrency(
    currency: string,
    activeOnly: boolean = false,
    client?: PoolClient
  ): Promise<Price[]> {
    const dbClient = client || this.pool;

    let query = `
      SELECT * FROM prices
      WHERE currency = $1
    `;

    const values: any[] = [currency.toLowerCase()];

    if (activeOnly) {
      query += ` AND active = true`;
    }

    query += ` ORDER BY created_at DESC`;

    try {
      const result = await dbClient.query(query, values);
      return result.rows.map((row) => this.mapRowToPrice(row));
    } catch (error) {
      logger.error('Error finding prices by currency', {
        error,
        currency,
        activeOnly,
      });
      throw error;
    }
  }

  /**
   * Update a price
   * 
   * @param id - Price ID
   * @param params - Update parameters
   * @param client - Optional database client for transactions
   * @returns The updated price or null if not found
   */
  async update(
    id: string,
    params: UpdatePriceParams,
    client?: PoolClient
  ): Promise<Price | null> {
    const dbClient = client || this.pool;

    const { sets, values, nextIndex } = buildUpdateSets(params as Record<string, unknown>, {
      active: 'active',
    });

    if (sets.length === 0) return this.findById(id, client);

    values.push(id);

    const query = `
      UPDATE prices
      SET ${sets.join(', ')}
      WHERE id = $${nextIndex}
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      const price = this.mapRowToPrice(result.rows[0]);

      logger.info('Price updated', {
        priceId: price.id,
        updates: params,
      });

      return price;
    } catch (error) {
      logger.error('Error updating price', {
        error,
        priceId: id,
        params,
      });
      throw error;
    }
  }

  /**
   * Deactivate a price (soft delete by setting active = false)
   * 
   * @param id - Price ID
   * @param client - Optional database client for transactions
   * @returns The deactivated price or null if not found
   */
  async deactivate(id: string, client?: PoolClient): Promise<Price | null> {
    const dbClient = client || this.pool;

    const query = `
      UPDATE prices
      SET active = false
      WHERE id = $1
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      const price = this.mapRowToPrice(result.rows[0]);

      logger.info('Price deactivated', {
        priceId: price.id,
      });

      return price;
    } catch (error) {
      logger.error('Error deactivating price', {
        error,
        priceId: id,
      });
      throw error;
    }
  }

  /**
   * Delete a price (hard delete - use with caution)
   * 
   * @param id - Price ID
   * @param client - Optional database client for transactions
   * @returns True if deleted, false if not found
   */
  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || this.pool;

    const query = `
      DELETE FROM prices
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info('Price deleted', {
          priceId: id,
        });
      }

      return deleted;
    } catch (error) {
      logger.error('Error deleting price', {
        error,
        priceId: id,
      });
      throw error;
    }
  }

  /**
   * Count prices for a product
   * 
   * @param productId - Product ID
   * @param activeOnly - If true, only count active prices
   * @param client - Optional database client for transactions
   * @returns Count of prices
   */
  async countByProductId(
    productId: string,
    activeOnly: boolean = false,
    client?: PoolClient
  ): Promise<number> {
    const dbClient = client || this.pool;

    let query = `
      SELECT COUNT(*) as count
      FROM prices
      WHERE product_id = $1
    `;

    const values: any[] = [productId];

    if (activeOnly) {
      query += ` AND active = true`;
    }

    try {
      const result = await dbClient.query(query, values);
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error('Error counting prices by product ID', {
        error,
        productId,
        activeOnly,
      });
      throw error;
    }
  }

  /**
   * Map a database row to a Price entity
   * 
   * @param row - Database row
   * @returns Price entity
   */
  private mapRowToPrice(row: any): Price {
    return {
      id: row.id,
      productId: row.product_id,
      stripePriceId: row.stripe_price_id,
      amount: row.amount,
      currency: row.currency,
      interval: row.interval,
      active: row.active,
      createdAt: new Date(row.created_at),
    };
  }
}

// Export singleton instance
export const priceRepository = new PriceRepository();
