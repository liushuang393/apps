import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { ProductType } from '../types';
import { logger } from '../utils/logger';

/**
 * Product entity representing a product in the database
 */
export interface Product {
  id: string;
  developerId: string;
  stripeProductId: string;
  name: string;
  description: string | null;
  type: ProductType;
  active: boolean;
  metadata: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating a new product
 */
export interface CreateProductParams {
  developerId: string;
  stripeProductId: string;
  name: string;
  description?: string;
  type: ProductType;
  active?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Parameters for updating an existing product
 */
export interface UpdateProductParams {
  name?: string;
  description?: string;
  active?: boolean;
  metadata?: Record<string, any>;
}

/**
 * ProductRepository handles all database operations for products
 * 
 * Responsibilities:
 * - Create, read, update, archive products
 * - Query active products by developer
 * - Map between database rows and Product entities
 * 
 * Requirements: 5.2
 */
export class ProductRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Create a new product
   * 
   * @param params - Product creation parameters
   * @param client - Optional database client for transactions
   * @returns The created product
   */
  async create(
    params: CreateProductParams,
    client?: PoolClient
  ): Promise<Product> {
    const dbClient = client || this.pool;

    const query = `
      INSERT INTO products (
        developer_id,
        stripe_product_id,
        name,
        description,
        type,
        active,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      params.developerId,
      params.stripeProductId,
      params.name,
      params.description || null,
      params.type,
      params.active !== undefined ? params.active : true,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ];

    try {
      const result = await dbClient.query(query, values);
      const product = this.mapRowToProduct(result.rows[0]);

      logger.info('Product created', {
        productId: product.id,
        developerId: product.developerId,
        name: product.name,
      });

      return product;
    } catch (error) {
      logger.error('Error creating product', {
        error,
        params,
      });
      throw error;
    }
  }

  /**
   * Find a product by ID
   * 
   * @param id - Product ID
   * @param client - Optional database client for transactions
   * @returns The product or null if not found
   */
  async findById(id: string, client?: PoolClient): Promise<Product | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM products
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToProduct(result.rows[0]);
    } catch (error) {
      logger.error('Error finding product by ID', {
        error,
        productId: id,
      });
      throw error;
    }
  }

  /**
   * Find a product by Stripe product ID
   * 
   * @param stripeProductId - Stripe product ID
   * @param client - Optional database client for transactions
   * @returns The product or null if not found
   */
  async findByStripeProductId(
    stripeProductId: string,
    client?: PoolClient
  ): Promise<Product | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM products
      WHERE stripe_product_id = $1
    `;

    try {
      const result = await dbClient.query(query, [stripeProductId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToProduct(result.rows[0]);
    } catch (error) {
      logger.error('Error finding product by Stripe product ID', {
        error,
        stripeProductId,
      });
      throw error;
    }
  }

  /**
   * Find all products for a developer
   * 
   * @param developerId - Developer ID
   * @param activeOnly - If true, only return active products
   * @param client - Optional database client for transactions
   * @returns Array of products
   */
  async findByDeveloperId(
    developerId: string,
    activeOnly: boolean = false,
    client?: PoolClient
  ): Promise<Product[]> {
    const dbClient = client || this.pool;

    let query = `
      SELECT * FROM products
      WHERE developer_id = $1
    `;

    const values: any[] = [developerId];

    if (activeOnly) {
      query += ` AND active = true`;
    }

    query += ` ORDER BY created_at DESC`;

    try {
      const result = await dbClient.query(query, values);
      return result.rows.map((row) => this.mapRowToProduct(row));
    } catch (error) {
      logger.error('Error finding products by developer ID', {
        error,
        developerId,
        activeOnly,
      });
      throw error;
    }
  }

  /**
   * Find all active products for a developer
   * 
   * @param developerId - Developer ID
   * @param client - Optional database client for transactions
   * @returns Array of active products
   */
  async findActiveByDeveloperId(
    developerId: string,
    client?: PoolClient
  ): Promise<Product[]> {
    return this.findByDeveloperId(developerId, true, client);
  }

  /**
   * Update a product
   * 
   * @param id - Product ID
   * @param params - Update parameters
   * @param client - Optional database client for transactions
   * @returns The updated product or null if not found
   */
  async update(
    id: string,
    params: UpdateProductParams,
    client?: PoolClient
  ): Promise<Product | null> {
    const dbClient = client || this.pool;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(params.name);
    }

    if (params.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(params.description);
    }

    if (params.active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(params.active);
    }

    if (params.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(params.metadata));
    }

    // Always update updated_at
    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // Only updated_at would be updated, nothing to do
      return this.findById(id, client);
    }

    values.push(id);

    const query = `
      UPDATE products
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      const product = this.mapRowToProduct(result.rows[0]);

      logger.info('Product updated', {
        productId: product.id,
        updates: params,
      });

      return product;
    } catch (error) {
      logger.error('Error updating product', {
        error,
        productId: id,
        params,
      });
      throw error;
    }
  }

  /**
   * Archive a product (soft delete by setting active = false)
   * 
   * @param id - Product ID
   * @param client - Optional database client for transactions
   * @returns The archived product or null if not found
   */
  async archive(id: string, client?: PoolClient): Promise<Product | null> {
    const dbClient = client || this.pool;

    const query = `
      UPDATE products
      SET active = false, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      const product = this.mapRowToProduct(result.rows[0]);

      logger.info('Product archived', {
        productId: product.id,
      });

      return product;
    } catch (error) {
      logger.error('Error archiving product', {
        error,
        productId: id,
      });
      throw error;
    }
  }

  /**
   * Delete a product (hard delete - use with caution)
   * 
   * @param id - Product ID
   * @param client - Optional database client for transactions
   * @returns True if deleted, false if not found
   */
  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || this.pool;

    const query = `
      DELETE FROM products
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info('Product deleted', {
          productId: id,
        });
      }

      return deleted;
    } catch (error) {
      logger.error('Error deleting product', {
        error,
        productId: id,
      });
      throw error;
    }
  }

  /**
   * Count products for a developer
   * 
   * @param developerId - Developer ID
   * @param activeOnly - If true, only count active products
   * @param client - Optional database client for transactions
   * @returns Count of products
   */
  async countByDeveloperId(
    developerId: string,
    activeOnly: boolean = false,
    client?: PoolClient
  ): Promise<number> {
    const dbClient = client || this.pool;

    let query = `
      SELECT COUNT(*) as count
      FROM products
      WHERE developer_id = $1
    `;

    const values: any[] = [developerId];

    if (activeOnly) {
      query += ` AND active = true`;
    }

    try {
      const result = await dbClient.query(query, values);
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error('Error counting products by developer ID', {
        error,
        developerId,
        activeOnly,
      });
      throw error;
    }
  }

  /**
   * Map a database row to a Product entity
   * 
   * @param row - Database row
   * @returns Product entity
   */
  private mapRowToProduct(row: any): Product {
    return {
      id: row.id,
      developerId: row.developer_id,
      stripeProductId: row.stripe_product_id,
      name: row.name,
      description: row.description,
      type: row.type as ProductType,
      active: row.active,
      metadata: row.metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// Export singleton instance
export const productRepository = new ProductRepository();
