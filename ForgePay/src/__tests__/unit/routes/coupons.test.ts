import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock the services before importing the router
jest.mock('../../../services/CouponService', () => ({
  couponService: {
    createCoupon: jest.fn(),
    getCoupon: jest.fn(),
    getCouponByCode: jest.fn(),
    listCoupons: jest.fn(),
    updateCoupon: jest.fn(),
    deactivateCoupon: jest.fn(),
    deleteCoupon: jest.fn(),
    validateCoupon: jest.fn(),
    getCouponStats: jest.fn(),
  },
}));

// Mock the repositories
jest.mock('../../../repositories', () => ({
  auditLogRepository: {
    create: jest.fn(),
  },
}));

// Mock the middleware
jest.mock('../../../middleware', () => ({
  apiKeyAuth: jest.fn((req: Request, _res: Response, next: NextFunction) => {
    (req as any).developer = {
      id: 'dev-123',
      email: 'developer@example.com',
      testMode: true,
      stripeAccountId: 'acct_123',
      webhookSecret: 'whsec_123',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    };
    next();
  }),
  adminRateLimiter: jest.fn((_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
  validate: jest.fn((schema: any, target: string = 'body') => {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = target === 'params' ? req.params : target === 'query' ? req.query : req.body;
        const parsed = await schema.parseAsync(data);
        if (target === 'params') {
          req.params = parsed;
        } else if (target === 'query') {
          (req as any).query = parsed;
        } else {
          req.body = parsed;
        }
        next();
      } catch (error: any) {
        res.status(400).json({
          error: {
            code: 'invalid_request',
            message: error.errors?.[0]?.message || 'Validation failed',
            type: 'invalid_request_error',
          },
        });
      }
    };
  }),
  AuthenticatedRequest: {},
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import couponsRouter from '../../../routes/coupons';
import { couponService } from '../../../services/CouponService';
import { auditLogRepository } from '../../../repositories';
import { apiKeyAuth } from '../../../middleware';

describe('Coupons Routes', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/coupons', couponsRouter);
  });

  // ============================================================
  // POST /coupons - Create Coupon
  // ============================================================
  describe('POST /coupons', () => {
    const validPayload = {
      code: 'SAVE20',
      name: 'Save 20%',
      discount_type: 'percentage',
      discount_value: 20,
    };

    it('should create a coupon successfully with minimal payload', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'SAVE20',
        name: 'Save 20%',
        discountType: 'percentage',
        discountValue: 20,
        currency: null,
        minPurchaseAmount: null,
        maxRedemptions: null,
        redemptionCount: 0,
        appliesToProducts: null,
        active: true,
        expiresAt: null,
        stripeCouponId: 'stripe_coupon_123',
        metadata: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      (couponService.createCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: 'coupon-123',
        code: 'SAVE20',
        name: 'Save 20%',
        discount_type: 'percentage',
        discount_value: 20,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 0,
        applies_to_products: null,
        active: true,
        expires_at: null,
        stripe_coupon_id: 'stripe_coupon_123',
        metadata: null,
        created_at: mockCoupon.createdAt.toISOString(),
      });

      expect(couponService.createCoupon).toHaveBeenCalledWith({
        developerId: 'dev-123',
        code: 'SAVE20',
        name: 'Save 20%',
        discountType: 'percentage',
        discountValue: 20,
        currency: undefined,
        maxRedemptions: undefined,
        expiresAt: undefined,
        minPurchaseAmount: undefined,
        appliesToProducts: undefined,
        metadata: undefined,
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          developerId: 'dev-123',
          action: 'coupon.created',
          resourceType: 'coupon',
          resourceId: 'coupon-123',
          changes: { code: 'SAVE20', discount_type: 'percentage', discount_value: 20 },
        })
      );
    });

    it('should create a coupon with all optional fields', async () => {
      const fullPayload = {
        code: 'FIXED50',
        name: 'Fixed $50 off',
        discount_type: 'fixed_amount',
        discount_value: 5000,
        currency: 'usd',
        max_redemptions: 100,
        expires_at: '2027-12-31T23:59:59Z',
        min_purchase_amount: 10000,
        applies_to_products: ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'],
        metadata: { campaign: 'winter_sale' },
      };

      const mockCoupon = {
        id: 'coupon-456',
        code: 'FIXED50',
        name: 'Fixed $50 off',
        discountType: 'fixed_amount',
        discountValue: 5000,
        currency: 'usd',
        minPurchaseAmount: 10000,
        maxRedemptions: 100,
        redemptionCount: 0,
        appliesToProducts: ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'],
        active: true,
        expiresAt: new Date('2027-12-31T23:59:59Z'),
        stripeCouponId: 'stripe_coupon_456',
        metadata: { campaign: 'winter_sale' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      (couponService.createCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send(fullPayload);

      expect(response.status).toBe(201);
      expect(response.body.discount_type).toBe('fixed_amount');
      expect(response.body.currency).toBe('usd');
      expect(response.body.max_redemptions).toBe(100);
      expect(response.body.min_purchase_amount).toBe(10000);
      expect(response.body.applies_to_products).toEqual(['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002']);
      expect(response.body.metadata).toEqual({ campaign: 'winter_sale' });
    });

    it('should return 400 for validation errors - missing required code', async () => {
      const invalidPayload = {
        name: 'Save 20%',
        discount_type: 'percentage',
        discount_value: 20,
      };

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 400 for validation errors - invalid discount_type', async () => {
      const invalidPayload = {
        ...validPayload,
        discount_type: 'invalid_type',
      };

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 400 for validation errors - code too short', async () => {
      const invalidPayload = {
        ...validPayload,
        code: 'AB',
      };

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app)
        .post('/coupons')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
    });

    it('should return 409 when coupon code already exists', async () => {
      (couponService.createCoupon as jest.Mock).mockRejectedValue(
        new Error('Coupon code already exists: SAVE20')
      );

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(409);
      expect(response.body.error).toEqual({
        code: 'coupon_exists',
        message: 'Coupon code already exists: SAVE20',
        type: 'invalid_request_error',
      });
    });

    it('should return 400 when invalid product ID format in applies_to_products', async () => {
      // Schema validates UUID format before service is called
      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send({
          ...validPayload,
          applies_to_products: ['invalid-product'],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 400 when product ID does not exist', async () => {
      (couponService.createCoupon as jest.Mock).mockRejectedValue(
        new Error('Invalid product ID: 550e8400-e29b-41d4-a716-446655440099')
      );

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send({
          ...validPayload,
          applies_to_products: ['550e8400-e29b-41d4-a716-446655440099'],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual({
        code: 'invalid_product',
        message: 'Invalid product ID: 550e8400-e29b-41d4-a716-446655440099',
        type: 'invalid_request_error',
      });
    });

    it('should return 500 for internal server errors', async () => {
      (couponService.createCoupon as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to create coupon',
        type: 'api_error',
      });
    });
  });

  // ============================================================
  // GET /coupons - List Coupons
  // ============================================================
  describe('GET /coupons', () => {
    it('should list coupons successfully', async () => {
      const mockCoupons = [
        {
          id: 'coupon-1',
          code: 'SAVE10',
          name: 'Save 10%',
          discountType: 'percentage',
          discountValue: 10,
          currency: null,
          minPurchaseAmount: null,
          maxRedemptions: null,
          redemptionCount: 5,
          appliesToProducts: null,
          active: true,
          expiresAt: null,
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'coupon-2',
          code: 'FIXED25',
          name: 'Fixed $25 off',
          discountType: 'fixed_amount',
          discountValue: 2500,
          currency: 'usd',
          minPurchaseAmount: 5000,
          maxRedemptions: 50,
          redemptionCount: 10,
          appliesToProducts: ['product-1'],
          active: true,
          expiresAt: new Date('2027-12-31'),
          createdAt: new Date('2024-02-01'),
        },
      ];

      (couponService.listCoupons as jest.Mock).mockResolvedValue({
        coupons: mockCoupons,
        total: 2,
      });

      const response = await request(app)
        .get('/coupons')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toEqual({
        id: 'coupon-1',
        code: 'SAVE10',
        name: 'Save 10%',
        discount_type: 'percentage',
        discount_value: 10,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: null,
        redemption_count: 5,
        applies_to_products: null,
        active: true,
        expires_at: null,
        created_at: mockCoupons[0].createdAt.toISOString(),
      });
      expect(response.body.pagination).toEqual({
        total: 2,
        limit: 20,
        offset: 0,
      });

      expect(couponService.listCoupons).toHaveBeenCalledWith('dev-123', {
        activeOnly: false,
        limit: 20,
        offset: 0,
      });
    });

    it('should list coupons with pagination', async () => {
      (couponService.listCoupons as jest.Mock).mockResolvedValue({
        coupons: [],
        total: 50,
      });

      const response = await request(app)
        .get('/coupons?limit=10&offset=20')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.pagination).toEqual({
        total: 50,
        limit: 10,
        offset: 20,
      });

      expect(couponService.listCoupons).toHaveBeenCalledWith('dev-123', {
        activeOnly: false,
        limit: 10,
        offset: 20,
      });
    });

    it('should filter active coupons only', async () => {
      (couponService.listCoupons as jest.Mock).mockResolvedValue({
        coupons: [],
        total: 0,
      });

      const response = await request(app)
        .get('/coupons?active_only=true')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(couponService.listCoupons).toHaveBeenCalledWith('dev-123', {
        activeOnly: true,
        limit: 20,
        offset: 0,
      });
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).get('/coupons');

      expect(response.status).toBe(401);
    });

    it('should return 500 for internal server errors', async () => {
      (couponService.listCoupons as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get('/coupons')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to list coupons',
        type: 'api_error',
      });
    });
  });

  // ============================================================
  // GET /coupons/:id - Get Coupon by ID
  // ============================================================
  describe('GET /coupons/:id', () => {
    const validCouponId = '550e8400-e29b-41d4-a716-446655440000';

    it('should retrieve a coupon successfully', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'dev-123',
        code: 'SAVE20',
        name: 'Save 20%',
        discountType: 'percentage',
        discountValue: 20,
        currency: null,
        minPurchaseAmount: null,
        maxRedemptions: 100,
        redemptionCount: 25,
        appliesToProducts: null,
        active: true,
        expiresAt: new Date('2027-12-31'),
        stripeCouponId: 'stripe_coupon_123',
        metadata: { campaign: 'spring' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-02-01'),
      };

      const mockStats = {
        totalRedemptions: 25,
        totalDiscountAmount: 50000,
        uniqueCustomers: 20,
        averageDiscount: 2000,
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);
      (couponService.getCouponStats as jest.Mock).mockResolvedValue(mockStats);

      const response = await request(app)
        .get(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: validCouponId,
        code: 'SAVE20',
        name: 'Save 20%',
        discount_type: 'percentage',
        discount_value: 20,
        currency: null,
        min_purchase_amount: null,
        max_redemptions: 100,
        redemption_count: 25,
        applies_to_products: null,
        active: true,
        expires_at: mockCoupon.expiresAt.toISOString(),
        stripe_coupon_id: 'stripe_coupon_123',
        metadata: { campaign: 'spring' },
        created_at: mockCoupon.createdAt.toISOString(),
        updated_at: mockCoupon.updatedAt.toISOString(),
        stats: mockStats,
      });

      expect(couponService.getCoupon).toHaveBeenCalledWith(validCouponId);
      expect(couponService.getCouponStats).toHaveBeenCalledWith(validCouponId);
    });

    it('should return 404 when coupon is not found', async () => {
      (couponService.getCoupon as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual({
        code: 'coupon_not_found',
        message: 'Coupon not found',
        type: 'invalid_request_error',
      });
    });

    it('should return 404 when coupon belongs to different developer', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'different-dev',
        code: 'SAVE20',
        name: 'Save 20%',
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .get(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('coupon_not_found');
    });

    it('should return 400 for invalid coupon ID format', async () => {
      const response = await request(app)
        .get('/coupons/not-a-valid-uuid')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 500 for internal server errors', async () => {
      (couponService.getCoupon as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to retrieve coupon',
        type: 'api_error',
      });
    });
  });

  // ============================================================
  // PUT /coupons/:id - Update Coupon
  // ============================================================
  describe('PUT /coupons/:id', () => {
    const validCouponId = '550e8400-e29b-41d4-a716-446655440000';

    it('should update a coupon successfully', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'dev-123',
        code: 'SAVE20',
        name: 'Save 20%',
        discountType: 'percentage',
        discountValue: 20,
        currency: null,
        maxRedemptions: 100,
        redemptionCount: 10,
        active: true,
        expiresAt: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      const updatedCoupon = {
        ...mockCoupon,
        name: 'Updated Save 20%',
        maxRedemptions: 200,
        updatedAt: new Date('2024-02-01'),
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);
      (couponService.updateCoupon as jest.Mock).mockResolvedValue(updatedCoupon);

      const response = await request(app)
        .put(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key')
        .send({
          name: 'Updated Save 20%',
          max_redemptions: 200,
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: validCouponId,
        code: 'SAVE20',
        name: 'Updated Save 20%',
        discount_type: 'percentage',
        discount_value: 20,
        currency: null,
        min_purchase_amount: undefined,
        max_redemptions: 200,
        redemption_count: 10,
        active: true,
        expires_at: null,
        updated_at: updatedCoupon.updatedAt.toISOString(),
      });

      expect(couponService.updateCoupon).toHaveBeenCalledWith(validCouponId, {
        name: 'Updated Save 20%',
        active: undefined,
        maxRedemptions: 200,
        expiresAt: undefined,
        metadata: undefined,
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          developerId: 'dev-123',
          action: 'coupon.updated',
          resourceType: 'coupon',
          resourceId: validCouponId,
          changes: {
            name: 'Updated Save 20%',
            active: undefined,
            max_redemptions: 200,
            expires_at: undefined,
          },
        })
      );
    });

    it('should update coupon active status', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'dev-123',
        code: 'SAVE20',
        active: true,
        updatedAt: new Date('2024-01-01'),
      };

      const updatedCoupon = {
        ...mockCoupon,
        active: false,
        updatedAt: new Date('2024-02-01'),
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);
      (couponService.updateCoupon as jest.Mock).mockResolvedValue(updatedCoupon);

      const response = await request(app)
        .put(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key')
        .send({ active: false });

      expect(response.status).toBe(200);
      expect(response.body.active).toBe(false);
    });

    it('should return 404 when coupon is not found', async () => {
      (couponService.getCoupon as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .put(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key')
        .send({ name: 'Updated' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('coupon_not_found');
    });

    it('should return 404 when coupon belongs to different developer', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'different-dev',
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .put(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key')
        .send({ name: 'Updated' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('coupon_not_found');
    });

    it('should return 400 for invalid coupon ID format', async () => {
      const response = await request(app)
        .put('/coupons/invalid-id')
        .set('x-api-key', 'test_api_key')
        .send({ name: 'Updated' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 500 for internal server errors', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'dev-123',
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);
      (couponService.updateCoupon as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .put(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key')
        .send({ name: 'Updated' });

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to update coupon',
        type: 'api_error',
      });
    });
  });

  // ============================================================
  // POST /coupons/:id/deactivate - Deactivate Coupon
  // ============================================================
  describe('POST /coupons/:id/deactivate', () => {
    const validCouponId = '550e8400-e29b-41d4-a716-446655440000';

    it('should deactivate a coupon successfully', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'dev-123',
        code: 'SAVE20',
        active: true,
      };

      const deactivatedCoupon = {
        ...mockCoupon,
        active: false,
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);
      (couponService.deactivateCoupon as jest.Mock).mockResolvedValue(deactivatedCoupon);

      const response = await request(app)
        .post(`/coupons/${validCouponId}/deactivate`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: validCouponId,
        code: 'SAVE20',
        active: false,
        message: 'Coupon deactivated successfully',
      });

      expect(couponService.deactivateCoupon).toHaveBeenCalledWith(validCouponId);
      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          developerId: 'dev-123',
          action: 'coupon.deactivated',
          resourceType: 'coupon',
          resourceId: validCouponId,
        })
      );
    });

    it('should return 404 when coupon is not found', async () => {
      (couponService.getCoupon as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post(`/coupons/${validCouponId}/deactivate`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('coupon_not_found');
    });

    it('should return 404 when coupon belongs to different developer', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'different-dev',
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .post(`/coupons/${validCouponId}/deactivate`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('coupon_not_found');
    });

    it('should return 400 for invalid coupon ID format', async () => {
      const response = await request(app)
        .post('/coupons/invalid-id/deactivate')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 500 for internal server errors', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'dev-123',
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);
      (couponService.deactivateCoupon as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .post(`/coupons/${validCouponId}/deactivate`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to deactivate coupon',
        type: 'api_error',
      });
    });
  });

  // ============================================================
  // DELETE /coupons/:id - Delete Coupon
  // ============================================================
  describe('DELETE /coupons/:id', () => {
    const validCouponId = '550e8400-e29b-41d4-a716-446655440000';

    it('should delete a coupon successfully', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'dev-123',
        code: 'SAVE20',
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);
      (couponService.deleteCoupon as jest.Mock).mockResolvedValue(true);

      const response = await request(app)
        .delete(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});

      expect(couponService.deleteCoupon).toHaveBeenCalledWith(validCouponId);
      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          developerId: 'dev-123',
          action: 'coupon.deleted',
          resourceType: 'coupon',
          resourceId: validCouponId,
        })
      );
    });

    it('should return 404 when coupon is not found', async () => {
      (couponService.getCoupon as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .delete(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('coupon_not_found');
    });

    it('should return 404 when coupon belongs to different developer', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'different-dev',
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .delete(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('coupon_not_found');
    });

    it('should return 409 when coupon has existing redemptions', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'dev-123',
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);
      (couponService.deleteCoupon as jest.Mock).mockRejectedValue(
        new Error('Cannot delete coupon with existing redemptions')
      );

      const response = await request(app)
        .delete(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(409);
      expect(response.body.error).toEqual({
        code: 'coupon_has_redemptions',
        message: 'Cannot delete coupon with existing redemptions. Deactivate it instead.',
        type: 'invalid_request_error',
      });
    });

    it('should return 400 for invalid coupon ID format', async () => {
      const response = await request(app)
        .delete('/coupons/invalid-id')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 500 for internal server errors', async () => {
      const mockCoupon = {
        id: validCouponId,
        developerId: 'dev-123',
      };

      (couponService.getCoupon as jest.Mock).mockResolvedValue(mockCoupon);
      (couponService.deleteCoupon as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .delete(`/coupons/${validCouponId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete coupon',
        type: 'api_error',
      });
    });
  });

  // ============================================================
  // POST /coupons/validate - Validate Coupon
  // ============================================================
  describe('POST /coupons/validate', () => {
    const validPayload = {
      code: 'SAVE20',
      product_id: '550e8400-e29b-41d4-a716-446655440000',
      amount: 10000,
    };

    it('should validate a coupon successfully', async () => {
      const validationResult = {
        valid: true,
        coupon: {
          code: 'SAVE20',
          name: 'Save 20%',
          discountType: 'percentage',
          discountValue: 20,
          currency: null,
        },
        discountAmount: 2000,
      };

      (couponService.validateCoupon as jest.Mock).mockResolvedValue(validationResult);

      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        valid: true,
        coupon: {
          code: 'SAVE20',
          name: 'Save 20%',
          discount_type: 'percentage',
          discount_value: 20,
          currency: null,
        },
        discount_amount: 2000,
      });

      expect(couponService.validateCoupon).toHaveBeenCalledWith({
        code: 'SAVE20',
        developerId: 'dev-123',
        productId: validPayload.product_id,
        amount: validPayload.amount,
        currency: 'usd',
      });
    });

    it('should validate coupon without product_id and amount', async () => {
      const validationResult = {
        valid: true,
        coupon: {
          code: 'SAVE20',
          name: 'Save 20%',
          discountType: 'percentage',
          discountValue: 20,
          currency: null,
        },
        discountAmount: 0,
      };

      (couponService.validateCoupon as jest.Mock).mockResolvedValue(validationResult);

      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send({ code: 'SAVE20' });

      expect(response.status).toBe(200);
      expect(couponService.validateCoupon).toHaveBeenCalledWith({
        code: 'SAVE20',
        developerId: 'dev-123',
        productId: undefined,
        amount: 0,
        currency: 'usd',
      });
    });

    it('should return 400 when coupon is not found', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: false,
        errorCode: 'coupon_not_found',
        errorMessage: 'Coupon not found',
      });

      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        valid: false,
        error: {
          code: 'coupon_not_found',
          message: 'Coupon not found',
        },
      });
    });

    it('should return 400 when coupon is inactive', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: false,
        errorCode: 'coupon_inactive',
        errorMessage: 'This coupon is no longer active',
      });

      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('coupon_inactive');
    });

    it('should return 400 when coupon is expired', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: false,
        errorCode: 'coupon_expired',
        errorMessage: 'This coupon has expired',
      });

      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('coupon_expired');
    });

    it('should return 400 when coupon has reached max redemptions', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: false,
        errorCode: 'coupon_max_redemptions',
        errorMessage: 'This coupon has reached its maximum number of redemptions',
      });

      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('coupon_max_redemptions');
    });

    it('should return 400 when minimum purchase not met', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: false,
        errorCode: 'coupon_min_purchase',
        errorMessage: 'Minimum purchase amount of 50 usd required',
      });

      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send({ ...validPayload, amount: 1000 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('coupon_min_purchase');
    });

    it('should return 400 when coupon does not apply to product', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: false,
        errorCode: 'coupon_product_mismatch',
        errorMessage: 'This coupon does not apply to the selected product',
      });

      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('coupon_product_mismatch');
    });

    it('should return 400 for validation errors - code too short', async () => {
      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send({ code: 'AB' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 500 for internal server errors', async () => {
      (couponService.validateCoupon as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .post('/coupons/validate')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to validate coupon',
        type: 'api_error',
      });
    });
  });

  // ============================================================
  // GET /coupons/code/:code - Get Coupon by Code
  // ============================================================
  describe('GET /coupons/code/:code', () => {
    it('should retrieve a coupon by code successfully', async () => {
      const mockCoupon = {
        code: 'SAVE20',
        name: 'Save 20%',
        discountType: 'percentage',
        discountValue: 20,
        currency: null,
        minPurchaseAmount: 5000,
        active: true,
        expiresAt: new Date('2027-12-31'),
      };

      (couponService.getCouponByCode as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .get('/coupons/code/SAVE20')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        code: 'SAVE20',
        name: 'Save 20%',
        discount_type: 'percentage',
        discount_value: 20,
        currency: null,
        min_purchase_amount: 5000,
        expires_at: mockCoupon.expiresAt.toISOString(),
      });

      expect(couponService.getCouponByCode).toHaveBeenCalledWith('dev-123', 'SAVE20');
    });

    it('should return coupon without expiration date', async () => {
      const mockCoupon = {
        code: 'SAVE10',
        name: 'Save 10%',
        discountType: 'percentage',
        discountValue: 10,
        currency: null,
        minPurchaseAmount: null,
        active: true,
        expiresAt: null,
      };

      (couponService.getCouponByCode as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .get('/coupons/code/SAVE10')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.expires_at).toBeNull();
    });

    it('should return 404 when coupon is not found', async () => {
      (couponService.getCouponByCode as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/coupons/code/NOTEXIST')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual({
        code: 'coupon_not_found',
        message: 'Coupon not found or inactive',
        type: 'invalid_request_error',
      });
    });

    it('should return 404 when coupon is inactive', async () => {
      const mockCoupon = {
        code: 'SAVE20',
        name: 'Save 20%',
        active: false,
      };

      (couponService.getCouponByCode as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .get('/coupons/code/SAVE20')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('coupon_not_found');
    });

    it('should return 400 when coupon is expired', async () => {
      const mockCoupon = {
        code: 'EXPIRED',
        name: 'Expired Coupon',
        active: true,
        expiresAt: new Date('2020-01-01'),
      };

      (couponService.getCouponByCode as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .get('/coupons/code/EXPIRED')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual({
        code: 'coupon_expired',
        message: 'This coupon has expired',
        type: 'invalid_request_error',
      });
    });

    it('should return 400 for code too short', async () => {
      const response = await request(app)
        .get('/coupons/code/AB')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 500 for internal server errors', async () => {
      (couponService.getCouponByCode as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get('/coupons/code/SAVE20')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to retrieve coupon',
        type: 'api_error',
      });
    });
  });

  // ============================================================
  // Edge Cases and Additional Tests
  // ============================================================
  describe('Edge Cases', () => {
    it('should handle coupon with null metadata', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'SAVE20',
        name: 'Save 20%',
        discountType: 'percentage',
        discountValue: 20,
        currency: null,
        minPurchaseAmount: null,
        maxRedemptions: null,
        redemptionCount: 0,
        appliesToProducts: null,
        active: true,
        expiresAt: null,
        stripeCouponId: null,
        metadata: null,
        createdAt: new Date('2024-01-01'),
      };

      (couponService.createCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send({
          code: 'SAVE20',
          name: 'Save 20%',
          discount_type: 'percentage',
          discount_value: 20,
        });

      expect(response.status).toBe(201);
      expect(response.body.metadata).toBeNull();
      expect(response.body.stripe_coupon_id).toBeNull();
    });

    it('should handle coupon codes being converted to uppercase', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'LOWERCASE',
        name: 'Test',
        discountType: 'percentage',
        discountValue: 10,
        currency: null,
        minPurchaseAmount: null,
        maxRedemptions: null,
        redemptionCount: 0,
        appliesToProducts: null,
        active: true,
        expiresAt: null,
        stripeCouponId: null,
        metadata: null,
        createdAt: new Date('2024-01-01'),
      };

      (couponService.createCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send({
          code: 'lowercase',
          name: 'Test',
          discount_type: 'percentage',
          discount_value: 10,
        });

      expect(response.status).toBe(201);
      // The schema converts to uppercase
      expect(couponService.createCoupon).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LOWERCASE',
        })
      );
    });

    it('should handle fixed_amount discount type with currency', async () => {
      const mockCoupon = {
        id: 'coupon-456',
        code: 'FIXED50',
        name: 'Fixed $50 off',
        discountType: 'fixed_amount',
        discountValue: 5000,
        currency: 'usd',
        minPurchaseAmount: null,
        maxRedemptions: null,
        redemptionCount: 0,
        appliesToProducts: null,
        active: true,
        expiresAt: null,
        stripeCouponId: 'stripe_coupon_456',
        metadata: null,
        createdAt: new Date('2024-01-01'),
      };

      (couponService.createCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send({
          code: 'FIXED50',
          name: 'Fixed $50 off',
          discount_type: 'fixed_amount',
          discount_value: 5000,
          currency: 'usd',
        });

      expect(response.status).toBe(201);
      expect(response.body.discount_type).toBe('fixed_amount');
      expect(response.body.currency).toBe('usd');
    });

    it('should return empty list when no coupons exist', async () => {
      (couponService.listCoupons as jest.Mock).mockResolvedValue({
        coupons: [],
        total: 0,
      });

      const response = await request(app)
        .get('/coupons')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });
  });

  describe('Response Format', () => {
    it('should return correct Content-Type header', async () => {
      (couponService.listCoupons as jest.Mock).mockResolvedValue({
        coupons: [],
        total: 0,
      });

      const response = await request(app)
        .get('/coupons')
        .set('x-api-key', 'test_api_key');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return ISO 8601 formatted dates', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'SAVE20',
        name: 'Save 20%',
        discountType: 'percentage',
        discountValue: 20,
        currency: null,
        minPurchaseAmount: null,
        maxRedemptions: null,
        redemptionCount: 0,
        appliesToProducts: null,
        active: true,
        expiresAt: new Date('2027-12-31T23:59:59.000Z'),
        stripeCouponId: null,
        metadata: null,
        createdAt: new Date('2024-01-01T12:30:45.123Z'),
      };

      (couponService.createCoupon as jest.Mock).mockResolvedValue(mockCoupon);

      const response = await request(app)
        .post('/coupons')
        .set('x-api-key', 'test_api_key')
        .send({
          code: 'SAVE20',
          name: 'Save 20%',
          discount_type: 'percentage',
          discount_value: 20,
          expires_at: '2027-12-31T23:59:59Z',
        });

      expect(response.status).toBe(201);
      expect(response.body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      expect(response.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });
});
