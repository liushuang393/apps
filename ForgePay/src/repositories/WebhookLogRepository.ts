import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { WebhookEventStatus } from '../types';
import { logger } from '../utils/logger';

/**
 * WebhookLog entity representing a webhook event in the database
 */
export interface WebhookLog {
  id: string;
  stripeEventId: string;
  eventType: string;
  payload: Record<string, any>;
  signature: string;
  status: WebhookEventStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * Parameters for creating a new webhook log
 */
export interface CreateWebhookLogParams {
  stripeEventId: string;
  eventType: string;
  payload: Record<string, any>;
  signature: string;
  status?: WebhookEventStatus;
}

/**
 * Parameters for updating an existing webhook log
 */
export interface UpdateWebhookLogParams {
  status?: WebhookEventStatus;
  attempts?: number;
  lastAttemptAt?: Date;
  errorMessage?: string | null;
}

/**
 * WebhookLogRepository handles all database operations for webhook events
 * 
 * Responsibilities:
 * - Create, read, update webhook logs
 * - Query by status and event type
 * - Track processing attempts
 * - Map between database rows and WebhookLog entities
 * 
 * Requirements: 3.8
 */
export class WebhookLogRepository {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  /**
   * Create a new webhook log
   * 
   * @param params - WebhookLog creation parameters
   * @param client - Optional database client for transactions
   * @returns The created webhook log
   */
  async create(
    params: CreateWebhookLogParams,
    client?: PoolClient
  ): Promise<WebhookLog> {
    const dbClient = client || this.pool;

    const query = `
      INSERT INTO webhook_events (
        stripe_event_id,
        event_type,
        payload,
        signature,
        status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const values = [
      params.stripeEventId,
      params.eventType,
      JSON.stringify(params.payload),
      params.signature,
      params.status || 'pending',
    ];

    try {
      const result = await dbClient.query(query, values);
      const webhookLog = this.mapRowToWebhookLog(result.rows[0]);

      logger.info('Webhook log created', {
        webhookLogId: webhookLog.id,
        stripeEventId: webhookLog.stripeEventId,
        eventType: webhookLog.eventType,
      });

      return webhookLog;
    } catch (error) {
      logger.error('Error creating webhook log', {
        error,
        stripeEventId: params.stripeEventId,
      });
      throw error;
    }
  }

  /**
   * Find a webhook log by ID
   * 
   * @param id - WebhookLog ID
   * @param client - Optional database client for transactions
   * @returns The webhook log or null if not found
   */
  async findById(id: string, client?: PoolClient): Promise<WebhookLog | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM webhook_events
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToWebhookLog(result.rows[0]);
    } catch (error) {
      logger.error('Error finding webhook log by ID', {
        error,
        webhookLogId: id,
      });
      throw error;
    }
  }

  /**
   * Find a webhook log by Stripe event ID
   * 
   * @param stripeEventId - Stripe event ID
   * @param client - Optional database client for transactions
   * @returns The webhook log or null if not found
   */
  async findByStripeEventId(
    stripeEventId: string,
    client?: PoolClient
  ): Promise<WebhookLog | null> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM webhook_events
      WHERE stripe_event_id = $1
    `;

    try {
      const result = await dbClient.query(query, [stripeEventId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToWebhookLog(result.rows[0]);
    } catch (error) {
      logger.error('Error finding webhook log by Stripe event ID', {
        error,
        stripeEventId,
      });
      throw error;
    }
  }

  /**
   * Check if a Stripe event has already been processed
   * 
   * @param stripeEventId - Stripe event ID
   * @param client - Optional database client for transactions
   * @returns True if already processed
   */
  async isEventProcessed(
    stripeEventId: string,
    client?: PoolClient
  ): Promise<boolean> {
    const dbClient = client || this.pool;

    const query = `
      SELECT 1 FROM webhook_events
      WHERE stripe_event_id = $1 AND status = 'processed'
    `;

    try {
      const result = await dbClient.query(query, [stripeEventId]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error checking if event is processed', {
        error,
        stripeEventId,
      });
      throw error;
    }
  }

  /**
   * Find webhook logs by status
   * 
   * @param status - Webhook event status
   * @param limit - Maximum number of results
   * @param client - Optional database client for transactions
   * @returns Array of webhook logs
   */
  async findByStatus(
    status: WebhookEventStatus,
    limit: number = 100,
    client?: PoolClient
  ): Promise<WebhookLog[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM webhook_events
      WHERE status = $1
      ORDER BY created_at ASC
      LIMIT $2
    `;

    try {
      const result = await dbClient.query(query, [status, limit]);
      return result.rows.map((row) => this.mapRowToWebhookLog(row));
    } catch (error) {
      logger.error('Error finding webhook logs by status', {
        error,
        status,
      });
      throw error;
    }
  }

  /**
   * Find webhook logs by event type
   * 
   * @param eventType - Stripe event type
   * @param limit - Maximum number of results
   * @param client - Optional database client for transactions
   * @returns Array of webhook logs
   */
  async findByEventType(
    eventType: string,
    limit: number = 100,
    client?: PoolClient
  ): Promise<WebhookLog[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM webhook_events
      WHERE event_type = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    try {
      const result = await dbClient.query(query, [eventType, limit]);
      return result.rows.map((row) => this.mapRowToWebhookLog(row));
    } catch (error) {
      logger.error('Error finding webhook logs by event type', {
        error,
        eventType,
      });
      throw error;
    }
  }

  /**
   * Find failed webhook logs that need retry
   * 
   * @param maxAttempts - Maximum number of retry attempts
   * @param limit - Maximum number of results
   * @param client - Optional database client for transactions
   * @returns Array of webhook logs
   */
  async findFailedForRetry(
    maxAttempts: number = 5,
    limit: number = 100,
    client?: PoolClient
  ): Promise<WebhookLog[]> {
    const dbClient = client || this.pool;

    const query = `
      SELECT * FROM webhook_events
      WHERE status = 'failed' AND attempts < $1
      ORDER BY last_attempt_at ASC NULLS FIRST
      LIMIT $2
    `;

    try {
      const result = await dbClient.query(query, [maxAttempts, limit]);
      return result.rows.map((row) => this.mapRowToWebhookLog(row));
    } catch (error) {
      logger.error('Error finding failed webhook logs for retry', {
        error,
        maxAttempts,
      });
      throw error;
    }
  }

  /**
   * Find webhook logs in dead letter queue
   * 
   * @param limit - Maximum number of results
   * @param client - Optional database client for transactions
   * @returns Array of webhook logs
   */
  async findInDLQ(
    limit: number = 100,
    client?: PoolClient
  ): Promise<WebhookLog[]> {
    return this.findByStatus('dlq', limit, client);
  }

  /**
   * Update a webhook log
   * 
   * @param id - WebhookLog ID
   * @param params - Update parameters
   * @param client - Optional database client for transactions
   * @returns The updated webhook log or null if not found
   */
  async update(
    id: string,
    params: UpdateWebhookLogParams,
    client?: PoolClient
  ): Promise<WebhookLog | null> {
    const dbClient = client || this.pool;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }

    if (params.attempts !== undefined) {
      updates.push(`attempts = $${paramIndex++}`);
      values.push(params.attempts);
    }

    if (params.lastAttemptAt !== undefined) {
      updates.push(`last_attempt_at = $${paramIndex++}`);
      values.push(params.lastAttemptAt);
    }

    if (params.errorMessage !== undefined) {
      updates.push(`error_message = $${paramIndex++}`);
      values.push(params.errorMessage);
    }

    if (updates.length === 0) {
      return this.findById(id, client);
    }

    values.push(id);

    const query = `
      UPDATE webhook_events
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      const result = await dbClient.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      const webhookLog = this.mapRowToWebhookLog(result.rows[0]);

      logger.info('Webhook log updated', {
        webhookLogId: webhookLog.id,
        updates: params,
      });

      return webhookLog;
    } catch (error) {
      logger.error('Error updating webhook log', {
        error,
        webhookLogId: id,
        params,
      });
      throw error;
    }
  }

