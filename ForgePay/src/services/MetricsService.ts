import { Pool } from 'pg';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Metric types
 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * Metric entry
 */
export interface Metric {
  name: string;
  value: number;
  type: MetricType;
  labels?: Record<string, string>;
  timestamp: Date;
}

/**
 * Alert severity
 */
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Alert entry
 */
export interface Alert {
  id: string;
  developerId: string | null;
  alertName: string;
  severity: AlertSeverity;
  message: string;
  metricName: string | null;
  thresholdValue: number | null;
  actualValue: number | null;
  isResolved: boolean;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Metric aggregation result
 */
export interface MetricAggregation {
  metricName: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p50?: number;
  p90?: number;
  p99?: number;
}

/**
 * Health check result
 */
export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  version: string;
  uptime: number;
  checks: {
    database: { status: string; latencyMs: number };
    redis?: { status: string; latencyMs: number };
    stripe?: { status: string };
  };
}

/**
 * System metrics
 */
export interface SystemMetrics {
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu?: {
    loadAverage: number[];
  };
  process: {
    uptime: number;
    pid: number;
  };
}

/**
 * MetricsService handles monitoring and observability
 * 
 * Requirements: 16.1, 16.2, 16.3
 */
export class MetricsService {
  private pool: Pool;
  private startTime: Date;
  private counters: Map<string, number>;
  private gauges: Map<string, number>;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
    this.startTime = new Date();
    this.counters = new Map();
    this.gauges = new Map();
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
   * Record a metric to the database
   */
  async recordMetric(
    name: string,
    value: number,
    type: MetricType = 'gauge',
    options?: { developerId?: string; labels?: Record<string, string> }
  ): Promise<void> {
    const query = `
      INSERT INTO metrics (developer_id, metric_name, metric_value, metric_type, labels)
      VALUES ($1, $2, $3, $4, $5)
    `;

    try {
      await this.pool.query(query, [
        options?.developerId || null,
        name,
        value,
        type,
        options?.labels ? JSON.stringify(options.labels) : '{}',
      ]);
    } catch (error) {
      logger.error('Error recording metric', { error, name, value });
    }
  }

  /**
   * Record multiple metrics in batch
   */
  async recordMetrics(metrics: Metric[], developerId?: string): Promise<void> {
    if (metrics.length === 0) return;

    const values = metrics.map((_, i) => {
      const offset = i * 5;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
    }).join(', ');

    const params = metrics.flatMap((m) => [
      developerId || null,
      m.name,
      m.value,
      m.type,
      JSON.stringify(m.labels || {}),
    ]);

    const query = `
      INSERT INTO metrics (developer_id, metric_name, metric_value, metric_type, labels)
      VALUES ${values}
    `;

    try {
      await this.pool.query(query, params);
    } catch (error) {
      logger.error('Error recording batch metrics', { error });
    }
  }

  /**
   * Get metric aggregations
   */
  async getMetricAggregations(
    metricName: string,
    options?: {
      developerId?: string;
      startTime?: Date;
      endTime?: Date;
      interval?: '1m' | '5m' | '1h' | '1d';
    }
  ): Promise<MetricAggregation[]> {
    const startTime = options?.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endTime = options?.endTime || new Date();

    // Note: intervalSql could be used for time-bucket grouping in production
    // For now, we aggregate over the entire time range
    
    const query = `
      SELECT 
        metric_name,
        COUNT(*) as count,
        SUM(metric_value) as sum,
        AVG(metric_value) as avg,
        MIN(metric_value) as min,
        MAX(metric_value) as max,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY metric_value) as p50,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY metric_value) as p90,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY metric_value) as p99
      FROM metrics
      WHERE metric_name = $1
        AND recorded_at >= $2
        AND recorded_at <= $3
        ${options?.developerId ? 'AND developer_id = $4' : ''}
      GROUP BY metric_name
    `;

    const params: unknown[] = [metricName, startTime, endTime];
    if (options?.developerId) {
      params.push(options.developerId);
    }

    try {
      const result = await this.pool.query(query, params);
      return result.rows.map((row) => ({
        metricName: row.metric_name,
        count: parseInt(row.count, 10),
        sum: parseFloat(row.sum),
        avg: parseFloat(row.avg),
        min: parseFloat(row.min),
        max: parseFloat(row.max),
        p50: row.p50 ? parseFloat(row.p50) : undefined,
        p90: row.p90 ? parseFloat(row.p90) : undefined,
        p99: row.p99 ? parseFloat(row.p99) : undefined,
      }));
    } catch (error) {
      logger.error('Error getting metric aggregations', { error, metricName });
      return [];
    }
  }

