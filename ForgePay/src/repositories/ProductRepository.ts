import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { ProductType } from '../types';
import { logger } from '../utils/logger';
import { buildUpdateSets } from '../utils/db';

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
  /** 決済リンクURL用のスラグ */
  slug: string | null;
  /** 利用可能な決済方法 */
  paymentMethods: string[];
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
  slug?: string;
  paymentMethods?: string[];
}

/**
 * Parameters for updating an existing product
 */
export interface UpdateProductParams {
  name?: string;
  description?: string;
  active?: boolean;
  metadata?: Record<string, any>;
  slug?: string;
  paymentMethods?: string[];
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
        metadata,
        slug,
        payment_methods
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      params.slug || null,
      params.paymentMethods ? JSON.stringify(params.paymentMethods) : JSON.stringify(['card']),
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

    // metadata と paymentMethods は JSON 直列化が必要なため個別処理
    const normalizedParams: Record<string, unknown> = {
      ...params,
      metadata: params.metadata !== undefined ? JSON.stringify(params.metadata) : undefined,
      paymentMethods: params.paymentMethods !== undefined ? JSON.stringify(params.paymentMethods) : undefined,
    };

    const { sets, values, nextIndex } = buildUpdateSets(normalizedParams, {
      name: 'name',
      description: 'description',
      active: 'active',
      metadata: 'metadata',
      slug: 'slug',
      paymentMethods: 'payment_methods',
    });

    if (sets.length === 0) return this.findById(id, client);

    sets.push('updated_at = NOW()');
    values.push(id);

    const query = `
      UPDATE products
      SET ${sets.join(', ')}
      WHERE id = $${nextIndex}
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
   * スラグで商品を検索
   * 
   * @param slug - 商品スラグ
   * @param developerId - 開発者ID（オプション）
   * @param client - DBクライアント
   * @returns 商品 or null
   */
  async findBySlug(
    slug: string,
    developerId?: string,
    client?: PoolClient
  ): Promise<Product | null> {
    const dbClient = client || this.pool;

    let query = `SELECT * FROM products WHERE slug = $1`;
    const values: any[] = [slug];

    if (developerId) {
      query += ` AND developer_id = $2`;
      values.push(developerId);
    }

    query += ` AND active = true LIMIT 1`;

    try {
      const result = await dbClient.query(query, values);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToProduct(result.rows[0]);
    } catch (error) {
      logger.error('Error finding product by slug', { error, slug });
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
      slug: row.slug || null,
      paymentMethods: row.payment_methods || ['card'],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// Export singleton instance
export const productRepository = new ProductRepository();