  /**
   * Mark a webhook as processed
   * 
   * @param id - WebhookLog ID
   * @param client - Optional database client for transactions
   * @returns The updated webhook log or null if not found
   */
  async markProcessed(
    id: string,
    client?: PoolClient
  ): Promise<WebhookLog | null> {
    return this.update(
      id,
      {
        status: 'processed',
        lastAttemptAt: new Date(),
        errorMessage: null,
      },
      client
    );
  }

  /**
   * Mark a webhook as failed with error message
   * 
   * @param id - WebhookLog ID
   * @param errorMessage - Error message
   * @param client - Optional database client for transactions
   * @returns The updated webhook log or null if not found
   */
  async markFailed(
    id: string,
    errorMessage: string,
    client?: PoolClient
  ): Promise<WebhookLog | null> {
    const webhookLog = await this.findById(id, client);
    if (!webhookLog) return null;

    return this.update(
      id,
      {
        status: 'failed',
        attempts: webhookLog.attempts + 1,
        lastAttemptAt: new Date(),
        errorMessage,
      },
      client
    );
  }

  /**
   * Move a webhook to dead letter queue
   * 
   * @param id - WebhookLog ID
   * @param errorMessage - Final error message
   * @param client - Optional database client for transactions
   * @returns The updated webhook log or null if not found
   */
  async moveToDLQ(
    id: string,
    errorMessage: string,
    client?: PoolClient
  ): Promise<WebhookLog | null> {
    return this.update(
      id,
      {
        status: 'dlq',
        lastAttemptAt: new Date(),
        errorMessage,
      },
      client
    );
  }

  /**
   * Delete a webhook log (hard delete - use with caution)
   * 
   * @param id - WebhookLog ID
   * @param client - Optional database client for transactions
   * @returns True if deleted, false if not found
   */
  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || this.pool;

    const query = `
      DELETE FROM webhook_events
      WHERE id = $1
    `;

    try {
      const result = await dbClient.query(query, [id]);

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info('Webhook log deleted', {
          webhookLogId: id,
        });
      }

      return deleted;
    } catch (error) {
      logger.error('Error deleting webhook log', {
        error,
        webhookLogId: id,
      });
      throw error;
    }
  }

  /**
   * Map a database row to a WebhookLog entity
   * 
   * @param row - Database row
   * @returns WebhookLog entity
   */
  private mapRowToWebhookLog(row: any): WebhookLog {
    return {
      id: row.id,
      stripeEventId: row.stripe_event_id,
      eventType: row.event_type,
      payload: row.payload,
      signature: row.signature,
      status: row.status as WebhookEventStatus,
      attempts: row.attempts,
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
    };
  }
}

// Export singleton instance
export const webhookLogRepository = new WebhookLogRepository();
