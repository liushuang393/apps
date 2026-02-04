import express, { Express, NextFunction, Response } from 'express';
import request from 'supertest';

// Mock dependencies before importing the router
jest.mock('../../../services/GDPRService', () => ({
  gdprService: {
    createRequest: jest.fn(),
    listRequests: jest.fn(),
    getRequest: jest.fn(),
    processRequest: jest.fn(),
    cancelRequest: jest.fn(),
    exportCustomerData: jest.fn(),
    deleteCustomerData: jest.fn(),
  },
  GDPRRequestType: {},
  GDPRRequestStatus: {},
}));

jest.mock('../../../middleware', () => ({
  apiKeyAuth: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import gdprRouter from '../../../routes/gdpr';
import { gdprService } from '../../../services/GDPRService';
import { apiKeyAuth, AuthenticatedRequest } from '../../../middleware';
import { logger } from '../../../utils/logger';

const mockGdprService = gdprService as jest.Mocked<typeof gdprService>;
const mockApiKeyAuth = apiKeyAuth as jest.MockedFunction<typeof apiKeyAuth>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('GDPR Routes', () => {
  let app: Express;

  const mockDeveloper = {
    id: 'dev_123',
    email: 'developer@example.com',
    testMode: true,
    stripeAccountId: 'acct_test123',
    webhookSecret: 'whsec_123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGdprRequest = {
    id: 'gdpr_123',
    developerId: 'dev_123',
    customerId: 'cust_123',
    customerEmail: 'customer@example.com',
    requestType: 'data_export' as const,
    status: 'pending' as const,
    requestedBy: 'developer@example.com',
    reason: 'Customer request',
    dataCategories: ['personal', 'transactions'],
    exportFileUrl: null,
    exportFileExpiresAt: null,
    processedAt: null,
    completedAt: null,
    errorMessage: null,
    metadata: null,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
  };

  beforeEach(() => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());

    // Mount the GDPR router
    app.use('/api/v1/gdpr', gdprRouter);

    // Reset all mocks
    jest.clearAllMocks();

    // Setup apiKeyAuth to pass through with mock developer
    mockApiKeyAuth.mockImplementation(async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.developer = mockDeveloper;
      next();
    });
  });

  describe('POST /api/v1/gdpr/requests', () => {
    describe('Input Validation', () => {
      it('should return 400 when customerEmail is missing', async () => {
        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            requestType: 'data_export',
          });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'customerEmail is required' });
      });

      it('should return 400 when customerEmail is not a string', async () => {
        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 123,
            requestType: 'data_export',
          });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'customerEmail is required' });
      });

      it('should return 400 when customerEmail is empty string', async () => {
        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: '',
            requestType: 'data_export',
          });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'customerEmail is required' });
      });

      it('should return 400 when requestType is missing', async () => {
        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid requestType');
        expect(response.body.error).toContain('data_export');
        expect(response.body.error).toContain('data_deletion');
        expect(response.body.error).toContain('data_rectification');
      });

      it('should return 400 when requestType is invalid', async () => {
        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'invalid_type',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid requestType');
      });
    });

    describe('Successful Request Creation', () => {
      it('should create a GDPR request with data_export type', async () => {
        mockGdprService.createRequest.mockResolvedValue(mockGdprRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'data_export',
            reason: 'Customer request',
          });

        expect(response.status).toBe(201);
        expect(response.body.request).toEqual({
          id: mockGdprRequest.id,
          customerEmail: mockGdprRequest.customerEmail,
          requestType: mockGdprRequest.requestType,
          status: mockGdprRequest.status,
          createdAt: mockGdprRequest.createdAt.toISOString(),
        });
      });

      it('should create a GDPR request with data_deletion type', async () => {
        const deletionRequest = { ...mockGdprRequest, requestType: 'data_deletion' as const };
        mockGdprService.createRequest.mockResolvedValue(deletionRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'data_deletion',
          });

        expect(response.status).toBe(201);
        expect(response.body.request.requestType).toBe('data_deletion');
      });

      it('should create a GDPR request with data_rectification type', async () => {
        const rectificationRequest = { ...mockGdprRequest, requestType: 'data_rectification' as const };
        mockGdprService.createRequest.mockResolvedValue(rectificationRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'data_rectification',
          });

        expect(response.status).toBe(201);
        expect(response.body.request.requestType).toBe('data_rectification');
      });

      it('should pass correct parameters to gdprService.createRequest', async () => {
        mockGdprService.createRequest.mockResolvedValue(mockGdprRequest);

        await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'data_export',
            reason: 'Customer request',
            dataCategories: ['personal', 'transactions'],
          });

        expect(mockGdprService.createRequest).toHaveBeenCalledWith({
          developerId: mockDeveloper.id,
          customerEmail: 'customer@example.com',
          requestType: 'data_export',
          requestedBy: mockDeveloper.email,
          reason: 'Customer request',
          dataCategories: ['personal', 'transactions'],
        });
      });

      it('should handle optional fields', async () => {
        mockGdprService.createRequest.mockResolvedValue(mockGdprRequest);

        await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'data_export',
          });

        expect(mockGdprService.createRequest).toHaveBeenCalledWith({
          developerId: mockDeveloper.id,
          customerEmail: 'customer@example.com',
          requestType: 'data_export',
          requestedBy: mockDeveloper.email,
          reason: undefined,
          dataCategories: undefined,
        });
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when service throws an error', async () => {
        mockGdprService.createRequest.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'data_export',
          });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to create GDPR request' });
      });

      it('should log error when service throws', async () => {
        const error = new Error('Database error');
        mockGdprService.createRequest.mockRejectedValue(error);

        await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'data_export',
          });

        expect(mockLogger.error).toHaveBeenCalledWith('Error creating GDPR request', { error });
      });
    });

    describe('Authentication', () => {
      it('should apply apiKeyAuth middleware', async () => {
        mockGdprService.createRequest.mockResolvedValue(mockGdprRequest);

        await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'data_export',
          });

        expect(mockApiKeyAuth).toHaveBeenCalled();
      });

      it('should return 401 when authentication fails', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({ error: 'Unauthorized' });
        });

        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType: 'data_export',
          });

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'Unauthorized' });
      });
    });
  });

  describe('GET /api/v1/gdpr/requests', () => {
    describe('Successful Listing', () => {
      it('should list GDPR requests with default pagination', async () => {
        const requests = [mockGdprRequest, { ...mockGdprRequest, id: 'gdpr_456' }];
        mockGdprService.listRequests.mockResolvedValue({ requests, total: 2 });

        const response = await request(app)
          .get('/api/v1/gdpr/requests');

        expect(response.status).toBe(200);
        expect(response.body.requests).toHaveLength(2);
        expect(response.body.total).toBe(2);
        expect(response.body.limit).toBe(50);
        expect(response.body.offset).toBe(0);
      });

      it('should pass custom pagination parameters', async () => {
        mockGdprService.listRequests.mockResolvedValue({ requests: [], total: 0 });

        await request(app)
          .get('/api/v1/gdpr/requests')
          .query({ limit: '10', offset: '20' });

        expect(mockGdprService.listRequests).toHaveBeenCalledWith(
          mockDeveloper.id,
          { limit: 10, offset: 20, status: undefined }
        );
      });

      it('should pass status filter parameter', async () => {
        mockGdprService.listRequests.mockResolvedValue({ requests: [], total: 0 });

        await request(app)
          .get('/api/v1/gdpr/requests')
          .query({ status: 'pending' });

        expect(mockGdprService.listRequests).toHaveBeenCalledWith(
          mockDeveloper.id,
          { limit: 50, offset: 0, status: 'pending' }
        );
      });

      it('should return mapped request objects', async () => {
        const requestWithDates = {
          ...mockGdprRequest,
          processedAt: new Date('2024-01-15T11:00:00Z'),
          completedAt: new Date('2024-01-15T12:00:00Z'),
        };
        mockGdprService.listRequests.mockResolvedValue({ requests: [requestWithDates], total: 1 });

        const response = await request(app)
          .get('/api/v1/gdpr/requests');

        expect(response.body.requests[0]).toEqual({
          id: mockGdprRequest.id,
          customerEmail: mockGdprRequest.customerEmail,
          requestType: mockGdprRequest.requestType,
          status: mockGdprRequest.status,
          createdAt: mockGdprRequest.createdAt.toISOString(),
          processedAt: requestWithDates.processedAt.toISOString(),
          completedAt: requestWithDates.completedAt.toISOString(),
        });
      });

      it('should handle invalid pagination values gracefully', async () => {
        mockGdprService.listRequests.mockResolvedValue({ requests: [], total: 0 });

        await request(app)
          .get('/api/v1/gdpr/requests')
          .query({ limit: 'invalid', offset: 'invalid' });

        // NaN values should default to 50 and 0 based on parseInt behavior with || fallback
        expect(mockGdprService.listRequests).toHaveBeenCalledWith(
          mockDeveloper.id,
          { limit: 50, offset: 0, status: undefined }
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when service throws an error', async () => {
        mockGdprService.listRequests.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .get('/api/v1/gdpr/requests');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to list GDPR requests' });
      });

      it('should log error when service throws', async () => {
        const error = new Error('Database error');
        mockGdprService.listRequests.mockRejectedValue(error);

        await request(app)
          .get('/api/v1/gdpr/requests');

        expect(mockLogger.error).toHaveBeenCalledWith('Error listing GDPR requests', { error });
      });
    });
  });

  describe('GET /api/v1/gdpr/requests/:id', () => {
    describe('Successful Request Retrieval', () => {
      it('should return GDPR request by ID', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);

        const response = await request(app)
          .get('/api/v1/gdpr/requests/gdpr_123');

        expect(response.status).toBe(200);
        expect(response.body.request).toBeDefined();
        expect(response.body.request.id).toBe(mockGdprRequest.id);
      });

      it('should pass correct ID to service', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);

        await request(app)
          .get('/api/v1/gdpr/requests/gdpr_xyz');

        expect(mockGdprService.getRequest).toHaveBeenCalledWith('gdpr_xyz');
      });
    });

    describe('Not Found', () => {
      it('should return 404 when request not found', async () => {
        mockGdprService.getRequest.mockResolvedValue(null);

        const response = await request(app)
          .get('/api/v1/gdpr/requests/gdpr_nonexistent');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'GDPR request not found' });
      });
    });

    describe('Access Control', () => {
      it('should return 403 when request belongs to different developer', async () => {
        const otherDeveloperRequest = {
          ...mockGdprRequest,
          developerId: 'dev_other',
        };
        mockGdprService.getRequest.mockResolvedValue(otherDeveloperRequest);

        const response = await request(app)
          .get('/api/v1/gdpr/requests/gdpr_123');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Access denied' });
      });

      it('should allow access when developer IDs match', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);

        const response = await request(app)
          .get('/api/v1/gdpr/requests/gdpr_123');

        expect(response.status).toBe(200);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when service throws an error', async () => {
        mockGdprService.getRequest.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .get('/api/v1/gdpr/requests/gdpr_123');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to get GDPR request' });
      });

      it('should log error when service throws', async () => {
        const error = new Error('Database error');
        mockGdprService.getRequest.mockRejectedValue(error);

        await request(app)
          .get('/api/v1/gdpr/requests/gdpr_123');

        expect(mockLogger.error).toHaveBeenCalledWith('Error getting GDPR request', { error });
      });
    });
  });

  describe('POST /api/v1/gdpr/requests/:id/process', () => {
    describe('Successful Processing', () => {
      it('should process a pending GDPR request', async () => {
        const processedRequest = {
          ...mockGdprRequest,
          status: 'completed' as const,
          completedAt: new Date('2024-01-15T12:00:00Z'),
          exportFileUrl: 'https://example.com/export.json',
          exportFileExpiresAt: new Date('2024-01-22T12:00:00Z'),
        };
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);
        mockGdprService.processRequest.mockResolvedValue(processedRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/process');

        expect(response.status).toBe(200);
        expect(response.body.request).toEqual({
          id: processedRequest.id,
          status: processedRequest.status,
          completedAt: processedRequest.completedAt.toISOString(),
          exportFileUrl: processedRequest.exportFileUrl,
          exportFileExpiresAt: processedRequest.exportFileExpiresAt.toISOString(),
        });
      });

      it('should call processRequest with correct ID', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);
        mockGdprService.processRequest.mockResolvedValue({
          ...mockGdprRequest,
          status: 'completed' as const,
          completedAt: new Date(),
        });

        await request(app)
          .post('/api/v1/gdpr/requests/gdpr_xyz/process');

        expect(mockGdprService.processRequest).toHaveBeenCalledWith('gdpr_xyz');
      });
    });

    describe('Validation', () => {
      it('should return 404 when request not found', async () => {
        mockGdprService.getRequest.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_nonexistent/process');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'GDPR request not found' });
        expect(mockGdprService.processRequest).not.toHaveBeenCalled();
      });

      it('should return 403 when request belongs to different developer', async () => {
        const otherDeveloperRequest = {
          ...mockGdprRequest,
          developerId: 'dev_other',
        };
        mockGdprService.getRequest.mockResolvedValue(otherDeveloperRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/process');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Access denied' });
        expect(mockGdprService.processRequest).not.toHaveBeenCalled();
      });

      it('should return 400 when request is not pending', async () => {
        const processedRequest = {
          ...mockGdprRequest,
          status: 'completed' as const,
        };
        mockGdprService.getRequest.mockResolvedValue(processedRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/process');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Request has already been processed' });
        expect(mockGdprService.processRequest).not.toHaveBeenCalled();
      });

      it('should return 400 for requests with processing status', async () => {
        const processingRequest = {
          ...mockGdprRequest,
          status: 'processing' as const,
        };
        mockGdprService.getRequest.mockResolvedValue(processingRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/process');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Request has already been processed' });
      });

      it('should return 400 for failed requests', async () => {
        const failedRequest = {
          ...mockGdprRequest,
          status: 'failed' as const,
        };
        mockGdprService.getRequest.mockResolvedValue(failedRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/process');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Request has already been processed' });
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when service throws an error', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);
        mockGdprService.processRequest.mockRejectedValue(new Error('Processing failed'));

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/process');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to process GDPR request' });
      });

      it('should log error when service throws', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);
        const error = new Error('Processing failed');
        mockGdprService.processRequest.mockRejectedValue(error);

        await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/process');

        expect(mockLogger.error).toHaveBeenCalledWith('Error processing GDPR request', { error });
      });
    });
  });

  describe('POST /api/v1/gdpr/requests/:id/cancel', () => {
    describe('Successful Cancellation', () => {
      it('should cancel a pending GDPR request', async () => {
        const cancelledRequest = {
          ...mockGdprRequest,
          status: 'cancelled' as const,
        };
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);
        mockGdprService.cancelRequest.mockResolvedValue(cancelledRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/cancel');

        expect(response.status).toBe(200);
        expect(response.body.request.status).toBe('cancelled');
      });

      it('should call cancelRequest with correct ID', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);
        mockGdprService.cancelRequest.mockResolvedValue({
          ...mockGdprRequest,
          status: 'cancelled' as const,
        });

        await request(app)
          .post('/api/v1/gdpr/requests/gdpr_xyz/cancel');

        expect(mockGdprService.cancelRequest).toHaveBeenCalledWith('gdpr_xyz');
      });
    });

    describe('Validation', () => {
      it('should return 404 when request not found', async () => {
        mockGdprService.getRequest.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_nonexistent/cancel');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'GDPR request not found' });
        expect(mockGdprService.cancelRequest).not.toHaveBeenCalled();
      });

      it('should return 403 when request belongs to different developer', async () => {
        const otherDeveloperRequest = {
          ...mockGdprRequest,
          developerId: 'dev_other',
        };
        mockGdprService.getRequest.mockResolvedValue(otherDeveloperRequest);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/cancel');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Access denied' });
        expect(mockGdprService.cancelRequest).not.toHaveBeenCalled();
      });

      it('should return 400 when request cannot be cancelled', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);
        mockGdprService.cancelRequest.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/cancel');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Cannot cancel this request' });
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when service throws an error', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);
        mockGdprService.cancelRequest.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/cancel');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to cancel GDPR request' });
      });

      it('should log error when service throws', async () => {
        mockGdprService.getRequest.mockResolvedValue(mockGdprRequest);
        const error = new Error('Database error');
        mockGdprService.cancelRequest.mockRejectedValue(error);

        await request(app)
          .post('/api/v1/gdpr/requests/gdpr_123/cancel');

        expect(mockLogger.error).toHaveBeenCalledWith('Error cancelling GDPR request', { error });
      });
    });
  });

  describe('POST /api/v1/gdpr/export', () => {
    const mockExportData = {
      customer: {
        id: 'cust_123',
        email: 'customer@example.com',
        name: 'John Doe',
        stripeCustomerId: 'cus_stripe123',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
      entitlements: [
        {
          id: 'ent_123',
          productName: 'Premium Plan',
          type: 'subscription',
          status: 'active',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          expiresAt: null,
        },
      ],
      invoices: [
        {
          invoiceNumber: 'INV-001',
          amount: 9900,
          currency: 'USD',
          status: 'paid',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ],
      legalAcceptances: [],
      auditLogs: [],
      exportedAt: new Date('2024-01-15T10:00:00Z'),
    };

    describe('Input Validation', () => {
      it('should return 400 when customerEmail is missing', async () => {
        const response = await request(app)
          .post('/api/v1/gdpr/export')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'customerEmail is required' });
      });

      it('should return 400 when customerEmail is not a string', async () => {
        const response = await request(app)
          .post('/api/v1/gdpr/export')
          .send({ customerEmail: 123 });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'customerEmail is required' });
      });

      it('should return 400 when customerEmail is empty string', async () => {
        const response = await request(app)
          .post('/api/v1/gdpr/export')
          .send({ customerEmail: '' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'customerEmail is required' });
      });
    });

    describe('Successful Export', () => {
      it('should export customer data', async () => {
        mockGdprService.exportCustomerData.mockResolvedValue(mockExportData);

        const response = await request(app)
          .post('/api/v1/gdpr/export')
          .send({ customerEmail: 'customer@example.com' });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.customer.email).toBe('customer@example.com');
      });

      it('should pass correct parameters to exportCustomerData', async () => {
        mockGdprService.exportCustomerData.mockResolvedValue(mockExportData);

        await request(app)
          .post('/api/v1/gdpr/export')
          .send({ customerEmail: 'customer@example.com' });

        expect(mockGdprService.exportCustomerData).toHaveBeenCalledWith(
          mockDeveloper.id,
          'customer@example.com'
        );
      });
    });

    describe('Customer Not Found', () => {
      it('should return 404 when customer not found', async () => {
        mockGdprService.exportCustomerData.mockRejectedValue(new Error('Customer not found'));

        const response = await request(app)
          .post('/api/v1/gdpr/export')
          .send({ customerEmail: 'nonexistent@example.com' });

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Customer not found' });
      });
    });

    describe('Error Handling', () => {
      it('should return 500 for other errors', async () => {
        mockGdprService.exportCustomerData.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/gdpr/export')
          .send({ customerEmail: 'customer@example.com' });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to export customer data' });
      });

      it('should log error for non-customer-not-found errors', async () => {
        const error = new Error('Database error');
        mockGdprService.exportCustomerData.mockRejectedValue(error);

        await request(app)
          .post('/api/v1/gdpr/export')
          .send({ customerEmail: 'customer@example.com' });

        expect(mockLogger.error).toHaveBeenCalledWith('Error exporting customer data', { error });
      });

      it('should not log error for customer not found', async () => {
        mockGdprService.exportCustomerData.mockRejectedValue(new Error('Customer not found'));

        await request(app)
          .post('/api/v1/gdpr/export')
          .send({ customerEmail: 'nonexistent@example.com' });

        expect(mockLogger.error).not.toHaveBeenCalled();
      });
    });
  });

  describe('DELETE /api/v1/gdpr/customer', () => {
    const mockDeletionResult = {
      deletedRecords: 5,
      anonymizedRecords: 1,
    };

    describe('Input Validation', () => {
      it('should return 400 when customerEmail is missing', async () => {
        const response = await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'customerEmail is required' });
      });

      it('should return 400 when customerEmail is not a string', async () => {
        const response = await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 123 });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'customerEmail is required' });
      });

      it('should return 400 when customerEmail is empty string', async () => {
        const response = await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: '' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'customerEmail is required' });
      });
    });

    describe('Successful Deletion', () => {
      it('should delete customer data', async () => {
        mockGdprService.deleteCustomerData.mockResolvedValue(mockDeletionResult);

        const response = await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 'customer@example.com' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          success: true,
          deletedRecords: mockDeletionResult.deletedRecords,
          anonymizedRecords: mockDeletionResult.anonymizedRecords,
        });
      });

      it('should pass keepTransactionRecords=true by default', async () => {
        mockGdprService.deleteCustomerData.mockResolvedValue(mockDeletionResult);

        await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 'customer@example.com' });

        expect(mockGdprService.deleteCustomerData).toHaveBeenCalledWith(
          mockDeveloper.id,
          'customer@example.com',
          { keepTransactionRecords: true }
        );
      });

      it('should pass keepTransactionRecords=true when explicitly set', async () => {
        mockGdprService.deleteCustomerData.mockResolvedValue(mockDeletionResult);

        await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 'customer@example.com', keepTransactionRecords: true });

        expect(mockGdprService.deleteCustomerData).toHaveBeenCalledWith(
          mockDeveloper.id,
          'customer@example.com',
          { keepTransactionRecords: true }
        );
      });

      it('should pass keepTransactionRecords=false when explicitly set to false', async () => {
        mockGdprService.deleteCustomerData.mockResolvedValue(mockDeletionResult);

        await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 'customer@example.com', keepTransactionRecords: false });

        expect(mockGdprService.deleteCustomerData).toHaveBeenCalledWith(
          mockDeveloper.id,
          'customer@example.com',
          { keepTransactionRecords: false }
        );
      });

      it('should handle undefined keepTransactionRecords as true', async () => {
        mockGdprService.deleteCustomerData.mockResolvedValue(mockDeletionResult);

        await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 'customer@example.com', keepTransactionRecords: undefined });

        expect(mockGdprService.deleteCustomerData).toHaveBeenCalledWith(
          mockDeveloper.id,
          'customer@example.com',
          { keepTransactionRecords: true }
        );
      });
    });

    describe('Customer Not Found', () => {
      it('should return 404 when customer not found', async () => {
        mockGdprService.deleteCustomerData.mockRejectedValue(new Error('Customer not found'));

        const response = await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 'nonexistent@example.com' });

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Customer not found' });
      });
    });

    describe('Error Handling', () => {
      it('should return 500 for other errors', async () => {
        mockGdprService.deleteCustomerData.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 'customer@example.com' });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to delete customer data' });
      });

      it('should log error for non-customer-not-found errors', async () => {
        const error = new Error('Database error');
        mockGdprService.deleteCustomerData.mockRejectedValue(error);

        await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 'customer@example.com' });

        expect(mockLogger.error).toHaveBeenCalledWith('Error deleting customer data', { error });
      });

      it('should not log error for customer not found', async () => {
        mockGdprService.deleteCustomerData.mockRejectedValue(new Error('Customer not found'));

        await request(app)
          .delete('/api/v1/gdpr/customer')
          .send({ customerEmail: 'nonexistent@example.com' });

        expect(mockLogger.error).not.toHaveBeenCalled();
      });
    });
  });

  describe('Route Configuration', () => {
    it('should reject non-POST methods on /requests', async () => {
      const methods = ['put', 'delete', 'patch'] as const;

      for (const method of methods) {
        const response = await request(app)[method]('/api/v1/gdpr/requests');
        expect(response.status).toBe(404);
      }
    });

    it('should reject non-POST methods on /requests/:id/process', async () => {
      const methods = ['get', 'put', 'delete', 'patch'] as const;

      for (const method of methods) {
        const response = await request(app)[method]('/api/v1/gdpr/requests/gdpr_123/process');
        expect(response.status).toBe(404);
      }
    });

    it('should reject non-POST methods on /requests/:id/cancel', async () => {
      const methods = ['get', 'put', 'delete', 'patch'] as const;

      for (const method of methods) {
        const response = await request(app)[method]('/api/v1/gdpr/requests/gdpr_123/cancel');
        expect(response.status).toBe(404);
      }
    });

    it('should reject non-DELETE methods on /customer', async () => {
      const methods = ['get', 'post', 'put', 'patch'] as const;

      for (const method of methods) {
        const response = await request(app)[method]('/api/v1/gdpr/customer');
        expect(response.status).toBe(404);
      }
    });

    it('should reject non-POST methods on /export', async () => {
      const methods = ['get', 'put', 'delete', 'patch'] as const;

      for (const method of methods) {
        const response = await request(app)[method]('/api/v1/gdpr/export');
        expect(response.status).toBe(404);
      }
    });
  });

  describe('Response Format', () => {
    it('should return JSON content type', async () => {
      mockGdprService.createRequest.mockResolvedValue(mockGdprRequest);

      const response = await request(app)
        .post('/api/v1/gdpr/requests')
        .send({
          customerEmail: 'customer@example.com',
          requestType: 'data_export',
        });

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return properly formatted dates in ISO format', async () => {
      mockGdprService.createRequest.mockResolvedValue(mockGdprRequest);

      const response = await request(app)
        .post('/api/v1/gdpr/requests')
        .send({
          customerEmail: 'customer@example.com',
          requestType: 'data_export',
        });

      expect(response.body.request.createdAt).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in customerEmail', async () => {
      mockGdprService.createRequest.mockResolvedValue(mockGdprRequest);

      const response = await request(app)
        .post('/api/v1/gdpr/requests')
        .send({
          customerEmail: 'user+tag@example.com',
          requestType: 'data_export',
        });

      expect(response.status).toBe(201);
      expect(mockGdprService.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({ customerEmail: 'user+tag@example.com' })
      );
    });

    it('should handle unicode in reason field', async () => {
      mockGdprService.createRequest.mockResolvedValue(mockGdprRequest);

      const response = await request(app)
        .post('/api/v1/gdpr/requests')
        .send({
          customerEmail: 'customer@example.com',
          requestType: 'data_export',
          reason: 'GDPR request 日本語 émojis 🎉',
        });

      expect(response.status).toBe(201);
      expect(mockGdprService.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'GDPR request 日本語 émojis 🎉' })
      );
    });

    it('should handle large dataCategories array', async () => {
      mockGdprService.createRequest.mockResolvedValue(mockGdprRequest);
      const categories = Array(100).fill(null).map((_, i) => `category_${i}`);

      const response = await request(app)
        .post('/api/v1/gdpr/requests')
        .send({
          customerEmail: 'customer@example.com',
          requestType: 'data_export',
          dataCategories: categories,
        });

      expect(response.status).toBe(201);
      expect(mockGdprService.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({ dataCategories: categories })
      );
    });

    it('should handle concurrent requests', async () => {
      mockGdprService.createRequest.mockImplementation(async (params) => ({
        ...mockGdprRequest,
        id: `gdpr_${params.customerEmail.replace('@', '_')}`,
      }));

      const emails = ['a@example.com', 'b@example.com', 'c@example.com'];
      const requests = emails.map((email) =>
        request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: email,
            requestType: 'data_export',
          })
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(201);
      });

      expect(mockGdprService.createRequest).toHaveBeenCalledTimes(3);
    });

    it('should handle request with all valid request types', async () => {
      const requestTypes = ['data_export', 'data_deletion', 'data_rectification'] as const;

      for (const requestType of requestTypes) {
        jest.clearAllMocks();
        mockGdprService.createRequest.mockResolvedValue({
          ...mockGdprRequest,
          requestType,
        });

        const response = await request(app)
          .post('/api/v1/gdpr/requests')
          .send({
            customerEmail: 'customer@example.com',
            requestType,
          });

        expect(response.status).toBe(201);
        expect(response.body.request.requestType).toBe(requestType);
      }
    });
  });
});
