import express, { Express, Response, NextFunction } from 'express';
import request from 'supertest';
import entitlementsRouter from '../../../routes/entitlements';
import { entitlementService } from '../../../services';
import { AuthenticatedRequest } from '../../../middleware';

// Mock the services
jest.mock('../../../services', () => ({
  entitlementService: {
    verifyUnlockToken: jest.fn(),
    checkEntitlementStatus: jest.fn(),
    getEntitlement: jest.fn(),
    getEntitlementsByCustomerId: jest.fn(),
    getActiveEntitlementsByCustomerId: jest.fn(),
  },
}));

// Mock the middleware
jest.mock('../../../middleware', () => ({
  apiKeyAuth: jest.fn((req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      res.status(401).json({
        error: {
          code: 'unauthorized',
          message: 'Missing API key. Include x-api-key header.',
          type: 'authentication_error',
        },
      });
      return;
    }
    if (apiKey !== 'valid-api-key') {
      res.status(401).json({
        error: {
          code: 'unauthorized',
          message: 'Invalid API key.',
          type: 'authentication_error',
        },
      });
      return;
    }
    req.developer = {
      id: 'dev-123',
      email: 'dev@example.com',
      testMode: true,
      stripeAccountId: 'acct_123',
      webhookSecret: 'whsec_123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    next();
  }),
  optionalApiKeyAuth: jest.fn((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey === 'valid-api-key') {
      req.developer = {
        id: 'dev-123',
        email: 'dev@example.com',
        testMode: true,
        stripeAccountId: 'acct_123',
        webhookSecret: 'whsec_123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    next();
  }),
  AuthenticatedRequest: {},
}));

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Entitlements Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/entitlements', entitlementsRouter);
    jest.clearAllMocks();
  });

  describe('GET /api/v1/entitlements/verify', () => {
    describe('validation errors', () => {
      it('should return 400 when neither unlock_token nor purchase_intent_id is provided', async () => {
        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .expect(400);

        expect(response.body).toEqual({
          error: {
            code: 'invalid_request',
            message: 'Either unlock_token or purchase_intent_id is required',
            type: 'invalid_request_error',
          },
        });
      });
    });

    describe('verify by unlock_token', () => {
      it('should return 401 when unlock_token is invalid', async () => {
        (entitlementService.verifyUnlockToken as jest.Mock).mockResolvedValue({
          valid: false,
          error: 'Token has expired',
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ unlock_token: 'invalid-token' })
          .expect(401);

        expect(response.body).toEqual({
          error: {
            code: 'invalid_token',
            message: 'Token has expired',
            type: 'authentication_error',
          },
        });
        expect(entitlementService.verifyUnlockToken).toHaveBeenCalledWith('invalid-token');
      });

      it('should return 401 with default message when error is not provided', async () => {
        (entitlementService.verifyUnlockToken as jest.Mock).mockResolvedValue({
          valid: false,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ unlock_token: 'invalid-token' })
          .expect(401);

        expect(response.body).toEqual({
          error: {
            code: 'invalid_token',
            message: 'Invalid unlock token',
            type: 'authentication_error',
          },
        });
      });

      it('should return entitlement status when unlock_token is valid', async () => {
        const expiresAt = new Date('2025-12-31T23:59:59.000Z');
        (entitlementService.verifyUnlockToken as jest.Mock).mockResolvedValue({
          valid: true,
          status: {
            status: 'active',
            hasAccess: true,
            entitlementId: 'ent-123',
            productId: 'prod-456',
            expiresAt,
          },
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ unlock_token: 'valid-token' })
          .expect(200);

        expect(response.body).toEqual({
          status: 'active',
          has_access: true,
          entitlement_id: 'ent-123',
          product_id: 'prod-456',
          expires_at: '2025-12-31T23:59:59.000Z',
        });
      });

      it('should return null expires_at when entitlement has no expiration', async () => {
        (entitlementService.verifyUnlockToken as jest.Mock).mockResolvedValue({
          valid: true,
          status: {
            status: 'active',
            hasAccess: true,
            entitlementId: 'ent-123',
            productId: 'prod-456',
            expiresAt: null,
          },
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ unlock_token: 'valid-token' })
          .expect(200);

        expect(response.body.expires_at).toBeNull();
      });
    });

    describe('verify by purchase_intent_id', () => {
      it('should return 404 when no entitlement found for purchase_intent_id', async () => {
        (entitlementService.checkEntitlementStatus as jest.Mock).mockResolvedValue({
          hasAccess: false,
          status: 'expired',
          entitlementId: null,
          productId: null,
          expiresAt: null,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ purchase_intent_id: 'pi_nonexistent' })
          .expect(404);

        expect(response.body).toEqual({
          error: {
            code: 'resource_not_found',
            message: 'No entitlement found for this purchase_intent_id',
            type: 'invalid_request_error',
          },
        });
        expect(entitlementService.checkEntitlementStatus).toHaveBeenCalledWith('pi_nonexistent');
      });

      it('should return entitlement status when purchase_intent_id is valid', async () => {
        const expiresAt = new Date('2025-06-30T00:00:00.000Z');
        (entitlementService.checkEntitlementStatus as jest.Mock).mockResolvedValue({
          status: 'active',
          hasAccess: true,
          entitlementId: 'ent-789',
          productId: 'prod-abc',
          expiresAt,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ purchase_intent_id: 'pi_valid123' })
          .expect(200);

        expect(response.body).toEqual({
          status: 'active',
          has_access: true,
          entitlement_id: 'ent-789',
          product_id: 'prod-abc',
          expires_at: '2025-06-30T00:00:00.000Z',
        });
      });

      it('should return null expires_at when no expiration date', async () => {
        (entitlementService.checkEntitlementStatus as jest.Mock).mockResolvedValue({
          status: 'active',
          hasAccess: true,
          entitlementId: 'ent-789',
          productId: 'prod-abc',
          expiresAt: null,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ purchase_intent_id: 'pi_valid123' })
          .expect(200);

        expect(response.body.expires_at).toBeNull();
      });

      it('should return suspended status correctly', async () => {
        (entitlementService.checkEntitlementStatus as jest.Mock).mockResolvedValue({
          status: 'suspended',
          hasAccess: false,
          entitlementId: 'ent-789',
          productId: 'prod-abc',
          expiresAt: null,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ purchase_intent_id: 'pi_suspended' })
          .expect(200);

        expect(response.body).toEqual({
          status: 'suspended',
          has_access: false,
          entitlement_id: 'ent-789',
          product_id: 'prod-abc',
          expires_at: null,
        });
      });
    });

    describe('error handling', () => {
      it('should return 500 when verifyUnlockToken throws an error', async () => {
        (entitlementService.verifyUnlockToken as jest.Mock).mockRejectedValue(
          new Error('Database connection failed')
        );

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ unlock_token: 'some-token' })
          .expect(500);

        expect(response.body).toEqual({
          error: {
            code: 'internal_error',
            message: 'Failed to verify entitlement',
            type: 'api_error',
          },
        });
      });

      it('should return 500 when checkEntitlementStatus throws an error', async () => {
        (entitlementService.checkEntitlementStatus as jest.Mock).mockRejectedValue(
          new Error('Database connection failed')
        );

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ purchase_intent_id: 'pi_test' })
          .expect(500);

        expect(response.body).toEqual({
          error: {
            code: 'internal_error',
            message: 'Failed to verify entitlement',
            type: 'api_error',
          },
        });
      });
    });

    describe('authentication', () => {
      it('should work without API key (optionalApiKeyAuth)', async () => {
        (entitlementService.checkEntitlementStatus as jest.Mock).mockResolvedValue({
          status: 'active',
          hasAccess: true,
          entitlementId: 'ent-123',
          productId: 'prod-456',
          expiresAt: null,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ purchase_intent_id: 'pi_test' })
          .expect(200);

        expect(response.body.status).toBe('active');
      });

      it('should work with valid API key', async () => {
        (entitlementService.checkEntitlementStatus as jest.Mock).mockResolvedValue({
          status: 'active',
          hasAccess: true,
          entitlementId: 'ent-123',
          productId: 'prod-456',
          expiresAt: null,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .set('x-api-key', 'valid-api-key')
          .query({ purchase_intent_id: 'pi_test' })
          .expect(200);

        expect(response.body.status).toBe('active');
      });
    });
  });

  describe('GET /api/v1/entitlements/:id', () => {
    describe('authentication', () => {
      it('should return 401 when API key is missing', async () => {
        const response = await request(app)
          .get('/api/v1/entitlements/ent-123')
          .expect(401);

        expect(response.body).toEqual({
          error: {
            code: 'unauthorized',
            message: 'Missing API key. Include x-api-key header.',
            type: 'authentication_error',
          },
        });
      });

      it('should return 401 when API key is invalid', async () => {
        const response = await request(app)
          .get('/api/v1/entitlements/ent-123')
          .set('x-api-key', 'invalid-key')
          .expect(401);

        expect(response.body).toEqual({
          error: {
            code: 'unauthorized',
            message: 'Invalid API key.',
            type: 'authentication_error',
          },
        });
      });
    });

    describe('with valid authentication', () => {
      it('should return 404 when entitlement is not found', async () => {
        (entitlementService.getEntitlement as jest.Mock).mockResolvedValue(null);

        const response = await request(app)
          .get('/api/v1/entitlements/ent-nonexistent')
          .set('x-api-key', 'valid-api-key')
          .expect(404);

        expect(response.body).toEqual({
          error: {
            code: 'resource_not_found',
            message: 'Entitlement not found',
            type: 'invalid_request_error',
          },
        });
        expect(entitlementService.getEntitlement).toHaveBeenCalledWith('ent-nonexistent');
      });

      it('should return entitlement when found', async () => {
        const createdAt = new Date('2024-01-15T10:00:00.000Z');
        const updatedAt = new Date('2024-01-20T15:30:00.000Z');
        const expiresAt = new Date('2025-01-15T10:00:00.000Z');

        (entitlementService.getEntitlement as jest.Mock).mockResolvedValue({
          id: 'ent-123',
          customerId: 'cus-456',
          productId: 'prod-789',
          purchaseIntentId: 'pi_abc123',
          paymentId: 'pay-xyz',
          subscriptionId: 'sub-def',
          status: 'active',
          expiresAt,
          revokedReason: null,
          createdAt,
          updatedAt,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/ent-123')
          .set('x-api-key', 'valid-api-key')
          .expect(200);

        expect(response.body).toEqual({
          id: 'ent-123',
          customer_id: 'cus-456',
          product_id: 'prod-789',
          purchase_intent_id: 'pi_abc123',
          payment_id: 'pay-xyz',
          subscription_id: 'sub-def',
          status: 'active',
          expires_at: '2025-01-15T10:00:00.000Z',
          revoked_reason: null,
          created_at: '2024-01-15T10:00:00.000Z',
          updated_at: '2024-01-20T15:30:00.000Z',
        });
      });

      it('should return null for optional fields when not set', async () => {
        const createdAt = new Date('2024-01-15T10:00:00.000Z');
        const updatedAt = new Date('2024-01-20T15:30:00.000Z');

        (entitlementService.getEntitlement as jest.Mock).mockResolvedValue({
          id: 'ent-123',
          customerId: 'cus-456',
          productId: 'prod-789',
          purchaseIntentId: 'pi_abc123',
          paymentId: 'pay-xyz',
          subscriptionId: null,
          status: 'active',
          expiresAt: null,
          revokedReason: null,
          createdAt,
          updatedAt,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/ent-123')
          .set('x-api-key', 'valid-api-key')
          .expect(200);

        expect(response.body.expires_at).toBeNull();
        expect(response.body.subscription_id).toBeNull();
      });

      it('should return revoked entitlement with reason', async () => {
        const createdAt = new Date('2024-01-15T10:00:00.000Z');
        const updatedAt = new Date('2024-01-20T15:30:00.000Z');

        (entitlementService.getEntitlement as jest.Mock).mockResolvedValue({
          id: 'ent-123',
          customerId: 'cus-456',
          productId: 'prod-789',
          purchaseIntentId: 'pi_abc123',
          paymentId: 'pay-xyz',
          subscriptionId: null,
          status: 'revoked',
          expiresAt: null,
          revokedReason: 'Refund requested',
          createdAt,
          updatedAt,
        });

        const response = await request(app)
          .get('/api/v1/entitlements/ent-123')
          .set('x-api-key', 'valid-api-key')
          .expect(200);

        expect(response.body.status).toBe('revoked');
        expect(response.body.revoked_reason).toBe('Refund requested');
      });
    });

    describe('error handling', () => {
      it('should return 500 when getEntitlement throws an error', async () => {
        (entitlementService.getEntitlement as jest.Mock).mockRejectedValue(
          new Error('Database error')
        );

        const response = await request(app)
          .get('/api/v1/entitlements/ent-123')
          .set('x-api-key', 'valid-api-key')
          .expect(500);

        expect(response.body).toEqual({
          error: {
            code: 'internal_error',
            message: 'Failed to retrieve entitlement',
            type: 'api_error',
          },
        });
      });
    });
  });

  describe('GET /api/v1/entitlements/customer/:customerId', () => {
    describe('authentication', () => {
      it('should return 401 when API key is missing', async () => {
        const response = await request(app)
          .get('/api/v1/entitlements/customer/cus-123')
          .expect(401);

        expect(response.body).toEqual({
          error: {
            code: 'unauthorized',
            message: 'Missing API key. Include x-api-key header.',
            type: 'authentication_error',
          },
        });
      });

      it('should return 401 when API key is invalid', async () => {
        const response = await request(app)
          .get('/api/v1/entitlements/customer/cus-123')
          .set('x-api-key', 'invalid-key')
          .expect(401);

        expect(response.body).toEqual({
          error: {
            code: 'unauthorized',
            message: 'Invalid API key.',
            type: 'authentication_error',
          },
        });
      });
    });

    describe('with valid authentication', () => {
      it('should return all entitlements for a customer', async () => {
        const createdAt = new Date('2024-01-15T10:00:00.000Z');
        const expiresAt = new Date('2025-01-15T10:00:00.000Z');

        (entitlementService.getEntitlementsByCustomerId as jest.Mock).mockResolvedValue([
          {
            id: 'ent-1',
            customerId: 'cus-123',
            productId: 'prod-1',
            purchaseIntentId: 'pi_1',
            status: 'active',
            expiresAt,
            createdAt,
          },
          {
            id: 'ent-2',
            customerId: 'cus-123',
            productId: 'prod-2',
            purchaseIntentId: 'pi_2',
            status: 'expired',
            expiresAt: null,
            createdAt,
          },
        ]);

        const response = await request(app)
          .get('/api/v1/entitlements/customer/cus-123')
          .set('x-api-key', 'valid-api-key')
          .expect(200);

        expect(response.body).toEqual({
          data: [
            {
              id: 'ent-1',
              customer_id: 'cus-123',
              product_id: 'prod-1',
              purchase_intent_id: 'pi_1',
              status: 'active',
              expires_at: '2025-01-15T10:00:00.000Z',
              created_at: '2024-01-15T10:00:00.000Z',
            },
            {
              id: 'ent-2',
              customer_id: 'cus-123',
              product_id: 'prod-2',
              purchase_intent_id: 'pi_2',
              status: 'expired',
              expires_at: null,
              created_at: '2024-01-15T10:00:00.000Z',
            },
          ],
        });
        expect(entitlementService.getEntitlementsByCustomerId).toHaveBeenCalledWith('cus-123');
      });

      it('should return empty array when customer has no entitlements', async () => {
        (entitlementService.getEntitlementsByCustomerId as jest.Mock).mockResolvedValue([]);

        const response = await request(app)
          .get('/api/v1/entitlements/customer/cus-noentitlements')
          .set('x-api-key', 'valid-api-key')
          .expect(200);

        expect(response.body).toEqual({ data: [] });
        expect(entitlementService.getEntitlementsByCustomerId).toHaveBeenCalledWith(
          'cus-noentitlements'
        );
      });

      it('should return active entitlements only when active_only=true', async () => {
        const createdAt = new Date('2024-01-15T10:00:00.000Z');

        (entitlementService.getActiveEntitlementsByCustomerId as jest.Mock).mockResolvedValue([
          {
            id: 'ent-1',
            customerId: 'cus-123',
            productId: 'prod-1',
            purchaseIntentId: 'pi_1',
            status: 'active',
            expiresAt: null,
            createdAt,
          },
        ]);

        const response = await request(app)
          .get('/api/v1/entitlements/customer/cus-123')
          .query({ active_only: 'true' })
          .set('x-api-key', 'valid-api-key')
          .expect(200);

        expect(response.body).toEqual({
          data: [
            {
              id: 'ent-1',
              customer_id: 'cus-123',
              product_id: 'prod-1',
              purchase_intent_id: 'pi_1',
              status: 'active',
              expires_at: null,
              created_at: '2024-01-15T10:00:00.000Z',
            },
          ],
        });
        expect(entitlementService.getActiveEntitlementsByCustomerId).toHaveBeenCalledWith(
          'cus-123'
        );
        expect(entitlementService.getEntitlementsByCustomerId).not.toHaveBeenCalled();
      });

      it('should return all entitlements when active_only is not true', async () => {
        (entitlementService.getEntitlementsByCustomerId as jest.Mock).mockResolvedValue([]);

        await request(app)
          .get('/api/v1/entitlements/customer/cus-123')
          .query({ active_only: 'false' })
          .set('x-api-key', 'valid-api-key')
          .expect(200);

        expect(entitlementService.getEntitlementsByCustomerId).toHaveBeenCalledWith('cus-123');
        expect(entitlementService.getActiveEntitlementsByCustomerId).not.toHaveBeenCalled();
      });

      it('should return all entitlements when active_only is not provided', async () => {
        (entitlementService.getEntitlementsByCustomerId as jest.Mock).mockResolvedValue([]);

        await request(app)
          .get('/api/v1/entitlements/customer/cus-123')
          .set('x-api-key', 'valid-api-key')
          .expect(200);

        expect(entitlementService.getEntitlementsByCustomerId).toHaveBeenCalledWith('cus-123');
        expect(entitlementService.getActiveEntitlementsByCustomerId).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should return 500 when getEntitlementsByCustomerId throws an error', async () => {
        (entitlementService.getEntitlementsByCustomerId as jest.Mock).mockRejectedValue(
          new Error('Database error')
        );

        const response = await request(app)
          .get('/api/v1/entitlements/customer/cus-123')
          .set('x-api-key', 'valid-api-key')
          .expect(500);

        expect(response.body).toEqual({
          error: {
            code: 'internal_error',
            message: 'Failed to retrieve entitlements',
            type: 'api_error',
          },
        });
      });

      it('should return 500 when getActiveEntitlementsByCustomerId throws an error', async () => {
        (entitlementService.getActiveEntitlementsByCustomerId as jest.Mock).mockRejectedValue(
          new Error('Database error')
        );

        const response = await request(app)
          .get('/api/v1/entitlements/customer/cus-123')
          .query({ active_only: 'true' })
          .set('x-api-key', 'valid-api-key')
          .expect(500);

        expect(response.body).toEqual({
          error: {
            code: 'internal_error',
            message: 'Failed to retrieve entitlements',
            type: 'api_error',
          },
        });
      });
    });
  });

  describe('route precedence', () => {
    it('should match /verify before /:id', async () => {
      (entitlementService.checkEntitlementStatus as jest.Mock).mockResolvedValue({
        status: 'active',
        hasAccess: true,
        entitlementId: 'ent-123',
        productId: 'prod-456',
        expiresAt: null,
      });

      // This tests that /verify is matched and not treated as /:id = 'verify'
      await request(app)
        .get('/api/v1/entitlements/verify')
        .query({ purchase_intent_id: 'pi_test' })
        .expect(200);

      expect(entitlementService.checkEntitlementStatus).toHaveBeenCalled();
      expect(entitlementService.getEntitlement).not.toHaveBeenCalled();
    });

    it('should match /customer/:customerId before /:id', async () => {
      (entitlementService.getEntitlementsByCustomerId as jest.Mock).mockResolvedValue([]);

      // This tests that /customer/cus-123 is matched and not treated as /:id = 'customer'
      await request(app)
        .get('/api/v1/entitlements/customer/cus-123')
        .set('x-api-key', 'valid-api-key')
        .expect(200);

      expect(entitlementService.getEntitlementsByCustomerId).toHaveBeenCalledWith('cus-123');
      expect(entitlementService.getEntitlement).not.toHaveBeenCalled();
    });
  });
});