  /**
   * Create an alert
   */
  async createAlert(params: {
    developerId?: string;
    alertName: string;
    severity: AlertSeverity;
    message: string;
    metricName?: string;
    thresholdValue?: number;
    actualValue?: number;
    metadata?: Record<string, unknown>;
  }): Promise<Alert> {
    const query = `
      INSERT INTO alerts (
        developer_id, alert_name, severity, message,
        metric_name, threshold_value, actual_value, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      params.developerId || null,
      params.alertName,
      params.severity,
      params.message,
      params.metricName || null,
      params.thresholdValue || null,
      params.actualValue || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ]);

    logger.warn('Alert created', {
      alertName: params.alertName,
      severity: params.severity,
    });

    return this.mapRowToAlert(result.rows[0]);
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string): Promise<Alert | null> {
    const query = `
      UPDATE alerts
      SET is_resolved = true, resolved_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.pool.query(query, [alertId]);
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToAlert(result.rows[0]);
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<Alert | null> {
    const query = `
      UPDATE alerts
      SET acknowledged_at = NOW(), acknowledged_by = $2
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.pool.query(query, [alertId, acknowledgedBy]);
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToAlert(result.rows[0]);
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(developerId?: string): Promise<Alert[]> {
    let query = `SELECT * FROM alerts WHERE is_resolved = false`;
    const params: unknown[] = [];

    if (developerId) {
      query += ` AND (developer_id = $1 OR developer_id IS NULL)`;
      params.push(developerId);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => this.mapRowToAlert(row));
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<HealthCheck> {
    const checks: HealthCheck['checks'] = {
      database: { status: 'unknown', latencyMs: 0 },
    };

    // Check database
    const dbStart = Date.now();
    try {
      await this.pool.query('SELECT 1');
      checks.database = {
        status: 'healthy',
        latencyMs: Date.now() - dbStart,
      };
    } catch (error) {
      logger.error('Database health check failed', { error });
      checks.database = {
        status: 'unhealthy',
        latencyMs: Date.now() - dbStart,
      };
    }

    // Determine overall status
    const allHealthy = Object.values(checks).every(
      (c) => c.status === 'healthy'
    );
    const anyUnhealthy = Object.values(checks).some(
      (c) => c.status === 'unhealthy'
    );

    let status: HealthCheck['status'] = 'healthy';
    if (anyUnhealthy) {
      status = 'unhealthy';
    } else if (!allHealthy) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      checks,
    };
  }

  /**
   * Get system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const memoryUsage = process.memoryUsage();

    return {
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
      },
      process: {
        uptime: process.uptime(),
        pid: process.pid,
      },
    };
  }

  /**
   * Get business metrics summary
   */
  async getBusinessMetrics(
    developerId: string,
    period: '24h' | '7d' | '30d' = '24h'
  ): Promise<{
    checkouts: { total: number; successful: number; rate: number };
    revenue: { total: number; currency: string };
    customers: { total: number; new: number };
    entitlements: { active: number; expiringSoon: number };
  }> {
    const periodDays = period === '24h' ? 1 : period === '7d' ? 7 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    // Get checkout stats
    const checkoutStats = await this.pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as successful
      FROM checkout_sessions
      WHERE developer_id = $1 AND created_at >= $2
    `, [developerId, startDate]);

    // Get revenue
    const revenueStats = await this.pool.query(`
      SELECT 
        COALESCE(SUM(total), 0) as total,
        COALESCE(currency, 'usd') as currency
      FROM invoices
      WHERE developer_id = $1 AND status = 'paid' AND created_at >= $2
      GROUP BY currency
      LIMIT 1
    `, [developerId, startDate]);

    // Get customer stats
    const customerStats = await this.pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at >= $2) as new
      FROM customers
      WHERE developer_id = $1
    `, [developerId, startDate]);

    // Get entitlement stats
    const entitlementStats = await this.pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'active' AND expires_at IS NOT NULL 
          AND expires_at < NOW() + INTERVAL '7 days') as expiring_soon
      FROM entitlements
      WHERE developer_id = $1
    `, [developerId]);

    const checkoutTotal = parseInt(checkoutStats.rows[0]?.total || '0', 10);
    const checkoutSuccessful = parseInt(checkoutStats.rows[0]?.successful || '0', 10);

    return {
      checkouts: {
        total: checkoutTotal,
        successful: checkoutSuccessful,
        rate: checkoutTotal > 0 ? (checkoutSuccessful / checkoutTotal) * 100 : 0,
      },
      revenue: {
        total: parseInt(revenueStats.rows[0]?.total || '0', 10),
        currency: revenueStats.rows[0]?.currency || 'usd',
      },
      customers: {
        total: parseInt(customerStats.rows[0]?.total || '0', 10),
        new: parseInt(customerStats.rows[0]?.new || '0', 10),
      },
      entitlements: {
        active: parseInt(entitlementStats.rows[0]?.active || '0', 10),
        expiringSoon: parseInt(entitlementStats.rows[0]?.expiring_soon || '0', 10),
      },
    };
  }

  /**
   * Cleanup old metrics
   */
  async cleanupOldMetrics(retentionDays: number = 30): Promise<number> {
    const query = `
      DELETE FROM metrics
      WHERE recorded_at < NOW() - INTERVAL '${retentionDays} days'
    `;

    try {
      const result = await this.pool.query(query);
      const deleted = result.rowCount || 0;
      
      if (deleted > 0) {
        logger.info('Old metrics cleaned up', { deleted, retentionDays });
      }
      
      return deleted;
    } catch (error) {
      logger.error('Error cleaning up old metrics', { error });
      return 0;
    }
  }

  /**
   * Get metric key with labels
   */
  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  /**
   * Map database row to Alert
   */
  private mapRowToAlert(row: Record<string, unknown>): Alert {
    return {
      id: row.id as string,
      developerId: row.developer_id as string | null,
      alertName: row.alert_name as string,
      severity: row.severity as AlertSeverity,
      message: row.message as string,
      metricName: row.metric_name as string | null,
      thresholdValue: row.threshold_value as number | null,
      actualValue: row.actual_value as number | null,
      isResolved: row.is_resolved as boolean,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
      acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at as string) : null,
      acknowledgedBy: row.acknowledged_by as string | null,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: new Date(row.created_at as string),
    };
  }
}

// Export singleton instance
export const metricsService = new MetricsService();
