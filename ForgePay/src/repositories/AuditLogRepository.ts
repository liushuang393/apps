import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

/**
 * AuditLog entity representing an audit log entry in the database
 */
export interface AuditLog {
  id: string;
  developerId: string | null;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  changes: Record<string, any> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

/**
 * Parameters for creating a new audit log
 */
export interface CreateAuditLogParams {
  developerId?: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Filter parameters for querying audit logs
 */
export interface AuditLogFilter {
  developerId?: string;
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * AuditLogRepository handles all database operations for audit logs
 * 
 * Responsibilities:
 * - Create and query audit logs
 * - Support filtering by date range, event type, resource
 * - Map between database rows and AuditLog entities
 * 
 * Requirements: 14.1, 14.3
 */
export class AuditLogRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Create a new audit log entry
   * 
   * @param params - AuditLog creation parameters
   * @param client - Optional database client for transactions
   * @returns The created audit log
   */
  async create(
    params: CreateAuditLogParams,
    client?: PoolClient
  ): Promise<AuditLog> {
    const dbClient = client || this.pool;

    const query = `
      INSERT INTO audit_logs (
        developer_id,
        user_id,
        action,
        resource_type,
        resource_id,
        changes,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      params.developerId || null,
      params.userId || null,
      params.action,
      params.resourceType,
      params.resourceId,
      params.changes ? JSON.stringify(params.changes) : null,
      params.ipAddress || null,
      params.userAgent || null,
    ];

    try {
      const result = await dbClient.query(query, values);
      const auditLog = this.mapRowToAuditLog(result.rows[0]);

      logger.debug('Audit log created', {
        auditLogId: auditLog.id,
        action: auditLog.action,
        resourceType: auditLog.resourceType,
        resourceId: auditLog.resourceId,
      });

      return auditLog;
    } catch (error) {
      logger.error('Error creating audit log', {
        error,
        params,
      });
      throw error;
    }
  }

  /**
   * Find an audit log by ID
   * 
   * @param id - AuditLog ID
   * @param client - Optional database client for transactions
   * @returns The audit log or null if not found
   */
  async findById(id: string, client?: PoolClient): Promise<AuditLog | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM audit_logs
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToAuditLog(result.rows[0]);
    } catch (error) {
      logger.error('Error finding audit log by ID', {
        error,
        auditLogId: id,
      });
      throw error;
    }
  }

  /**
   * Find audit logs with filters
   * 
   * @param filter - Filter parameters
   * @param limit - Maximum number of results
   * @param offset - Offset for pagination
   * @param client - Optional database client for transactions
   * @returns Array of audit logs
   */
  async find(
    filter: AuditLogFilter,
    limit: number = 100,
    offset: number = 0,
    client?: PoolClient
  ): Promise<AuditLog[]> {
    const dbClient = client || this.pool;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (filter.developerId) {
      conditions.push(`developer_id = $${paramIndex++}`);
      values.push(filter.developerId);
    }

    if (filter.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(filter.userId);
    }

    if (filter.action) {
      conditions.push(`action = $${paramIndex++}`);
      values.push(filter.action);
    }

    if (filter.resourceType) {
      conditions.push(`resource_type = $${paramIndex++}`);
      values.push(filter.resourceType);
    }

    if (filter.resourceId) {
      conditions.push(`resource_id = $${paramIndex++}`);
      values.push(filter.resourceId);
    }

    if (filter.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(filter.startDate);
    }

    if (filter.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(filter.endDate);
    }

    let query = `SELECT * FROM audit_logs`;

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    values.push(limit, offset);

    try {
      const result = await dbClient.query(query, values);
      return result.rows.map((row) => this.mapRowToAuditLog(row));
    } catch (error) {
      logger.error('Error finding audit logs', {
        error,
        filter,
      });
      throw error;
    }
  }

  /**
   * Count audit logs with filters
   * 
   * @param filter - Filter parameters
   * @param client - Optional database client for transactions
   * @returns Count of audit logs
   */
  async count(
    filter: AuditLogFilter,
    client?: PoolClient
  ): Promise<number> {
    const dbClient = client || this.pool;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (filter.developerId) {
      conditions.push(`developer_id = $${paramIndex++}`);
      values.push(filter.developerId);
    }

    if (filter.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(filter.userId);
    }

    if (filter.action) {
      conditions.push(`action = $${paramIndex++}`);
      values.push(filter.action);
    }

    if (filter.resourceType) {
      conditions.push(`resource_type = $${paramIndex++}`);
      values.push(filter.resourceType);
    }

    if (filter.resourceId) {
      conditions.push(`resource_id = $${paramIndex++}`);
      values.push(filter.resourceId);
    }

    if (filter.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(filter.startDate);
    }

    if (filter.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(filter.endDate);
    }

    let query = `SELECT COUNT(*) as count FROM audit_logs`;

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    try {
      const result = await dbClient.query(query, values);
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error('Error counting audit logs', {
        error,
        filter,
      });
      throw error;
    }
  }

  /**
   * Find audit logs by developer
   * 
   * @param developerId - Developer ID
   * @param limit - Maximum number of results
   * @param client - Optional database client for transactions
   * @returns Array of audit logs
   */
  async findByDeveloperId(
    developerId: string,
    limit: number = 100,
    client?: PoolClient
  ): Promise<AuditLog[]> {
    return this.find({ developerId }, limit, 0, client);
  }

  /**
   * Find audit logs by resource
   * 
   * @param resourceType - Resource type
   * @param resourceId - Resource ID
   * @param limit - Maximum number of results
   * @param client - Optional database client for transactions
   * @returns Array of audit logs
   */
  async findByResource(
    resourceType: string,
    resourceId: string,
    limit: number = 100,
    client?: PoolClient
  ): Promise<AuditLog[]> {
    return this.find({ resourceType, resourceId }, limit, 0, client);
  }

  /**
   * Find audit logs by action
   * 
   * @param action - Action type
   * @param limit - Maximum number of results
   * @param client - Optional database client for transactions
   * @returns Array of audit logs
   */
  async findByAction(
    action: string,
    limit: number = 100,
    client?: PoolClient
  ): Promise<AuditLog[]> {
    return this.find({ action }, limit, 0, client);
  }

  /**
   * Find audit logs within date range
   * 
   * @param startDate - Start date
   * @param endDate - End date
   * @param limit - Maximum number of results
   * @param client - Optional database client for transactions
   * @returns Array of audit logs
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    limit: number = 100,
    client?: PoolClient
  ): Promise<AuditLog[]> {
    return this.find({ startDate, endDate }, limit, 0, client);
  }

  /**
   * Map a database row to an AuditLog entity
   * 
   * @param row - Database row
   * @returns AuditLog entity
   */
  private mapRowToAuditLog(row: any): AuditLog {
    return {
      id: row.id,
      developerId: row.developer_id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      changes: row.changes,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: new Date(row.created_at),
    };
  }
}

// Export singleton instance
export const auditLogRepository = new AuditLogRepository();
