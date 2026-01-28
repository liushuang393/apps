import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Customer entity representing a customer in the database
 */
export interface Customer {
  id: string;
  developerId: string;
  stripeCustomerId: string;
  email: string;
  name: string | null;
  metadata: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating a new customer
 */
export interface CreateCustomerParams {
  developerId: string;
  stripeCustomerId: string;
  email: string;
  name?: string;
  metadata?: Record<string, any>;
}

/**
 * Parameters for updating an existing customer
 */
export interface UpdateCustomerParams {
  email?: string;
  name?: string;
  metadata?: Record<string, any>;
}

/**
 * CustomerRepository handles all database operations for customers
 * 
 * Responsibilities:
 * - Create, read, update customers
 * - Query by email and Stripe customer ID
 * - Map between database rows and Customer entities
 * 
 * Requirements: 2.1
 */
export class CustomerRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Create a new customer
   * 
   * @param params - Customer creation parameters
   * @param client - Optional database client for transactions
   * @returns The created customer
   */
  async create(
    params: CreateCustomerParams,
    client?: PoolClient
  ): Promise<Customer> {
    const dbClient = client || this.pool;

    const query = `
      INSERT INTO customers (
        developer_id,
        stripe_customer_id,
        email,
        name,
        metadata
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const values = [
      params.developerId,
      params.stripeCustomerId,
      params.email,
      params.name || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ];

    try {
      const result = await dbClient.query(query, values);
      const customer = this.mapRowToCustomer(result.rows[0]);

      logger.info('Customer created', {
        customerId: customer.id,
        developerId: customer.developerId,
        email: customer.email,
      });

      return customer;
    } catch (error) {
      logger.error('Error creating customer', {
        error,
        params: { ...params, email: '***' }, // Redact email for privacy
      });
      throw error;
    }
  }

  /**
   * Find a customer by ID
   * 
   * @param id - Customer ID
   * @param client - Optional database client for transactions
   * @returns The customer or null if not found
   */
  async findById(id: string, client?: PoolClient): Promise<Customer | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM customers
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToCustomer(result.rows[0]);
    } catch (error) {
      logger.error('Error finding customer by ID', {
        error,
        customerId: id,
      });
      throw error;
    }
  }

  /**
   * Find a customer by Stripe customer ID
   * 
   * @param stripeCustomerId - Stripe customer ID
   * @param client - Optional database client for transactions
   * @returns The customer or null if not found
   */
  async findByStripeCustomerId(
    stripeCustomerId: string,
    client?: PoolClient
  ): Promise<Customer | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM customers
      WHERE stripe_customer_id = $1
    `;

    try {
      const result = await dbClient.query(query, [stripeCustomerId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToCustomer(result.rows[0]);
    } catch (error) {
      logger.error('Error finding customer by Stripe customer ID', {
        error,
        stripeCustomerId,
      });
      throw error;
    }
  }

  /**
   * Find a customer by email within a developer's scope
   * 
   * @param developerId - Developer ID
   * @param email - Customer email
   * @param client - Optional database client for transactions
   * @returns The customer or null if not found
   */
  async findByDeveloperIdAndEmail(
    developerId: string,
    email: string,
    client?: PoolClient
  ): Promise<Customer | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM customers
      WHERE developer_id = $1 AND email = $2
    `;

    try {
      const result = await dbClient.query(query, [developerId, email]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToCustomer(result.rows[0]);
    } catch (error) {
      logger.error('Error finding customer by developer ID and email', {
        error,
        developerId,
      });
      throw error;
    }
  }

  /**
   * Find a customer by email (any developer)
   * Used for customer portal access
   * 
   * @param email - Customer email
   * @param client - Optional database client for transactions
   * @returns The customer or null if not found
   */
  async findByEmail(
    email: string,
    client?: PoolClient
  ): Promise<Customer | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM customers
      WHERE email = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    try {
      const result = await dbClient.query(query, [email]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToCustomer(result.rows[0]);
    } catch (error) {
      logger.error('Error finding customer by email', {
        error,
      });
      throw error;
    }
  }

  /**
   * Find all customers for a developer
   * 
   * @param developerId - Developer ID
   * @param client - Optional database client for transactions
   * @returns Array of customers
   */
  async findByDeveloperId(
    developerId: string,
    client?: PoolClient
  ): Promise<Customer[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM customers
      WHERE developer_id = $1
      ORDER BY created_at DESC
    `;

    try {
      const result = await dbClient.query(query, [developerId]);
      return result.rows.map((row) => this.mapRowToCustomer(row));
    } catch (error) {
      logger.error('Error finding customers by developer ID', {
        error,
        developerId,
      });
      throw error;
    }
  }

  /**
   * Find or create a customer by email within a developer's scope
   * 
   * @param params - Customer creation parameters
   * @param client - Optional database client for transactions
   * @returns The existing or newly created customer
   */
  async findOrCreate(
    params: CreateCustomerParams,
    client?: PoolClient
  ): Promise<{ customer: Customer; created: boolean }> {
    const existing = await this.findByDeveloperIdAndEmail(
      params.developerId,
      params.email,
      client
    );

    if (existing) {
      return { customer: existing, created: false };
    }

    const customer = await this.create(params, client);
    return { customer, created: true };
  }

  /**
   * Update a customer
   * 
   * @param id - Customer ID
   * @param params - Update parameters
   * @param client - Optional database client for transactions
   * @returns The updated customer or null if not found
   */
  async update(
    id: string,
    params: UpdateCustomerParams,
    client?: PoolClient
  ): Promise<Customer | null> {
    const dbClient = client || this.pool;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(params.email);
    }

    if (params.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(params.name);
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
      UPDATE customers
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      const customer = this.mapRowToCustomer(result.rows[0]);

      logger.info('Customer updated', {
        customerId: customer.id,
      });

      return customer;
    } catch (error) {
      logger.error('Error updating customer', {
        error,
        customerId: id,
      });
      throw error;
    }
  }

  /**
   * Delete a customer (hard delete - use with caution)
   * 
   * @param id - Customer ID
   * @param client - Optional database client for transactions
   * @returns True if deleted, false if not found
   */
  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || this.pool;

    const query = `
      DELETE FROM customers
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info('Customer deleted', {
          customerId: id,
        });
      }

      return deleted;
    } catch (error) {
      logger.error('Error deleting customer', {
        error,
        customerId: id,
      });
      throw error;
    }
  }

  /**
   * Map a database row to a Customer entity
   * 
   * @param row - Database row
   * @returns Customer entity
   */
  private mapRowToCustomer(row: any): Customer {
    return {
      id: row.id,
      developerId: row.developer_id,
      stripeCustomerId: row.stripe_customer_id,
      email: row.email,
      name: row.name,
      metadata: row.metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// Export singleton instance
export const customerRepository = new CustomerRepository();
