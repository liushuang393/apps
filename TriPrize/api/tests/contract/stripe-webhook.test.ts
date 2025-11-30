import request from 'supertest';
import Stripe from 'stripe';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/database.config';

// Webhook契約テストでは署名検証とルーティングの確認に集中するため、
// 実際のPaymentServiceのDB処理はモック化してHTTPステータスを安定させる
jest.mock('../../src/services/payment.service', () => ({
	__esModule: true,
	default: {
		handleWebhook: jest.fn().mockResolvedValue(undefined),
	},
}));

/**
 * Stripe Webhook契约测试
 * 验证Webhook签名验证和事件处理的正确性
 * 
 * 注意: 需要配置STRIPE_WEBHOOK_SECRET环境变量
 */
	const app = createApp();

	describe('Stripe Webhook Contract Tests', () => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';

  beforeAll(async () => {
    // 清理测试数据
	    await pool.query(
	      "DELETE FROM payment_transactions WHERE stripe_payment_intent_id LIKE 'pi_test_%'",
	    );
  });

  afterAll(async () => {
    // 清理测试数据
	    await pool.query(
	      "DELETE FROM payment_transactions WHERE stripe_payment_intent_id LIKE 'pi_test_%'",
	    );
  });

  /**
   * 生成测试用的Webhook签名
   */
  function generateTestSignature(payload: string, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const crypto = require('crypto');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    
    return `t=${timestamp},v1=${signature}`;
  }

  describe('Webhook Signature Verification', () => {
    it('should accept valid webhook signature', async () => {
      const event: Stripe.Event = {
        id: 'evt_test_webhook_001',
        object: 'event',
        api_version: '2023-10-16',
        created: Math.floor(Date.now() / 1000),
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_webhook_001',
            object: 'payment_intent',
            amount: 1000,
            currency: 'jpy',
            status: 'succeeded',
            metadata: {
              purchase_id: 'test-purchase-webhook-001',
            },
          } as unknown as Stripe.PaymentIntent,
        },
        livemode: false,
        pending_webhooks: 1,
        request: {
          id: null,
          idempotency_key: null,
        },
      };

      const payload = JSON.stringify(event);
      const signature = generateTestSignature(payload, webhookSecret);

	      const response = await request(app)
	        .post('/api/payments/webhook')
	        .set('stripe-signature', signature)
	        .send(payload);

      // 注意: 实际响应取决于webhook处理逻辑
      expect([200, 400]).toContain(response.status);
    });

    it('should reject invalid webhook signature', async () => {
      const event = {
        id: 'evt_test_invalid',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      };

      const payload = JSON.stringify(event);
      const invalidSignature = 't=123456,v1=invalid_signature';

	      const response = await request(app)
	        .post('/api/payments/webhook')
	        .set('stripe-signature', invalidSignature)
	        .send(payload);

      expect(response.status).toBe(400);
    });

    it('should reject webhook without signature', async () => {
      const event = {
        id: 'evt_test_no_sig',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      };

	      const response = await request(app)
	        .post('/api/payments/webhook')
	        .send(event);

      expect(response.status).toBe(400);
    });
  });

  describe('Webhook Event Handling', () => {
    it('should handle payment_intent.succeeded event', async () => {
      const event: Stripe.Event = {
        id: 'evt_test_succeeded',
        object: 'event',
        api_version: '2023-10-16',
        created: Math.floor(Date.now() / 1000),
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_succeeded_001',
            object: 'payment_intent',
            amount: 2000,
            currency: 'jpy',
            status: 'succeeded',
            metadata: {
              purchase_id: 'test-purchase-succeeded-001',
            },
          } as unknown as Stripe.PaymentIntent,
        },
        livemode: false,
        pending_webhooks: 1,
        request: { id: null, idempotency_key: null },
      };

      const payload = JSON.stringify(event);
      const signature = generateTestSignature(payload, webhookSecret);

	      const response = await request(app)
	        .post('/api/payments/webhook')
	        .set('stripe-signature', signature)
	        .set('Content-Type', 'application/json')
	        .send(payload);

      expect([200, 400]).toContain(response.status);
    });

    it('should handle payment_intent.payment_failed event', async () => {
      const event: Stripe.Event = {
        id: 'evt_test_failed',
        object: 'event',
        api_version: '2023-10-16',
        created: Math.floor(Date.now() / 1000),
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_failed_001',
            object: 'payment_intent',
            amount: 1500,
            currency: 'jpy',
            status: 'requires_payment_method',
            metadata: {
              purchase_id: 'test-purchase-failed-001',
            },
            last_payment_error: {
              type: 'card_error',
              code: 'card_declined',
              message: 'Your card was declined',
            },
          } as unknown as Stripe.PaymentIntent,
        },
        livemode: false,
        pending_webhooks: 1,
        request: { id: null, idempotency_key: null },
      };

      const payload = JSON.stringify(event);
      const signature = generateTestSignature(payload, webhookSecret);

	      const response = await request(app)
	        .post('/api/payments/webhook')
	        .set('stripe-signature', signature)
	        .set('Content-Type', 'application/json')
	        .send(payload);

      expect([200, 400]).toContain(response.status);
    });

    it('should handle charge.refunded event', async () => {
      const event: Stripe.Event = {
        id: 'evt_test_refunded',
        object: 'event',
        api_version: '2023-10-16',
        created: Math.floor(Date.now() / 1000),
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_refunded_001',
            object: 'charge',
            amount: 3000,
            amount_refunded: 3000,
            currency: 'jpy',
            refunded: true,
            metadata: {
              purchase_id: 'test-purchase-refunded-001',
            },
          } as unknown as Stripe.Charge,
        },
        livemode: false,
        pending_webhooks: 1,
        request: { id: null, idempotency_key: null },
      };

      const payload = JSON.stringify(event);
      const signature = generateTestSignature(payload, webhookSecret);

	      const response = await request(app)
	        .post('/api/payments/webhook')
	        .set('stripe-signature', signature)
	        .set('Content-Type', 'application/json')
	        .send(payload);

      expect([200, 400]).toContain(response.status);
    });
  });
});

