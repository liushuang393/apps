import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock the services before importing the router
jest.mock('../../../services', () => ({
  checkoutService: {
    createSession: jest.fn(),
    getSession: jest.fn(),
  },
  SupportedCurrency: 'usd',
}));

// Mock the middleware
jest.mock('../../../middleware', () => ({
  apiKeyAuth: jest.fn((req: Request, _res: Response, next: NextFunction) => {
    // Default mock: simulate authenticated developer
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
  validate: jest.fn((schema: any, target: string = 'body') => {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = target === 'params' ? req.params : req.body;
        const parsed = await schema.parseAsync(data);
        if (target === 'params') {
          req.params = parsed;
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

import checkoutRouter from '../../../routes/checkout';
import { checkoutService } from '../../../services';
import { apiKeyAuth } from '../../../middleware';

describe('Checkout Routes', () => {
  let app: Express;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create fresh express app with router
    app = express();
    app.use(express.json());
    app.use('/checkout', checkoutRouter);
  });

  describe('POST /checkout/sessions', () => {
    const validPayload = {
      product_id: '550e8400-e29b-41d4-a716-446655440000',
      price_id: '550e8400-e29b-41d4-a716-446655440001',
      purchase_intent_id: 'pi_test_123',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
    };

    it('should create a checkout session successfully', async () => {
      const mockResult = {
        sessionId: 'cs_123',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_123',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        checkout_url: mockResult.checkoutUrl,
        session_id: mockResult.sessionId,
        expires_at: mockResult.expiresAt.toISOString(),
      });

      expect(checkoutService.createSession).toHaveBeenCalledWith({
        developerId: 'dev-123',
        productId: validPayload.product_id,
        priceId: validPayload.price_id,
        purchaseIntentId: validPayload.purchase_intent_id,
        customerEmail: undefined,
        successUrl: validPayload.success_url,
        cancelUrl: validPayload.cancel_url,
        currency: 'usd',
        metadata: undefined,
        couponCode: undefined,
      });
    });

    it('should create a checkout session with optional fields', async () => {
      const payloadWithOptionals = {
        ...validPayload,
        customer_email: 'customer@example.com',
        currency: 'eur',
        metadata: { order_id: 'order_123' },
        coupon_code: 'SAVE20',
      };

      const mockResult = {
        sessionId: 'cs_456',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_456',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(payloadWithOptionals);

      expect(response.status).toBe(201);
      expect(checkoutService.createSession).toHaveBeenCalledWith({
        developerId: 'dev-123',
        productId: payloadWithOptionals.product_id,
        priceId: payloadWithOptionals.price_id,
        purchaseIntentId: payloadWithOptionals.purchase_intent_id,
        customerEmail: payloadWithOptionals.customer_email,
        successUrl: payloadWithOptionals.success_url,
        cancelUrl: payloadWithOptionals.cancel_url,
        currency: 'eur',
        metadata: payloadWithOptionals.metadata,
        couponCode: payloadWithOptionals.coupon_code,
      });
    });

    it('should default currency to usd when not specified', async () => {
      const mockResult = {
        sessionId: 'cs_789',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_789',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

      await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(checkoutService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'usd',
        })
      );
    });

    it('should return 400 for validation errors - invalid product_id', async () => {
      const invalidPayload = {
        ...validPayload,
        product_id: 'not-a-uuid',
      };

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
      expect(response.body.error.type).toBe('invalid_request_error');
    });

    it('should return 400 for validation errors - invalid price_id', async () => {
      const invalidPayload = {
        ...validPayload,
        price_id: 'not-a-uuid',
      };

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 400 for validation errors - missing required fields', async () => {
      const invalidPayload = {
        product_id: validPayload.product_id,
        // missing price_id, purchase_intent_id, success_url, cancel_url
      };

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 400 for validation errors - invalid success_url', async () => {
      const invalidPayload = {
        ...validPayload,
        success_url: 'not-a-valid-url',
      };

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 400 for validation errors - invalid cancel_url', async () => {
      const invalidPayload = {
        ...validPayload,
        cancel_url: 'not-a-valid-url',
      };

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 400 for validation errors - empty purchase_intent_id', async () => {
      const invalidPayload = {
        ...validPayload,
        purchase_intent_id: '',
      };

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 400 for validation errors - invalid currency', async () => {
      const invalidPayload = {
        ...validPayload,
        currency: 'invalid',
      };

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 400 for validation errors - invalid customer_email', async () => {
      const invalidPayload = {
        ...validPayload,
        customer_email: 'not-an-email',
      };

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('should return 401 when API key is missing', async () => {
      // Override the apiKeyAuth mock to simulate missing API key
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
        .post('/checkout/sessions')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
      expect(response.body.error.type).toBe('authentication_error');
    });

    it('should return 401 when API key is invalid', async () => {
      // Override the apiKeyAuth mock to simulate invalid API key
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Invalid API key.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'invalid_key')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
    });

    it('should return 404 when product is not found', async () => {
      (checkoutService.createSession as jest.Mock).mockRejectedValue(
        new Error('Product not found')
      );

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual({
        code: 'resource_not_found',
        message: 'Product not found',
        type: 'invalid_request_error',
      });
    });

    it('should return 404 when price is not found', async () => {
      (checkoutService.createSession as jest.Mock).mockRejectedValue(
        new Error('Price not found')
      );

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual({
        code: 'resource_not_found',
        message: 'Price not found',
        type: 'invalid_request_error',
      });
    });

    it('should return 400 when product is not active', async () => {
      (checkoutService.createSession as jest.Mock).mockRejectedValue(
        new Error('Product is not active')
      );

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual({
        code: 'invalid_request',
        message: 'Product is not active',
        type: 'invalid_request_error',
      });
    });

    it('should return 400 when price is not active', async () => {
      (checkoutService.createSession as jest.Mock).mockRejectedValue(
        new Error('Price is not active')
      );

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual({
        code: 'invalid_request',
        message: 'Price is not active',
        type: 'invalid_request_error',
      });
    });

    it('should return 500 for internal server errors', async () => {
      (checkoutService.createSession as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to create checkout session',
        type: 'api_error',
      });
    });

    it('should return 500 for non-Error exceptions', async () => {
      (checkoutService.createSession as jest.Mock).mockRejectedValue('Unknown error');

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to create checkout session',
        type: 'api_error',
      });
    });

    it('should support all valid currencies', async () => {
      const currencies = ['usd', 'cny', 'jpy', 'eur'];
      const mockResult = {
        sessionId: 'cs_currency',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_currency',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      for (const currency of currencies) {
        (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

        const response = await request(app)
          .post('/checkout/sessions')
          .set('x-api-key', 'test_api_key')
          .send({ ...validPayload, currency });

        expect(response.status).toBe(201);
      }
    });
  });

  describe('GET /checkout/sessions/:id', () => {
    const validSessionId = '550e8400-e29b-41d4-a716-446655440002';

    it('should retrieve a checkout session successfully', async () => {
      const mockSession = {
        id: validSessionId,
        stripeSessionId: 'cs_stripe_123',
        purchaseIntentId: 'pi_test_123',
        productId: '550e8400-e29b-41d4-a716-446655440000',
        priceId: '550e8400-e29b-41d4-a716-446655440001',
        customerId: 'cust_123',
        status: 'open',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
      };

      (checkoutService.getSession as jest.Mock).mockResolvedValue(mockSession);

      const response = await request(app)
        .get(`/checkout/sessions/${validSessionId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: mockSession.id,
        stripe_session_id: mockSession.stripeSessionId,
        purchase_intent_id: mockSession.purchaseIntentId,
        product_id: mockSession.productId,
        price_id: mockSession.priceId,
        customer_id: mockSession.customerId,
        status: mockSession.status,
        success_url: mockSession.successUrl,
        cancel_url: mockSession.cancelUrl,
        expires_at: mockSession.expiresAt.toISOString(),
        created_at: mockSession.createdAt.toISOString(),
      });

      expect(checkoutService.getSession).toHaveBeenCalledWith(validSessionId);
    });

    it('should return session with null customer_id', async () => {
      const mockSession = {
        id: validSessionId,
        stripeSessionId: 'cs_stripe_456',
        purchaseIntentId: 'pi_test_456',
        productId: '550e8400-e29b-41d4-a716-446655440000',
        priceId: '550e8400-e29b-41d4-a716-446655440001',
        customerId: null,
        status: 'open',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
      };

      (checkoutService.getSession as jest.Mock).mockResolvedValue(mockSession);

      const response = await request(app)
        .get(`/checkout/sessions/${validSessionId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.customer_id).toBeNull();
    });

    it('should return session with different statuses', async () => {
      const statuses = ['open', 'complete', 'expired'];

      for (const status of statuses) {
        const mockSession = {
          id: validSessionId,
          stripeSessionId: `cs_stripe_${status}`,
          purchaseIntentId: `pi_test_${status}`,
          productId: '550e8400-e29b-41d4-a716-446655440000',
          priceId: '550e8400-e29b-41d4-a716-446655440001',
          customerId: null,
          status,
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          expiresAt: new Date('2024-12-31T23:59:59Z'),
          createdAt: new Date('2024-01-01T00:00:00Z'),
        };

        (checkoutService.getSession as jest.Mock).mockResolvedValue(mockSession);

        const response = await request(app)
          .get(`/checkout/sessions/${validSessionId}`)
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe(status);
      }
    });

    it('should return 400 for invalid session ID format', async () => {
      const response = await request(app)
        .get('/checkout/sessions/not-a-valid-uuid')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
      expect(response.body.error.type).toBe('invalid_request_error');
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
        .get(`/checkout/sessions/${validSessionId}`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
    });

    it('should return 401 when API key is invalid', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Invalid API key.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app)
        .get(`/checkout/sessions/${validSessionId}`)
        .set('x-api-key', 'invalid_key');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
    });

    it('should return 404 when session is not found', async () => {
      (checkoutService.getSession as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get(`/checkout/sessions/${validSessionId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual({
        code: 'resource_not_found',
        message: 'Checkout session not found',
        type: 'invalid_request_error',
      });
    });

    it('should return 500 for internal server errors', async () => {
      (checkoutService.getSession as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get(`/checkout/sessions/${validSessionId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'internal_error',
        message: 'Failed to retrieve checkout session',
        type: 'api_error',
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long purchase_intent_id', async () => {
      const longPurchaseIntentId = 'a'.repeat(255);
      const payload = {
        product_id: '550e8400-e29b-41d4-a716-446655440000',
        price_id: '550e8400-e29b-41d4-a716-446655440001',
        purchase_intent_id: longPurchaseIntentId,
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      };

      const mockResult = {
        sessionId: 'cs_long',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_long',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(payload);

      expect(response.status).toBe(201);
    });

    it('should reject purchase_intent_id exceeding max length', async () => {
      const tooLongPurchaseIntentId = 'a'.repeat(256);
      const payload = {
        product_id: '550e8400-e29b-41d4-a716-446655440000',
        price_id: '550e8400-e29b-41d4-a716-446655440001',
        purchase_intent_id: tooLongPurchaseIntentId,
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      };

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(payload);

      expect(response.status).toBe(400);
    });

    it('should handle metadata with nested objects', async () => {
      const payload = {
        product_id: '550e8400-e29b-41d4-a716-446655440000',
        price_id: '550e8400-e29b-41d4-a716-446655440001',
        purchase_intent_id: 'pi_metadata_test',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        metadata: {
          order_id: 'order_123',
          customer_data: { name: 'Test Customer' },
          tags: ['premium', 'vip'],
        },
      };

      const mockResult = {
        sessionId: 'cs_metadata',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_metadata',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(payload);

      expect(response.status).toBe(201);
    });

    it('should handle empty metadata object', async () => {
      const payload = {
        product_id: '550e8400-e29b-41d4-a716-446655440000',
        price_id: '550e8400-e29b-41d4-a716-446655440001',
        purchase_intent_id: 'pi_empty_metadata',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        metadata: {},
      };

      const mockResult = {
        sessionId: 'cs_empty_meta',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_empty_meta',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(payload);

      expect(response.status).toBe(201);
    });

    it('should handle URLs with query parameters', async () => {
      const payload = {
        product_id: '550e8400-e29b-41d4-a716-446655440000',
        price_id: '550e8400-e29b-41d4-a716-446655440001',
        purchase_intent_id: 'pi_query_params',
        success_url: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}&order=123',
        cancel_url: 'https://example.com/cancel?reason=user_cancelled',
      };

      const mockResult = {
        sessionId: 'cs_query',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_query',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(payload);

      expect(response.status).toBe(201);
    });

    it('should handle special characters in coupon_code', async () => {
      const payload = {
        product_id: '550e8400-e29b-41d4-a716-446655440000',
        price_id: '550e8400-e29b-41d4-a716-446655440001',
        purchase_intent_id: 'pi_coupon_test',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        coupon_code: 'SAVE-20_PERCENT',
      };

      const mockResult = {
        sessionId: 'cs_coupon',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_coupon',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send(payload);

      expect(response.status).toBe(201);
    });
  });

  describe('Response Format', () => {
    it('should return correct Content-Type header', async () => {
      const mockResult = {
        sessionId: 'cs_content_type',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_content_type',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      };

      (checkoutService.createSession as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/checkout/sessions')
        .set('x-api-key', 'test_api_key')
        .send({
          product_id: '550e8400-e29b-41d4-a716-446655440000',
          price_id: '550e8400-e29b-41d4-a716-446655440001',
          purchase_intent_id: 'pi_content_type',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
        });

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return ISO 8601 formatted dates', async () => {
      const mockSession = {
        id: '550e8400-e29b-41d4-a716-446655440002',
        stripeSessionId: 'cs_date_format',
        purchaseIntentId: 'pi_date_format',
        productId: '550e8400-e29b-41d4-a716-446655440000',
        priceId: '550e8400-e29b-41d4-a716-446655440001',
        customerId: null,
        status: 'open',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: new Date('2024-12-31T23:59:59.000Z'),
        createdAt: new Date('2024-01-01T12:30:45.123Z'),
      };

      (checkoutService.getSession as jest.Mock).mockResolvedValue(mockSession);

      const response = await request(app)
        .get(`/checkout/sessions/${mockSession.id}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      expect(response.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });
});
