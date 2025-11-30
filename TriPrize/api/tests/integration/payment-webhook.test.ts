import request from 'supertest';
import app from '../../src/app';
import { pool } from '../../src/config/database.config';
import Stripe from 'stripe';
import crypto from 'node:crypto';

/**
 * 辅助函数: 构造Stripe Webhook签名
 */
function constructWebhookSignature(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

/**
 * 辅助函数: 创建模拟的PaymentIntent对象
 */
function createMockPaymentIntent(
  id: string,
  status: string,
  amount: number,
  chargeId?: string
): Stripe.PaymentIntent {
  return {
    id,
    object: 'payment_intent',
    amount,
    currency: 'jpy',
    status: status as Stripe.PaymentIntent.Status,
    latest_charge: chargeId || null,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
  } as Stripe.PaymentIntent;
}

/**
 * 辅助函数: 创建模拟的Charge对象
 */
function createMockCharge(
  id: string,
  paymentIntentId: string,
  amount: number,
  refunded: boolean = false
): Stripe.Charge {
  return {
    id,
    object: 'charge',
    amount,
    amount_refunded: refunded ? amount : 0,
    currency: 'jpy',
    payment_intent: paymentIntentId,
    refunded,
    status: 'succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
  } as Stripe.Charge;
}

/**
 * 支付Webhook集成测试
 * 测试Stripe Webhook事件处理的完整流程
 *
 * 目的: 验证支付Webhook处理的正确性和幂等性
 */
describe('Payment Webhook Integration Tests', () => {
  let testCampaignId: string;
  let testUserId: string;
  let testPositionId: string;
  let testPurchaseId: string;
  let testPaymentIntentId: string;
  let testChargeId: string;

  // 设置测试超时为60秒(webhook处理可能需要较长时间)
  jest.setTimeout(60000);

  beforeAll(async () => {
    // 清理测试数据 - 按照外键依赖顺序删除
    await pool.query('DELETE FROM payment_transactions WHERE transaction_id::text LIKE \'test-%\'');
    await pool.query('DELETE FROM purchases WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE \'test-webhook%\')');
    await pool.query('DELETE FROM positions WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE \'Test Webhook%\')');
    await pool.query('DELETE FROM layers WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE \'Test Webhook%\')');
    await pool.query('DELETE FROM prizes WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE \'Test Webhook%\')');
    await pool.query('DELETE FROM campaigns WHERE name LIKE \'Test Webhook%\'');
    await pool.query('DELETE FROM users WHERE email LIKE \'test-webhook%\'');
  });

	  afterAll(async () => {
	    // 清理测试数据 - 按照外键依赖顺序删除 (仅删除本测试创建的数据, 不关闭全局连接)
	    await pool.query("DELETE FROM payment_transactions WHERE transaction_id::text LIKE 'test-%'");
	    await pool.query("DELETE FROM purchases WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE 'test-webhook%')");
	    await pool.query("DELETE FROM positions WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE 'Test Webhook%')");
	    await pool.query("DELETE FROM layers WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE 'Test Webhook%')");
	    await pool.query("DELETE FROM prizes WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE 'Test Webhook%')");
	    await pool.query("DELETE FROM campaigns WHERE name LIKE 'Test Webhook%'");
	    await pool.query("DELETE FROM users WHERE email LIKE 'test-webhook%'");
	    // 注意: 数据库连接(pool)和 Redis 客户端 在全局 Jest 设置中统一管理, 这里不再调用 pool.end() 或 redis.quit()
	  });

  beforeEach(async () => {
    // 创建测试用户 (使用唯一email避免冲突)
    const firebaseUid = `test-webhook-${Date.now()}`;
    const uniqueEmail = `${firebaseUid}@example.com`;
	    const { rows: userRows } = await pool.query(
	      `INSERT INTO users (user_id, firebase_uid, email, display_name, role)
	       VALUES (gen_random_uuid(), $1, $2, $3, $4)
	       RETURNING user_id`,
	      // 使用有效的角色值 'customer' (与 UserRole.CUSTOMER 对应)
	      [firebaseUid, uniqueEmail, 'Test Webhook User', 'customer']
	    );
    testUserId = userRows[0].user_id;

    // 创建测试活动
    const { rows: campaignRows } = await pool.query(
      `INSERT INTO campaigns (
         name, description, image_url, base_length,
         positions_total, layer_prices, profit_margin_percent,
         start_date, end_date, created_by, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING campaign_id`,
      [
        'Test Webhook Campaign',
        'Test campaign for webhook testing',
        'https://example.com/image.jpg',
        3,
        6,
        JSON.stringify({ '1': 100, '2': 200, '3': 300 }),
        10,
        new Date(),
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        testUserId,
        'active'
      ]
    );
    testCampaignId = campaignRows[0].campaign_id;

    // 创建测试层 (layer)
    const { rows: layerRows } = await pool.query(
      `INSERT INTO layers (
         campaign_id, layer_number, positions_count, price, positions_available
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING layer_id`,
      [testCampaignId, 1, 3, 100, 3]
    );
    const testLayerId = layerRows[0].layer_id;

    // 创建测试位置 (status='reserved'需要user_id)
    const { rows: positionRows } = await pool.query(
      `INSERT INTO positions (
         campaign_id, layer_id, row_number, col_number,
         layer_number, price, status, user_id, reserved_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING position_id`,
      [
        testCampaignId,
        testLayerId,
        1,
        1,
        1,
        100,
        'reserved',
        testUserId,
        new Date()
      ]
    );
    testPositionId = positionRows[0].position_id;

    // 创建测试购买 (添加purchase_method字段,使用'credit_card')
    const { rows: purchaseRows } = await pool.query(
      `INSERT INTO purchases (
         user_id, campaign_id, position_id,
         quantity, price_per_position, total_amount, status, purchase_method
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING purchase_id`,
      [
        testUserId,
        testCampaignId,
        testPositionId,
        1,
        100,
        100,
        'processing',
        'credit_card'
      ]
    );
    testPurchaseId = purchaseRows[0].purchase_id;

    // 创建测试支付交易
    testPaymentIntentId = 'pi_test_webhook_001';
    testChargeId = 'ch_test_webhook_001';

    await pool.query(
      `INSERT INTO payment_transactions (
         purchase_id, amount, currency,
         payment_method_type, status, stripe_payment_intent_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        testPurchaseId,
        100,
        'JPY',
        'card',
        'pending',
        testPaymentIntentId
      ]
    );
  });

  afterEach(async () => {
    // 清理每个测试的数据 (按照外键依赖顺序删除)
    if (testPurchaseId) {
      await pool.query('DELETE FROM payment_transactions WHERE purchase_id = $1', [testPurchaseId]);
      await pool.query('DELETE FROM purchases WHERE purchase_id = $1', [testPurchaseId]);
    }
    if (testPositionId) {
      await pool.query('DELETE FROM positions WHERE position_id = $1', [testPositionId]);
    }
    if (testCampaignId) {
      await pool.query('DELETE FROM layers WHERE campaign_id = $1', [testCampaignId]);
      await pool.query('DELETE FROM campaigns WHERE campaign_id = $1', [testCampaignId]);
    }
    if (testUserId) {
      await pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
    }
  });

  describe('payment_intent.succeeded Event', () => {
    it('should handle payment success and update position status to sold', async () => {
      // 构造webhook事件
      const paymentIntent = createMockPaymentIntent(
        testPaymentIntentId,
        'succeeded',
        100,
        testChargeId
      );

      const event = {
        id: 'evt_test_001',
        type: 'payment_intent.succeeded',
        data: {
          object: paymentIntent,
        },
      };

      const payload = JSON.stringify(event);
      const signature = constructWebhookSignature(payload, process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test');

      // 发送webhook请求
      const response = await request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', signature)
        .send(payload);

      expect(response.status).toBe(200);

      // 验证支付交易状态已更新
      const { rows: transactionRows } = await pool.query(
        'SELECT status, stripe_charge_id FROM payment_transactions WHERE stripe_payment_intent_id = $1',
        [testPaymentIntentId]
      );
      expect(transactionRows[0].status).toBe('succeeded');
      expect(transactionRows[0].stripe_charge_id).toBe(testChargeId);

      // 验证购买状态已更新
      const { rows: purchaseRows } = await pool.query(
        'SELECT status FROM purchases WHERE purchase_id = $1',
        [testPurchaseId]
      );
      expect(purchaseRows[0].status).toBe('completed');

      // 验证位置状态已更新为sold
      const { rows: positionRows } = await pool.query(
        'SELECT status FROM positions WHERE position_id = $1',
        [testPositionId]
      );
      expect(positionRows[0].status).toBe('sold');

      // 验证活动统计已更新
      const { rows: campaignRows } = await pool.query(
        'SELECT positions_sold, total_revenue FROM campaigns WHERE campaign_id = $1',
        [testCampaignId]
      );
      expect(campaignRows[0].positions_sold).toBe(1);
      expect(Number.parseInt(campaignRows[0].total_revenue, 10)).toBe(100);
    });

    it('should be idempotent - processing same webhook twice should not duplicate updates', async () => {
      // 构造webhook事件
      const paymentIntent = createMockPaymentIntent(
        testPaymentIntentId,
        'succeeded',
        100,
        testChargeId
      );

      const event = {
        id: 'evt_test_002',
        type: 'payment_intent.succeeded',
        data: {
          object: paymentIntent,
        },
      };

      const payload = JSON.stringify(event);
      const signature = constructWebhookSignature(payload, process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test');

      // 第一次发送webhook
      const response1 = await request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', signature)
        .send(payload);

      expect(response1.status).toBe(200);

      // 获取第一次处理后的统计
      const { rows: campaign1 } = await pool.query(
        'SELECT positions_sold, total_revenue FROM campaigns WHERE campaign_id = $1',
        [testCampaignId]
      );
      const positionsSold1 = campaign1[0].positions_sold;
      const totalRevenue1 = Number.parseInt(campaign1[0].total_revenue, 10);

      // 第二次发送相同的webhook (模拟Stripe重发)
      const response2 = await request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', signature)
        .send(payload);

      expect(response2.status).toBe(200);

      // 验证统计没有重复更新
      const { rows: campaign2 } = await pool.query(
        'SELECT positions_sold, total_revenue FROM campaigns WHERE campaign_id = $1',
        [testCampaignId]
      );
      expect(campaign2[0].positions_sold).toBe(positionsSold1);
      expect(Number.parseInt(campaign2[0].total_revenue, 10)).toBe(totalRevenue1);
    });
  });

  describe('payment_intent.payment_failed Event', () => {
    it('should handle payment failure and release position back to available', async () => {
      // 构造webhook事件
      const paymentIntent = createMockPaymentIntent(
        testPaymentIntentId,
        'requires_payment_method',
        100
      );
      paymentIntent.last_payment_error = {
        message: 'Your card was declined',
      } as Stripe.PaymentIntent.LastPaymentError;

      const event = {
        id: 'evt_test_003',
        type: 'payment_intent.payment_failed',
        data: {
          object: paymentIntent,
        },
      };

      const payload = JSON.stringify(event);
      const signature = constructWebhookSignature(payload, process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test');

      // 发送webhook请求
      const response = await request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', signature)
        .send(payload);

      expect(response.status).toBe(200);

      // 验证支付交易状态已更新
      const { rows: transactionRows } = await pool.query(
        'SELECT status, error_message FROM payment_transactions WHERE stripe_payment_intent_id = $1',
        [testPaymentIntentId]
      );
      expect(transactionRows[0].status).toBe('failed');
      expect(transactionRows[0].error_message).toContain('declined');

      // 验证购买状态已更新
      const { rows: purchaseRows } = await pool.query(
        'SELECT status FROM purchases WHERE purchase_id = $1',
        [testPurchaseId]
      );
      expect(purchaseRows[0].status).toBe('failed');

      // 验证位置状态已释放为available
      const { rows: positionRows } = await pool.query(
        'SELECT status FROM positions WHERE position_id = $1',
        [testPositionId]
      );
      expect(positionRows[0].status).toBe('available');
    });

    it('should be idempotent - processing same failure webhook twice', async () => {
      // 构造webhook事件
      const paymentIntent = createMockPaymentIntent(
        testPaymentIntentId,
        'requires_payment_method',
        100
      );
      paymentIntent.last_payment_error = {
        message: 'Insufficient funds',
      } as Stripe.PaymentIntent.LastPaymentError;

      const event = {
        id: 'evt_test_004',
        type: 'payment_intent.payment_failed',
        data: {
          object: paymentIntent,
        },
      };

      const payload = JSON.stringify(event);
      const signature = constructWebhookSignature(payload, process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test');

      // 第一次发送webhook
      await request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', signature)
        .send(payload);

      // 验证位置状态
      const { rows: position1 } = await pool.query(
        'SELECT status FROM positions WHERE position_id = $1',
        [testPositionId]
      );
      expect(position1[0].status).toBe('available');

      // 第二次发送相同的webhook
      const response2 = await request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', signature)
        .send(payload);

      expect(response2.status).toBe(200);

      // 验证位置状态仍然是available (没有重复处理)
      const { rows: position2 } = await pool.query(
        'SELECT status FROM positions WHERE position_id = $1',
        [testPositionId]
      );
      expect(position2[0].status).toBe('available');
    });
  });

  describe('charge.refunded Event', () => {
    it('should handle refund and rollback position status and campaign statistics', async () => {
      // 先设置为已支付状态 (使用正确的列名'status')
      await pool.query(
        `UPDATE payment_transactions
         SET status = 'succeeded', stripe_charge_id = $1
         WHERE stripe_payment_intent_id = $2`,
        [testChargeId, testPaymentIntentId]
      );
      await pool.query(
        'UPDATE purchases SET status = $1 WHERE purchase_id = $2',
        ['completed', testPurchaseId]
      );
      await pool.query(
        'UPDATE positions SET status = $1, sold_at = $2 WHERE position_id = $3',
        ['sold', new Date(), testPositionId]
      );
      await pool.query(
        'UPDATE campaigns SET positions_sold = 1, total_revenue = 100 WHERE campaign_id = $1',
        [testCampaignId]
      );

      // 构造refund webhook事件
      const charge = createMockCharge(
        testChargeId,
        testPaymentIntentId,
        100,
        true
      );

      const event = {
        id: 'evt_test_005',
        type: 'charge.refunded',
        data: {
          object: charge,
        },
      };

      const payload = JSON.stringify(event);
      const signature = constructWebhookSignature(payload, process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test');

      // 发送webhook请求
      const response = await request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', signature)
        .send(payload);

      expect(response.status).toBe(200);

      // 验证支付交易状态已更新
      const { rows: transactionRows } = await pool.query(
        'SELECT status FROM payment_transactions WHERE stripe_charge_id = $1',
        [testChargeId]
      );
      expect(transactionRows[0].status).toBe('refunded');

      // 验证购买状态已更新
      const { rows: purchaseRows } = await pool.query(
        'SELECT status FROM purchases WHERE purchase_id = $1',
        [testPurchaseId]
      );
      expect(purchaseRows[0].status).toBe('refunded');

      // 验证位置状态已回滚为available
      const { rows: positionRows } = await pool.query(
        'SELECT status FROM positions WHERE position_id = $1',
        [testPositionId]
      );
      expect(positionRows[0].status).toBe('available');

      // 验证活动统计已回滚
      const { rows: campaignRows } = await pool.query(
        'SELECT positions_sold, total_revenue FROM campaigns WHERE campaign_id = $1',
        [testCampaignId]
      );
      expect(campaignRows[0].positions_sold).toBe(0);
      expect(Number.parseInt(campaignRows[0].total_revenue, 10)).toBe(0);
    });
  });
});

