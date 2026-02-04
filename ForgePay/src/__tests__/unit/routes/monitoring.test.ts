import express, { Express, NextFunction, Response } from 'express';
import request from 'supertest';

// Mock dependencies before importing the router
jest.mock('../../../services/MetricsService', () => ({
  metricsService: {
    healthCheck: jest.fn(),
    getSystemMetrics: jest.fn(),
    getBusinessMetrics: jest.fn(),
    getMetricAggregations: jest.fn(),
    recordMetric: jest.fn(),
    getActiveAlerts: jest.fn(),
    acknowledgeAlert: jest.fn(),
    resolveAlert: jest.fn(),
    createAlert: jest.fn(),
  },
}));

jest.mock('../../../middleware', () => ({
  apiKeyAuth: jest.fn(async (_req, _res, next) => next()),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import monitoringRouter from '../../../routes/monitoring';
import { metricsService } from '../../../services/MetricsService';
import { apiKeyAuth, AuthenticatedRequest } from '../../../middleware';
import { logger } from '../../../utils/logger';

const mockMetricsService = metricsService as jest.Mocked<typeof metricsService>;
const mockApiKeyAuth = apiKeyAuth as jest.MockedFunction<typeof apiKeyAuth>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Monitoring Routes', () => {
  let app: Express;

  const mockDeveloper = {
    id: 'dev_test123',
    email: 'test@example.com',
    testMode: false,
    stripeAccountId: 'acct_test123',
    webhookSecret: 'whsec_test',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());

    // Mount the monitoring router
    app.use('/api/v1', monitoringRouter);

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default auth mock to pass through and attach developer
    mockApiKeyAuth.mockImplementation(async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.developer = mockDeveloper;
      next();
    });
  });

  // ==================== Public Health Endpoints ====================

  describe('GET /api/v1/health', () => {
    describe('Healthy Status', () => {
      it('should return 200 with healthy status', async () => {
        const healthCheck = {
          status: 'healthy' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks: {
            database: { status: 'healthy', latencyMs: 5 },
          },
        };
        mockMetricsService.healthCheck.mockResolvedValue(healthCheck);

        const response = await request(app).get('/api/v1/health');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('healthy');
        expect(response.body.checks).toEqual(healthCheck.checks);
      });

      it('should not require authentication', async () => {
        mockMetricsService.healthCheck.mockResolvedValue({
          status: 'healthy' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks: { database: { status: 'healthy', latencyMs: 5 } },
        });

        await request(app).get('/api/v1/health');

        expect(mockApiKeyAuth).not.toHaveBeenCalled();
      });
    });

    describe('Degraded Status', () => {
      it('should return 200 with degraded status', async () => {
        const healthCheck = {
          status: 'degraded' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks: {
            database: { status: 'healthy', latencyMs: 5 },
            redis: { status: 'degraded', latencyMs: 500 },
          },
        };
        mockMetricsService.healthCheck.mockResolvedValue(healthCheck);

        const response = await request(app).get('/api/v1/health');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('degraded');
      });
    });

    describe('Unhealthy Status', () => {
      it('should return 503 with unhealthy status', async () => {
        const healthCheck = {
          status: 'unhealthy' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks: {
            database: { status: 'unhealthy', latencyMs: 0 },
          },
        };
        mockMetricsService.healthCheck.mockResolvedValue(healthCheck);

        const response = await request(app).get('/api/v1/health');

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('unhealthy');
      });
    });

    describe('Error Handling', () => {
      it('should return 503 when health check throws error', async () => {
        mockMetricsService.healthCheck.mockRejectedValue(new Error('Database connection failed'));

        const response = await request(app).get('/api/v1/health');

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('unhealthy');
        expect(response.body.error).toBe('Health check failed');
      });

      it('should log error when health check fails', async () => {
        const error = new Error('Database connection failed');
        mockMetricsService.healthCheck.mockRejectedValue(error);

        await request(app).get('/api/v1/health');

        expect(mockLogger.error).toHaveBeenCalledWith('Health check failed', { error });
      });

      it('should include timestamp in error response', async () => {
        mockMetricsService.healthCheck.mockRejectedValue(new Error('Check failed'));

        const response = await request(app).get('/api/v1/health');

        expect(response.body.timestamp).toBeDefined();
      });
    });
  });

  describe('GET /api/v1/health/live', () => {
    it('should return 200 with alive status', async () => {
      const response = await request(app).get('/api/v1/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('alive');
      expect(response.body.timestamp).toBeDefined();
    });

    it('should not require authentication', async () => {
      await request(app).get('/api/v1/health/live');

      expect(mockApiKeyAuth).not.toHaveBeenCalled();
    });

    it('should always return alive regardless of service state', async () => {
      // Liveness probe should always return alive as long as the process is running
      const response = await request(app).get('/api/v1/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('alive');
    });
  });

  describe('GET /api/v1/health/ready', () => {
    describe('Ready Status', () => {
      it('should return 200 with ready status when healthy', async () => {
        mockMetricsService.healthCheck.mockResolvedValue({
          status: 'healthy' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks: { database: { status: 'healthy', latencyMs: 5 } },
        });

        const response = await request(app).get('/api/v1/health/ready');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ready');
      });

      it('should return 200 with ready status when degraded', async () => {
        mockMetricsService.healthCheck.mockResolvedValue({
          status: 'degraded' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks: { database: { status: 'healthy', latencyMs: 5 } },
        });

        const response = await request(app).get('/api/v1/health/ready');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ready');
      });

      it('should include checks in response', async () => {
        const checks = { database: { status: 'healthy', latencyMs: 5 } };
        mockMetricsService.healthCheck.mockResolvedValue({
          status: 'healthy' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks,
        });

        const response = await request(app).get('/api/v1/health/ready');

        expect(response.body.checks).toEqual(checks);
      });
    });

    describe('Not Ready Status', () => {
      it('should return 503 when unhealthy', async () => {
        mockMetricsService.healthCheck.mockResolvedValue({
          status: 'unhealthy' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks: { database: { status: 'unhealthy', latencyMs: 0 } },
        });

        const response = await request(app).get('/api/v1/health/ready');

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('not ready');
      });

      it('should include checks in not ready response', async () => {
        const checks = { database: { status: 'unhealthy', latencyMs: 0 } };
        mockMetricsService.healthCheck.mockResolvedValue({
          status: 'unhealthy' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks,
        });

        const response = await request(app).get('/api/v1/health/ready');

        expect(response.body.checks).toEqual(checks);
      });
    });

    describe('Error Handling', () => {
      it('should return 503 when health check throws error', async () => {
        mockMetricsService.healthCheck.mockRejectedValue(new Error('Database error'));

        const response = await request(app).get('/api/v1/health/ready');

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('not ready');
        expect(response.body.error).toBe('Check failed');
      });
    });

    it('should not require authentication', async () => {
      mockMetricsService.healthCheck.mockResolvedValue({
        status: 'healthy' as const,
        timestamp: new Date(),
        version: '1.0.0',
        uptime: 3600,
        checks: { database: { status: 'healthy', latencyMs: 5 } },
      });

      await request(app).get('/api/v1/health/ready');

      expect(mockApiKeyAuth).not.toHaveBeenCalled();
    });
  });

  // ==================== Authenticated Metrics Endpoints ====================

  describe('GET /api/v1/metrics/system', () => {
    const mockSystemMetrics = {
      memory: {
        used: 50000000,
        total: 100000000,
        percentage: 50,
      },
      process: {
        uptime: 3600,
        pid: 12345,
      },
    };

    const mockHealthCheck = {
      status: 'healthy' as const,
      timestamp: new Date(),
      version: '1.0.0',
      uptime: 3600,
      checks: { database: { status: 'healthy', latencyMs: 5 } },
    };

    describe('Success Cases', () => {
      it('should return 200 with system metrics and health', async () => {
        mockMetricsService.getSystemMetrics.mockReturnValue(mockSystemMetrics);
        mockMetricsService.healthCheck.mockResolvedValue(mockHealthCheck);

        const response = await request(app)
          .get('/api/v1/metrics/system')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(200);
        expect(response.body.system).toEqual(mockSystemMetrics);
        expect(response.body.health.status).toBe('healthy');
      });

      it('should require authentication', async () => {
        mockMetricsService.getSystemMetrics.mockReturnValue(mockSystemMetrics);
        mockMetricsService.healthCheck.mockResolvedValue(mockHealthCheck);

        await request(app)
          .get('/api/v1/metrics/system')
          .set('x-api-key', 'test-key');

        expect(mockApiKeyAuth).toHaveBeenCalled();
      });
    });

    describe('Authentication Failure', () => {
      it('should return 401 when not authenticated', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({ error: 'Unauthorized' });
        });

        const response = await request(app).get('/api/v1/metrics/system');

        expect(response.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when getting metrics fails', async () => {
        mockMetricsService.getSystemMetrics.mockImplementation(() => {
          throw new Error('Metrics error');
        });

        const response = await request(app)
          .get('/api/v1/metrics/system')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to get system metrics');
      });

      it('should log error when getting metrics fails', async () => {
        const error = new Error('Metrics error');
        mockMetricsService.getSystemMetrics.mockImplementation(() => {
          throw error;
        });

        await request(app)
          .get('/api/v1/metrics/system')
          .set('x-api-key', 'test-key');

        expect(mockLogger.error).toHaveBeenCalledWith('Error getting system metrics', { error });
      });
    });
  });

  describe('GET /api/v1/metrics/business', () => {
    const mockBusinessMetrics = {
      checkouts: { total: 100, successful: 85, rate: 85 },
      revenue: { total: 10000, currency: 'usd' },
      customers: { total: 50, new: 10 },
      entitlements: { active: 45, expiringSoon: 5 },
    };

    describe('Success Cases', () => {
      it('should return 200 with business metrics', async () => {
        mockMetricsService.getBusinessMetrics.mockResolvedValue(mockBusinessMetrics);

        const response = await request(app)
          .get('/api/v1/metrics/business')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(200);
        expect(response.body.metrics).toEqual(mockBusinessMetrics);
      });

      it('should default to 24h period', async () => {
        mockMetricsService.getBusinessMetrics.mockResolvedValue(mockBusinessMetrics);

        const response = await request(app)
          .get('/api/v1/metrics/business')
          .set('x-api-key', 'test-key');

        expect(response.body.period).toBe('24h');
        expect(mockMetricsService.getBusinessMetrics).toHaveBeenCalledWith(
          mockDeveloper.id,
          '24h'
        );
      });

      it('should accept 7d period', async () => {
        mockMetricsService.getBusinessMetrics.mockResolvedValue(mockBusinessMetrics);

        const response = await request(app)
          .get('/api/v1/metrics/business?period=7d')
          .set('x-api-key', 'test-key');

        expect(response.body.period).toBe('7d');
        expect(mockMetricsService.getBusinessMetrics).toHaveBeenCalledWith(
          mockDeveloper.id,
          '7d'
        );
      });

      it('should accept 30d period', async () => {
        mockMetricsService.getBusinessMetrics.mockResolvedValue(mockBusinessMetrics);

        const response = await request(app)
          .get('/api/v1/metrics/business?period=30d')
          .set('x-api-key', 'test-key');

        expect(response.body.period).toBe('30d');
        expect(mockMetricsService.getBusinessMetrics).toHaveBeenCalledWith(
          mockDeveloper.id,
          '30d'
        );
      });

      it('should use developer id from authenticated request', async () => {
        mockMetricsService.getBusinessMetrics.mockResolvedValue(mockBusinessMetrics);

        await request(app)
          .get('/api/v1/metrics/business')
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.getBusinessMetrics).toHaveBeenCalledWith(
          mockDeveloper.id,
          expect.any(String)
        );
      });
    });

    describe('Authentication Failure', () => {
      it('should return 401 when not authenticated', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({ error: 'Unauthorized' });
        });

        const response = await request(app).get('/api/v1/metrics/business');

        expect(response.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when getting business metrics fails', async () => {
        mockMetricsService.getBusinessMetrics.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .get('/api/v1/metrics/business')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to get business metrics');
      });

      it('should log error when getting business metrics fails', async () => {
        const error = new Error('Database error');
        mockMetricsService.getBusinessMetrics.mockRejectedValue(error);

        await request(app)
          .get('/api/v1/metrics/business')
          .set('x-api-key', 'test-key');

        expect(mockLogger.error).toHaveBeenCalledWith('Error getting business metrics', { error });
      });
    });
  });

  describe('GET /api/v1/metrics/:name', () => {
    const mockAggregations = [
      {
        metricName: 'api_requests',
        count: 1000,
        sum: 5000,
        avg: 5,
        min: 1,
        max: 100,
        p50: 3,
        p90: 15,
        p99: 50,
      },
    ];

    describe('Success Cases', () => {
      it('should return 200 with metric aggregations', async () => {
        mockMetricsService.getMetricAggregations.mockResolvedValue(mockAggregations);

        const response = await request(app)
          .get('/api/v1/metrics/api_requests')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(200);
        expect(response.body.metricName).toBe('api_requests');
        expect(response.body.aggregations).toEqual(mockAggregations);
      });

      it('should pass metric name from URL parameter', async () => {
        mockMetricsService.getMetricAggregations.mockResolvedValue(mockAggregations);

        await request(app)
          .get('/api/v1/metrics/checkout_latency')
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.getMetricAggregations).toHaveBeenCalledWith(
          'checkout_latency',
          expect.any(Object)
        );
      });

      it('should pass startTime query parameter', async () => {
        mockMetricsService.getMetricAggregations.mockResolvedValue(mockAggregations);
        const startTime = '2024-01-01T00:00:00Z';

        await request(app)
          .get(`/api/v1/metrics/api_requests?startTime=${startTime}`)
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.getMetricAggregations).toHaveBeenCalledWith(
          'api_requests',
          expect.objectContaining({
            startTime: new Date(startTime),
          })
        );
      });

      it('should pass endTime query parameter', async () => {
        mockMetricsService.getMetricAggregations.mockResolvedValue(mockAggregations);
        const endTime = '2024-01-31T23:59:59Z';

        await request(app)
          .get(`/api/v1/metrics/api_requests?endTime=${endTime}`)
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.getMetricAggregations).toHaveBeenCalledWith(
          'api_requests',
          expect.objectContaining({
            endTime: new Date(endTime),
          })
        );
      });

      it('should pass interval query parameter', async () => {
        mockMetricsService.getMetricAggregations.mockResolvedValue(mockAggregations);

        await request(app)
          .get('/api/v1/metrics/api_requests?interval=1h')
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.getMetricAggregations).toHaveBeenCalledWith(
          'api_requests',
          expect.objectContaining({
            interval: '1h',
          })
        );
      });

      it('should pass developer id to service', async () => {
        mockMetricsService.getMetricAggregations.mockResolvedValue(mockAggregations);

        await request(app)
          .get('/api/v1/metrics/api_requests')
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.getMetricAggregations).toHaveBeenCalledWith(
          'api_requests',
          expect.objectContaining({
            developerId: mockDeveloper.id,
          })
        );
      });

      it('should handle all query parameters together', async () => {
        mockMetricsService.getMetricAggregations.mockResolvedValue(mockAggregations);
        const startTime = '2024-01-01T00:00:00Z';
        const endTime = '2024-01-31T23:59:59Z';

        await request(app)
          .get(`/api/v1/metrics/api_requests?startTime=${startTime}&endTime=${endTime}&interval=1d`)
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.getMetricAggregations).toHaveBeenCalledWith(
          'api_requests',
          {
            developerId: mockDeveloper.id,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            interval: '1d',
          }
        );
      });

      it('should handle empty aggregations', async () => {
        mockMetricsService.getMetricAggregations.mockResolvedValue([]);

        const response = await request(app)
          .get('/api/v1/metrics/unknown_metric')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(200);
        expect(response.body.aggregations).toEqual([]);
      });
    });

    describe('Authentication Failure', () => {
      it('should return 401 when not authenticated', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({ error: 'Unauthorized' });
        });

        const response = await request(app).get('/api/v1/metrics/api_requests');

        expect(response.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when getting aggregations fails', async () => {
        mockMetricsService.getMetricAggregations.mockRejectedValue(new Error('Query error'));

        const response = await request(app)
          .get('/api/v1/metrics/api_requests')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to get metric aggregations');
      });

      it('should log error when getting aggregations fails', async () => {
        const error = new Error('Query error');
        mockMetricsService.getMetricAggregations.mockRejectedValue(error);

        await request(app)
          .get('/api/v1/metrics/api_requests')
          .set('x-api-key', 'test-key');

        expect(mockLogger.error).toHaveBeenCalledWith('Error getting metric aggregations', { error });
      });
    });
  });

  describe('POST /api/v1/metrics', () => {
    describe('Success Cases', () => {
      it('should return 201 when metric is recorded', async () => {
        mockMetricsService.recordMetric.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: 42 });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      it('should pass metric data to service', async () => {
        mockMetricsService.recordMetric.mockResolvedValue(undefined);

        await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: 42, type: 'counter' });

        expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
          'custom_metric',
          42,
          'counter',
          expect.objectContaining({ developerId: mockDeveloper.id })
        );
      });

      it('should default type to gauge when not provided', async () => {
        mockMetricsService.recordMetric.mockResolvedValue(undefined);

        await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: 42 });

        expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
          'custom_metric',
          42,
          'gauge',
          expect.any(Object)
        );
      });

      it('should pass labels to service', async () => {
        mockMetricsService.recordMetric.mockResolvedValue(undefined);
        const labels = { environment: 'production', region: 'us-east-1' };

        await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: 42, labels });

        expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
          'custom_metric',
          42,
          'gauge',
          expect.objectContaining({ labels })
        );
      });

      it('should handle zero value', async () => {
        mockMetricsService.recordMetric.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: 0 });

        expect(response.status).toBe(201);
        expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
          'custom_metric',
          0,
          'gauge',
          expect.any(Object)
        );
      });

      it('should handle negative value', async () => {
        mockMetricsService.recordMetric.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: -10 });

        expect(response.status).toBe(201);
      });

      it('should handle float value', async () => {
        mockMetricsService.recordMetric.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: 3.14159 });

        expect(response.status).toBe(201);
        expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
          'custom_metric',
          3.14159,
          'gauge',
          expect.any(Object)
        );
      });
    });

    describe('Validation Errors', () => {
      it('should return 400 when name is missing', async () => {
        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ value: 42 });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('name is required');
      });

      it('should return 400 when name is not a string', async () => {
        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 123, value: 42 });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('name is required');
      });

      it('should return 400 when name is empty string', async () => {
        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: '', value: 42 });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('name is required');
      });

      it('should return 400 when value is missing', async () => {
        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('value must be a number');
      });

      it('should return 400 when value is not a number', async () => {
        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: 'not a number' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('value must be a number');
      });

      it('should return 400 when value is null', async () => {
        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: null });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('value must be a number');
      });
    });

    describe('Authentication Failure', () => {
      it('should return 401 when not authenticated', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({ error: 'Unauthorized' });
        });

        const response = await request(app)
          .post('/api/v1/metrics')
          .send({ name: 'custom_metric', value: 42 });

        expect(response.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when recording metric fails', async () => {
        mockMetricsService.recordMetric.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: 42 });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to record metric');
      });

      it('should log error when recording metric fails', async () => {
        const error = new Error('Database error');
        mockMetricsService.recordMetric.mockRejectedValue(error);

        await request(app)
          .post('/api/v1/metrics')
          .set('x-api-key', 'test-key')
          .send({ name: 'custom_metric', value: 42 });

        expect(mockLogger.error).toHaveBeenCalledWith('Error recording metric', { error });
      });
    });
  });

  // ==================== Alerts Endpoints ====================

  describe('GET /api/v1/alerts', () => {
    const mockAlerts = [
      {
        id: 'alert_1',
        developerId: mockDeveloper.id,
        alertName: 'High Error Rate',
        severity: 'warning' as const,
        message: 'Error rate exceeded 5%',
        metricName: 'error_rate',
        thresholdValue: 5,
        actualValue: 8,
        isResolved: false,
        resolvedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        metadata: null,
        createdAt: new Date(),
      },
      {
        id: 'alert_2',
        developerId: mockDeveloper.id,
        alertName: 'Slow Response Time',
        severity: 'critical' as const,
        message: 'Response time exceeded 2000ms',
        metricName: 'response_time',
        thresholdValue: 2000,
        actualValue: 3500,
        isResolved: false,
        resolvedAt: null,
        acknowledgedAt: new Date(),
        acknowledgedBy: 'admin@example.com',
        metadata: null,
        createdAt: new Date(),
      },
    ];

    describe('Success Cases', () => {
      it('should return 200 with active alerts', async () => {
        mockMetricsService.getActiveAlerts.mockResolvedValue(mockAlerts);

        const response = await request(app)
          .get('/api/v1/alerts')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(200);
        expect(response.body.alerts).toHaveLength(2);
      });

      it('should pass developer id to service', async () => {
        mockMetricsService.getActiveAlerts.mockResolvedValue([]);

        await request(app)
          .get('/api/v1/alerts')
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.getActiveAlerts).toHaveBeenCalledWith(mockDeveloper.id);
      });

      it('should return empty array when no alerts', async () => {
        mockMetricsService.getActiveAlerts.mockResolvedValue([]);

        const response = await request(app)
          .get('/api/v1/alerts')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(200);
        expect(response.body.alerts).toEqual([]);
      });

      it('should map alert fields correctly', async () => {
        mockMetricsService.getActiveAlerts.mockResolvedValue(mockAlerts);

        const response = await request(app)
          .get('/api/v1/alerts')
          .set('x-api-key', 'test-key');

        expect(response.body.alerts[0]).toEqual(
          expect.objectContaining({
            id: 'alert_1',
            alertName: 'High Error Rate',
            severity: 'warning',
            message: 'Error rate exceeded 5%',
            metricName: 'error_rate',
            thresholdValue: 5,
            actualValue: 8,
            isResolved: false,
          })
        );
      });

      it('should include acknowledgedAt in response', async () => {
        mockMetricsService.getActiveAlerts.mockResolvedValue(mockAlerts);

        const response = await request(app)
          .get('/api/v1/alerts')
          .set('x-api-key', 'test-key');

        expect(response.body.alerts[1].acknowledgedAt).toBeDefined();
      });
    });

    describe('Authentication Failure', () => {
      it('should return 401 when not authenticated', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({ error: 'Unauthorized' });
        });

        const response = await request(app).get('/api/v1/alerts');

        expect(response.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when getting alerts fails', async () => {
        mockMetricsService.getActiveAlerts.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .get('/api/v1/alerts')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to get alerts');
      });

      it('should log error when getting alerts fails', async () => {
        const error = new Error('Database error');
        mockMetricsService.getActiveAlerts.mockRejectedValue(error);

        await request(app)
          .get('/api/v1/alerts')
          .set('x-api-key', 'test-key');

        expect(mockLogger.error).toHaveBeenCalledWith('Error getting alerts', { error });
      });
    });
  });

  describe('POST /api/v1/alerts/:id/acknowledge', () => {
    const mockAcknowledgedAlert = {
      id: 'alert_1',
      developerId: mockDeveloper.id,
      alertName: 'High Error Rate',
      severity: 'warning' as const,
      message: 'Error rate exceeded 5%',
      metricName: 'error_rate',
      thresholdValue: 5,
      actualValue: 8,
      isResolved: false,
      resolvedAt: null,
      acknowledgedAt: new Date(),
      acknowledgedBy: mockDeveloper.email,
      metadata: null,
      createdAt: new Date(),
    };

    describe('Success Cases', () => {
      it('should return 200 with acknowledged alert', async () => {
        mockMetricsService.acknowledgeAlert.mockResolvedValue(mockAcknowledgedAlert);

        const response = await request(app)
          .post('/api/v1/alerts/alert_1/acknowledge')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(200);
        expect(response.body.alert).toBeDefined();
        expect(response.body.alert.acknowledgedAt).toBeDefined();
      });

      it('should pass alert id and developer email to service', async () => {
        mockMetricsService.acknowledgeAlert.mockResolvedValue(mockAcknowledgedAlert);

        await request(app)
          .post('/api/v1/alerts/alert_1/acknowledge')
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.acknowledgeAlert).toHaveBeenCalledWith(
          'alert_1',
          mockDeveloper.email
        );
      });
    });

    describe('Not Found', () => {
      it('should return 404 when alert not found', async () => {
        mockMetricsService.acknowledgeAlert.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/alerts/nonexistent/acknowledge')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Alert not found');
      });
    });

    describe('Authentication Failure', () => {
      it('should return 401 when not authenticated', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({ error: 'Unauthorized' });
        });

        const response = await request(app).post('/api/v1/alerts/alert_1/acknowledge');

        expect(response.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when acknowledging alert fails', async () => {
        mockMetricsService.acknowledgeAlert.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/alerts/alert_1/acknowledge')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to acknowledge alert');
      });

      it('should log error when acknowledging alert fails', async () => {
        const error = new Error('Database error');
        mockMetricsService.acknowledgeAlert.mockRejectedValue(error);

        await request(app)
          .post('/api/v1/alerts/alert_1/acknowledge')
          .set('x-api-key', 'test-key');

        expect(mockLogger.error).toHaveBeenCalledWith('Error acknowledging alert', { error });
      });
    });
  });

  describe('POST /api/v1/alerts/:id/resolve', () => {
    const mockResolvedAlert = {
      id: 'alert_1',
      developerId: mockDeveloper.id,
      alertName: 'High Error Rate',
      severity: 'warning' as const,
      message: 'Error rate exceeded 5%',
      metricName: 'error_rate',
      thresholdValue: 5,
      actualValue: 8,
      isResolved: true,
      resolvedAt: new Date(),
      acknowledgedAt: null,
      acknowledgedBy: null,
      metadata: null,
      createdAt: new Date(),
    };

    describe('Success Cases', () => {
      it('should return 200 with resolved alert', async () => {
        mockMetricsService.resolveAlert.mockResolvedValue(mockResolvedAlert);

        const response = await request(app)
          .post('/api/v1/alerts/alert_1/resolve')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(200);
        expect(response.body.alert).toBeDefined();
        expect(response.body.alert.isResolved).toBe(true);
      });

      it('should pass alert id to service', async () => {
        mockMetricsService.resolveAlert.mockResolvedValue(mockResolvedAlert);

        await request(app)
          .post('/api/v1/alerts/alert_1/resolve')
          .set('x-api-key', 'test-key');

        expect(mockMetricsService.resolveAlert).toHaveBeenCalledWith('alert_1');
      });
    });

    describe('Not Found', () => {
      it('should return 404 when alert not found', async () => {
        mockMetricsService.resolveAlert.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/alerts/nonexistent/resolve')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Alert not found');
      });
    });

    describe('Authentication Failure', () => {
      it('should return 401 when not authenticated', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({ error: 'Unauthorized' });
        });

        const response = await request(app).post('/api/v1/alerts/alert_1/resolve');

        expect(response.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when resolving alert fails', async () => {
        mockMetricsService.resolveAlert.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/alerts/alert_1/resolve')
          .set('x-api-key', 'test-key');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to resolve alert');
      });

      it('should log error when resolving alert fails', async () => {
        const error = new Error('Database error');
        mockMetricsService.resolveAlert.mockRejectedValue(error);

        await request(app)
          .post('/api/v1/alerts/alert_1/resolve')
          .set('x-api-key', 'test-key');

        expect(mockLogger.error).toHaveBeenCalledWith('Error resolving alert', { error });
      });
    });
  });

  describe('POST /api/v1/alerts', () => {
    const mockCreatedAlert = {
      id: 'alert_new',
      developerId: mockDeveloper.id,
      alertName: 'Custom Alert',
      severity: 'warning' as const,
      message: 'Custom alert message',
      metricName: 'custom_metric',
      thresholdValue: 100,
      actualValue: 150,
      isResolved: false,
      resolvedAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      metadata: { key: 'value' },
      createdAt: new Date(),
    };

    describe('Success Cases', () => {
      it('should return 201 with created alert', async () => {
        mockMetricsService.createAlert.mockResolvedValue(mockCreatedAlert);

        const response = await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            alertName: 'Custom Alert',
            message: 'Custom alert message',
          });

        expect(response.status).toBe(201);
        expect(response.body.alert).toBeDefined();
      });

      it('should pass all alert data to service', async () => {
        mockMetricsService.createAlert.mockResolvedValue(mockCreatedAlert);

        await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            alertName: 'Custom Alert',
            severity: 'critical',
            message: 'Custom alert message',
            metricName: 'custom_metric',
            thresholdValue: 100,
            actualValue: 150,
            metadata: { key: 'value' },
          });

        expect(mockMetricsService.createAlert).toHaveBeenCalledWith({
          developerId: mockDeveloper.id,
          alertName: 'Custom Alert',
          severity: 'critical',
          message: 'Custom alert message',
          metricName: 'custom_metric',
          thresholdValue: 100,
          actualValue: 150,
          metadata: { key: 'value' },
        });
      });

      it('should default severity to warning when not provided', async () => {
        mockMetricsService.createAlert.mockResolvedValue(mockCreatedAlert);

        await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            alertName: 'Custom Alert',
            message: 'Custom alert message',
          });

        expect(mockMetricsService.createAlert).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'warning',
          })
        );
      });

      it('should handle optional fields being undefined', async () => {
        mockMetricsService.createAlert.mockResolvedValue(mockCreatedAlert);

        await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            alertName: 'Minimal Alert',
            message: 'Minimal message',
          });

        expect(mockMetricsService.createAlert).toHaveBeenCalledWith({
          developerId: mockDeveloper.id,
          alertName: 'Minimal Alert',
          severity: 'warning',
          message: 'Minimal message',
          metricName: undefined,
          thresholdValue: undefined,
          actualValue: undefined,
          metadata: undefined,
        });
      });
    });

    describe('Validation Errors', () => {
      it('should return 400 when alertName is missing', async () => {
        const response = await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            message: 'Alert message',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('alertName and message are required');
      });

      it('should return 400 when message is missing', async () => {
        const response = await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            alertName: 'Alert Name',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('alertName and message are required');
      });

      it('should return 400 when both alertName and message are missing', async () => {
        const response = await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('alertName and message are required');
      });

      it('should return 400 when alertName is empty string', async () => {
        const response = await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            alertName: '',
            message: 'Alert message',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('alertName and message are required');
      });

      it('should return 400 when message is empty string', async () => {
        const response = await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            alertName: 'Alert Name',
            message: '',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('alertName and message are required');
      });
    });

    describe('Authentication Failure', () => {
      it('should return 401 when not authenticated', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({ error: 'Unauthorized' });
        });

        const response = await request(app)
          .post('/api/v1/alerts')
          .send({
            alertName: 'Alert Name',
            message: 'Alert message',
          });

        expect(response.status).toBe(401);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when creating alert fails', async () => {
        mockMetricsService.createAlert.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            alertName: 'Custom Alert',
            message: 'Custom alert message',
          });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to create alert');
      });

      it('should log error when creating alert fails', async () => {
        const error = new Error('Database error');
        mockMetricsService.createAlert.mockRejectedValue(error);

        await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({
            alertName: 'Custom Alert',
            message: 'Custom alert message',
          });

        expect(mockLogger.error).toHaveBeenCalledWith('Error creating alert', { error });
      });
    });
  });

  // ==================== Route Configuration ====================

  describe('Route Configuration', () => {
    describe('Health Routes Accept Only GET', () => {
      it('/health should only accept GET', async () => {
        mockMetricsService.healthCheck.mockResolvedValue({
          status: 'healthy' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks: { database: { status: 'healthy', latencyMs: 5 } },
        });

        const postResponse = await request(app).post('/api/v1/health');
        expect(postResponse.status).toBe(404);

        const putResponse = await request(app).put('/api/v1/health');
        expect(putResponse.status).toBe(404);

        const deleteResponse = await request(app).delete('/api/v1/health');
        expect(deleteResponse.status).toBe(404);
      });

      it('/health/live should only accept GET', async () => {
        const postResponse = await request(app).post('/api/v1/health/live');
        expect(postResponse.status).toBe(404);
      });

      it('/health/ready should only accept GET', async () => {
        const postResponse = await request(app).post('/api/v1/health/ready');
        expect(postResponse.status).toBe(404);
      });
    });

    describe('Metrics Routes', () => {
      it('/metrics/system should only accept GET', async () => {
        mockMetricsService.getSystemMetrics.mockReturnValue({
          memory: { used: 50000000, total: 100000000, percentage: 50 },
          process: { uptime: 3600, pid: 12345 },
        });
        mockMetricsService.healthCheck.mockResolvedValue({
          status: 'healthy' as const,
          timestamp: new Date(),
          version: '1.0.0',
          uptime: 3600,
          checks: { database: { status: 'healthy', latencyMs: 5 } },
        });

        const postResponse = await request(app)
          .post('/api/v1/metrics/system')
          .set('x-api-key', 'test-key');
        expect(postResponse.status).toBe(404);
      });

      it('/metrics/business should only accept GET', async () => {
        const postResponse = await request(app)
          .post('/api/v1/metrics/business')
          .set('x-api-key', 'test-key');
        expect(postResponse.status).toBe(404);
      });
    });

    describe('Alert Routes', () => {
      it('/alerts should accept GET and POST', async () => {
        mockMetricsService.getActiveAlerts.mockResolvedValue([]);
        mockMetricsService.createAlert.mockResolvedValue({
          id: 'alert_1',
          developerId: mockDeveloper.id,
          alertName: 'Test',
          severity: 'warning' as const,
          message: 'Test message',
          metricName: null,
          thresholdValue: null,
          actualValue: null,
          isResolved: false,
          resolvedAt: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          metadata: null,
          createdAt: new Date(),
        });

        const getResponse = await request(app)
          .get('/api/v1/alerts')
          .set('x-api-key', 'test-key');
        expect(getResponse.status).toBe(200);

        const postResponse = await request(app)
          .post('/api/v1/alerts')
          .set('x-api-key', 'test-key')
          .send({ alertName: 'Test', message: 'Test message' });
        expect(postResponse.status).toBe(201);

        const putResponse = await request(app)
          .put('/api/v1/alerts')
          .set('x-api-key', 'test-key');
        expect(putResponse.status).toBe(404);
      });

      it('/alerts/:id/acknowledge should only accept POST', async () => {
        mockMetricsService.acknowledgeAlert.mockResolvedValue({
          id: 'alert_1',
          developerId: mockDeveloper.id,
          alertName: 'Test',
          severity: 'warning' as const,
          message: 'Test message',
          metricName: null,
          thresholdValue: null,
          actualValue: null,
          isResolved: false,
          resolvedAt: null,
          acknowledgedAt: new Date(),
          acknowledgedBy: mockDeveloper.email,
          metadata: null,
          createdAt: new Date(),
        });

        const getResponse = await request(app)
          .get('/api/v1/alerts/alert_1/acknowledge')
          .set('x-api-key', 'test-key');
        expect(getResponse.status).toBe(404);

        const postResponse = await request(app)
          .post('/api/v1/alerts/alert_1/acknowledge')
          .set('x-api-key', 'test-key');
        expect(postResponse.status).toBe(200);
      });

      it('/alerts/:id/resolve should only accept POST', async () => {
        mockMetricsService.resolveAlert.mockResolvedValue({
          id: 'alert_1',
          developerId: mockDeveloper.id,
          alertName: 'Test',
          severity: 'warning' as const,
          message: 'Test message',
          metricName: null,
          thresholdValue: null,
          actualValue: null,
          isResolved: true,
          resolvedAt: new Date(),
          acknowledgedAt: null,
          acknowledgedBy: null,
          metadata: null,
          createdAt: new Date(),
        });

        const getResponse = await request(app)
          .get('/api/v1/alerts/alert_1/resolve')
          .set('x-api-key', 'test-key');
        expect(getResponse.status).toBe(404);

        const postResponse = await request(app)
          .post('/api/v1/alerts/alert_1/resolve')
          .set('x-api-key', 'test-key');
        expect(postResponse.status).toBe(200);
      });
    });
  });

  // ==================== Response Format ====================

  describe('Response Format', () => {
    it('should return JSON content type for all endpoints', async () => {
      mockMetricsService.healthCheck.mockResolvedValue({
        status: 'healthy' as const,
        timestamp: new Date(),
        version: '1.0.0',
        uptime: 3600,
        checks: { database: { status: 'healthy', latencyMs: 5 } },
      });

      const response = await request(app).get('/api/v1/health');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return proper error structure', async () => {
      mockMetricsService.healthCheck.mockRejectedValue(new Error('Test error'));

      const response = await request(app).get('/api/v1/health');

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('error');
    });
  });
});
