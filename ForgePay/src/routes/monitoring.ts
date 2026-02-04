import { Router, Request, Response } from 'express';
import { metricsService } from '../services/MetricsService';
import { AuthenticatedRequest, apiKeyAuth } from '../middleware';
import { logger } from '../utils/logger';

const router = Router();

// ==================== Public Health Endpoints ====================

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - Monitoring
 *     summary: Health check
 *     description: Check the health status of the API and its dependencies
 *     security: []
 *     responses:
 *       200:
 *         description: Service is healthy or degraded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheck'
 *       503:
 *         description: Service is unhealthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheck'
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await metricsService.healthCheck();

    const statusCode = health.status === 'healthy' ? 200 :
                       health.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check failed', { error });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date(),
      error: 'Health check failed',
    });
  }
});

/**
 * GET /health/live
 * Kubernetes liveness probe
 */
router.get('/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'alive', timestamp: new Date() });
});

/**
 * GET /health/ready
 * Kubernetes readiness probe
 */
router.get('/health/ready', async (_req: Request, res: Response) => {
  try {
    const health = await metricsService.healthCheck();

    if (health.status === 'unhealthy') {
      res.status(503).json({ status: 'not ready', checks: health.checks });
      return;
    }

    res.json({ status: 'ready', checks: health.checks });
  } catch (error) {
    logger.error('Readiness check failed', { error });
    res.status(503).json({ status: 'not ready', error: 'Check failed' });
  }
});

// ==================== Authenticated Metrics Endpoints ====================

/**
 * GET /metrics/system
 * Get system metrics
 */
router.get('/metrics/system', apiKeyAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const systemMetrics = metricsService.getSystemMetrics();
    const health = await metricsService.healthCheck();

    res.json({
      system: systemMetrics,
      health,
    });
  } catch (error) {
    logger.error('Error getting system metrics', { error });
    res.status(500).json({ error: 'Failed to get system metrics' });
  }
});

/**
 * GET /metrics/business
 * Get business metrics for the authenticated developer
 */
router.get('/metrics/business', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const period = (req.query.period as '24h' | '7d' | '30d') || '24h';

    const metrics = await metricsService.getBusinessMetrics(req.developer!.id, period);

    res.json({ metrics, period });
  } catch (error) {
    logger.error('Error getting business metrics', { error });
    res.status(500).json({ error: 'Failed to get business metrics' });
  }
});

/**
 * GET /metrics/:name
 * Get aggregated metrics by name
 */
router.get('/metrics/:name', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name } = req.params;
    const startTime = req.query.startTime
      ? new Date(req.query.startTime as string)
      : undefined;
    const endTime = req.query.endTime
      ? new Date(req.query.endTime as string)
      : undefined;
    const interval = req.query.interval as '1m' | '5m' | '1h' | '1d' | undefined;

    const aggregations = await metricsService.getMetricAggregations(name, {
      developerId: req.developer!.id,
      startTime,
      endTime,
      interval,
    });

    res.json({ metricName: name, aggregations });
  } catch (error) {
    logger.error('Error getting metric aggregations', { error });
    res.status(500).json({ error: 'Failed to get metric aggregations' });
  }
});

/**
 * POST /metrics
 * Record a custom metric
 */
router.post('/metrics', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, value, type, labels } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (typeof value !== 'number') {
      res.status(400).json({ error: 'value must be a number' });
      return;
    }

    await metricsService.recordMetric(name, value, type || 'gauge', {
      developerId: req.developer!.id,
      labels,
    });

    res.status(201).json({ success: true });
  } catch (error) {
    logger.error('Error recording metric', { error });
    res.status(500).json({ error: 'Failed to record metric' });
  }
});

// ==================== Alerts ====================

/**
 * GET /alerts
 * Get active alerts
 */
router.get('/alerts', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const alerts = await metricsService.getActiveAlerts(req.developer!.id);

    res.json({
      alerts: alerts.map((a) => ({
        id: a.id,
        alertName: a.alertName,
        severity: a.severity,
        message: a.message,
        metricName: a.metricName,
        thresholdValue: a.thresholdValue,
        actualValue: a.actualValue,
        isResolved: a.isResolved,
        acknowledgedAt: a.acknowledgedAt,
        createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    logger.error('Error getting alerts', { error });
    res.status(500).json({ error: 'Failed to get alerts' });
  }
});

/**
 * POST /alerts/:id/acknowledge
 * Acknowledge an alert
 */
router.post('/alerts/:id/acknowledge', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const alert = await metricsService.acknowledgeAlert(
      req.params.id,
      req.developer!.email
    );

    if (!alert) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }

    res.json({ alert });
  } catch (error) {
    logger.error('Error acknowledging alert', { error });
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

/**
 * POST /alerts/:id/resolve
 * Resolve an alert
 */
router.post('/alerts/:id/resolve', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const alert = await metricsService.resolveAlert(req.params.id);

    if (!alert) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }

    res.json({ alert });
  } catch (error) {
    logger.error('Error resolving alert', { error });
    res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

/**
 * POST /alerts
 * Create a custom alert
 */
router.post('/alerts', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { alertName, severity, message, metricName, thresholdValue, actualValue, metadata } = req.body;

    if (!alertName || !message) {
      res.status(400).json({ error: 'alertName and message are required' });
      return;
    }

    const alert = await metricsService.createAlert({
      developerId: req.developer!.id,
      alertName,
      severity: severity || 'warning',
      message,
      metricName,
      thresholdValue,
      actualValue,
      metadata,
    });

    res.status(201).json({ alert });
  } catch (error) {
    logger.error('Error creating alert', { error });
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

export default router;
