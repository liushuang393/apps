import express, { Express } from 'express';
import request from 'supertest';

// Mock dependencies before importing the router
jest.mock('../../../services', () => ({
  webhookProcessor: {
    processWebhook: jest.fn(),
  },
}));

jest.mock('../../../middleware', () => ({
  webhookRateLimiter: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import webhooksRouter from '../../../routes/webhooks';
import { webhookProcessor } from '../../../services';
import { webhookRateLimiter } from '../../../middleware';
import { logger } from '../../../utils/logger';

const mockWebhookProcessor = webhookProcessor as jest.Mocked<typeof webhookProcessor>;
const mockWebhookRateLimiter = webhookRateLimiter as jest.MockedFunction<typeof webhookRateLimiter>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Webhooks Routes', () => {
  let app: Express;

  beforeEach(() => {
    // Create a fresh Express app for each test
    app = express();
    
    // Parse raw body for webhook signature verification
    app.use(express.raw({ type: 'application/json' }));
    app.use(express.json());
    
    // Mount the webhooks router
    app.use('/api/v1/webhooks', webhooksRouter);

    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset rate limiter to pass through by default
    mockWebhookRateLimiter.mockImplementation((_req, _res, next) => next());
  });

  describe('POST /api/v1/webhooks/stripe', () => {
    const validPayload = JSON.stringify({
      id: 'evt_test123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test123',
        },
      },
    });

    const validSignature = 'whsec_test_signature_123';

    describe('Rate Limiting', () => {
      it('should apply webhookRateLimiter middleware', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(mockWebhookRateLimiter).toHaveBeenCalled();
      });

      it('should return 429 when rate limit is exceeded', async () => {
        mockWebhookRateLimiter.mockImplementation((_req, res) => {
          res.status(429).json({
            error: {
              code: 'rate_limit_exceeded',
              message: 'Too many webhook requests.',
              type: 'rate_limit_error',
            },
          });
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(429);
        expect(response.body.error.code).toBe('rate_limit_exceeded');
      });
    });

    describe('Signature Validation', () => {
      it('should return 401 when stripe-signature header is missing', async () => {
        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(401);
        expect(response.body).toEqual({
          error: {
            code: 'missing_signature',
            message: 'Missing Stripe signature header',
            type: 'authentication_error',
          },
        });
      });

      it('should log warning when signature is missing', async () => {
        await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Webhook received without signature',
          expect.objectContaining({
            ip: expect.any(String),
          })
        );
      });

      it('should return 401 when signature is empty string', async () => {
        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', '')
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('missing_signature');
      });

      it('should return 401 when signature is invalid', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: false,
          eventId: '',
          eventType: '',
          processed: false,
          error: 'Invalid signature',
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', 'invalid_signature')
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(401);
        expect(response.body).toEqual({
          error: {
            code: 'invalid_signature',
            message: 'Invalid webhook signature',
            type: 'authentication_error',
          },
        });
      });

      it('should not call processWebhook when signature header is missing', async () => {
        await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(mockWebhookProcessor.processWebhook).not.toHaveBeenCalled();
      });
    });

    describe('Successful Webhook Processing', () => {
      it('should return 200 with success response when webhook is processed', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          received: true,
          event_id: 'evt_test123',
          event_type: 'checkout.session.completed',
          processed: true,
        });
      });

      it('should return 200 with processed=false when event was already processed', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_duplicate123',
          eventType: 'invoice.paid',
          processed: false,
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          received: true,
          event_id: 'evt_duplicate123',
          event_type: 'invoice.paid',
          processed: false,
        });
      });

      it('should pass payload and signature to webhookProcessor', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(mockWebhookProcessor.processWebhook).toHaveBeenCalledWith(
          expect.anything(), // payload (could be Buffer or string)
          validSignature
        );
      });

      it('should handle various webhook event types', async () => {
        const eventTypes = [
          'checkout.session.completed',
          'invoice.paid',
          'invoice.payment_failed',
          'customer.subscription.updated',
          'customer.subscription.deleted',
          'charge.refunded',
          'charge.dispute.created',
          'charge.dispute.closed',
        ];

        for (const eventType of eventTypes) {
          jest.clearAllMocks();
          
          mockWebhookProcessor.processWebhook.mockResolvedValue({
            success: true,
            eventId: `evt_${eventType}`,
            eventType,
            processed: true,
          });

          const response = await request(app)
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', validSignature)
            .set('Content-Type', 'application/json')
            .send(validPayload);

          expect(response.status).toBe(200);
          expect(response.body.event_type).toBe(eventType);
        }
      });
    });

    describe('Failed Webhook Processing', () => {
      it('should return 200 with error when processing fails with non-signature error', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: false,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: false,
          error: 'Database connection failed',
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          received: true,
          event_id: 'evt_test123',
          event_type: 'checkout.session.completed',
          processed: false,
        });
      });

      it('should return 200 even when processor throws exception', async () => {
        mockWebhookProcessor.processWebhook.mockRejectedValue(
          new Error('Unexpected processing error')
        );

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          received: true,
          error: 'Processing error',
        });
      });

      it('should log error when processing throws exception', async () => {
        const error = new Error('Unexpected processing error');
        mockWebhookProcessor.processWebhook.mockRejectedValue(error);

        await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Webhook processing error',
          { error }
        );
      });

      it('should return 200 to prevent Stripe retries on processing errors', async () => {
        // This tests the design decision to always return 200 to Stripe
        // to prevent automatic retries (we handle retries internally)
        mockWebhookProcessor.processWebhook.mockRejectedValue(
          new Error('Critical failure')
        );

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        // Should NOT return 500, as that would cause Stripe to retry
        expect(response.status).toBe(200);
      });
    });

    describe('Request Body Handling', () => {
      it('should handle raw body payload', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        const rawPayload = Buffer.from(validPayload);

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(rawPayload);

        expect(response.status).toBe(200);
        expect(mockWebhookProcessor.processWebhook).toHaveBeenCalled();
      });

      it('should handle empty body', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: false,
          eventId: '',
          eventType: '',
          processed: false,
          error: 'Invalid signature',
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send('');

        // Should still process the request (signature validation will fail)
        expect(response.status).toBe(401);
      });

      it('should handle malformed JSON body gracefully', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        // Note: The webhook expects raw body, not parsed JSON
        // so malformed JSON is passed as-is to the processor
        await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send('{ invalid json }');

        // The route should pass the payload to processor which handles validation
        expect(mockWebhookProcessor.processWebhook).toHaveBeenCalled();
      });
    });

    describe('Edge Cases', () => {
      it('should handle very long signature header', async () => {
        const longSignature = 't=' + '1'.repeat(1000) + ',v1=' + 'a'.repeat(1000);
        
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: false,
          eventId: '',
          eventType: '',
          processed: false,
          error: 'Invalid signature',
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', longSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(401);
        expect(mockWebhookProcessor.processWebhook).toHaveBeenCalledWith(
          expect.anything(),
          longSignature
        );
      });

      it('should handle special characters in signature', async () => {
        const specialSignature = 't=123,v1=abc+/=';
        
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', specialSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.status).toBe(200);
        expect(mockWebhookProcessor.processWebhook).toHaveBeenCalledWith(
          expect.anything(),
          specialSignature
        );
      });

      it('should handle concurrent webhook requests', async () => {
        mockWebhookProcessor.processWebhook.mockImplementation(async () => {
          // Simulate some processing time
          await new Promise(resolve => setTimeout(resolve, 10));
          return {
            success: true,
            eventId: 'evt_concurrent',
            eventType: 'checkout.session.completed',
            processed: true,
          };
        });

        // Send multiple concurrent requests
        const requests = Array(5).fill(null).map(() =>
          request(app)
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', validSignature)
            .set('Content-Type', 'application/json')
            .send(validPayload)
        );

        const responses = await Promise.all(requests);

        // All should succeed
        responses.forEach(response => {
          expect(response.status).toBe(200);
          expect(response.body.received).toBe(true);
        });

        // All should have called processWebhook
        expect(mockWebhookProcessor.processWebhook).toHaveBeenCalledTimes(5);
      });

      it('should handle large payload', async () => {
        const largePayload = JSON.stringify({
          id: 'evt_large',
          type: 'checkout.session.completed',
          data: {
            object: {
              metadata: {
                largeField: 'x'.repeat(10000),
              },
            },
          },
        });

        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_large',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(largePayload);

        expect(response.status).toBe(200);
        expect(mockWebhookProcessor.processWebhook).toHaveBeenCalled();
      });
    });

    describe('Response Format', () => {
      it('should return JSON content type', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.headers['content-type']).toMatch(/application\/json/);
      });

      it('should include received=true in success response', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.body.received).toBe(true);
      });

      it('should include received=true even in error response', async () => {
        mockWebhookProcessor.processWebhook.mockRejectedValue(
          new Error('Processing error')
        );

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.body.received).toBe(true);
      });

      it('should use snake_case for response fields', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: true,
          eventId: 'evt_test123',
          eventType: 'checkout.session.completed',
          processed: true,
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', validSignature)
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.body).toHaveProperty('event_id');
        expect(response.body).toHaveProperty('event_type');
        expect(response.body).not.toHaveProperty('eventId');
        expect(response.body).not.toHaveProperty('eventType');
      });
    });

    describe('Error Response Format', () => {
      it('should return proper error structure for missing signature', async () => {
        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.body.error).toBeDefined();
        expect(response.body.error.code).toBe('missing_signature');
        expect(response.body.error.message).toBeDefined();
        expect(response.body.error.type).toBe('authentication_error');
      });

      it('should return proper error structure for invalid signature', async () => {
        mockWebhookProcessor.processWebhook.mockResolvedValue({
          success: false,
          eventId: '',
          eventType: '',
          processed: false,
          error: 'Invalid signature',
        });

        const response = await request(app)
          .post('/api/v1/webhooks/stripe')
          .set('stripe-signature', 'bad_sig')
          .set('Content-Type', 'application/json')
          .send(validPayload);

        expect(response.body.error).toBeDefined();
        expect(response.body.error.code).toBe('invalid_signature');
        expect(response.body.error.message).toBe('Invalid webhook signature');
        expect(response.body.error.type).toBe('authentication_error');
      });
    });
  });

  describe('Route Configuration', () => {
    it('should only accept POST requests', async () => {
      const methods = ['get', 'put', 'delete', 'patch'] as const;

      for (const method of methods) {
        const response = await request(app)[method]('/api/v1/webhooks/stripe')
          .set('stripe-signature', 'test')
          .set('Content-Type', 'application/json');

        // Should return 404 for non-POST methods
        expect(response.status).toBe(404);
      }
    });

    it('should respond to POST requests', async () => {
      mockWebhookProcessor.processWebhook.mockResolvedValue({
        success: true,
        eventId: 'evt_test123',
        eventType: 'checkout.session.completed',
        processed: true,
      });

      const response = await request(app)
        .post('/api/v1/webhooks/stripe')
        .set('stripe-signature', 'test')
        .set('Content-Type', 'application/json')
        .send('{}');

      expect(response.status).not.toBe(404);
    });
  });

  describe('Integration with webhookProcessor', () => {
    it('should correctly differentiate between signature error and other errors', async () => {
      // First test: signature error returns 401
      mockWebhookProcessor.processWebhook.mockResolvedValue({
        success: false,
        eventId: '',
        eventType: '',
        processed: false,
        error: 'Invalid signature',
      });

      let response = await request(app)
        .post('/api/v1/webhooks/stripe')
        .set('stripe-signature', 'sig1')
        .set('Content-Type', 'application/json')
        .send('{}');

      expect(response.status).toBe(401);

      // Second test: other error returns 200
      mockWebhookProcessor.processWebhook.mockResolvedValue({
        success: false,
        eventId: 'evt_123',
        eventType: 'checkout.session.completed',
        processed: false,
        error: 'Database error',
      });

      response = await request(app)
        .post('/api/v1/webhooks/stripe')
        .set('stripe-signature', 'sig2')
        .set('Content-Type', 'application/json')
        .send('{}');

      expect(response.status).toBe(200);
    });
  });
});
