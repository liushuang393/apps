import { stripe } from '../../src/config/stripe.config';

/**
 * Stripe API契约测试
 * 验证Stripe API集成的正确性和响应格式
 * 
 * 注意: 这些测试使用Stripe测试模式,需要配置STRIPE_SECRET_KEY环境变量
 */
describe('Stripe API Contract Tests', () => {
  describe('Payment Intent API', () => {
    let testPaymentIntentId: string;

    it('should create payment intent with correct structure', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 1000,
        currency: 'jpy',
        payment_method_types: ['card'],
        metadata: {
          test: 'contract-test',
          purchase_id: 'test-purchase-123',
        },
      });

      // 验证响应结构
      expect(paymentIntent).toBeDefined();
      expect(paymentIntent.id).toMatch(/^pi_/);
      expect(paymentIntent.object).toBe('payment_intent');
      expect(paymentIntent.amount).toBe(1000);
      expect(paymentIntent.currency).toBe('jpy');
      expect(paymentIntent.status).toBe('requires_payment_method');
      expect(paymentIntent.metadata.test).toBe('contract-test');

      testPaymentIntentId = paymentIntent.id;
    });

    it('should create konbini payment intent with expiration', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 2000,
        currency: 'jpy',
        payment_method_types: ['konbini'],
        payment_method_options: {
          konbini: {
            expires_after_days: 4,
          },
        },
      });

      expect(paymentIntent).toBeDefined();
      expect(paymentIntent.payment_method_types).toContain('konbini');
      expect(paymentIntent.payment_method_options?.konbini).toBeDefined();
    });

    it('should retrieve payment intent by id', async () => {
      const retrieved = await stripe.paymentIntents.retrieve(testPaymentIntentId);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(testPaymentIntentId);
      expect(retrieved.metadata.test).toBe('contract-test');
    });

    it('should cancel payment intent', async () => {
      const canceled = await stripe.paymentIntents.cancel(testPaymentIntentId);

      expect(canceled).toBeDefined();
      expect(canceled.id).toBe(testPaymentIntentId);
      expect(canceled.status).toBe('canceled');
    });

    it('should handle payment intent creation errors', async () => {
      await expect(
        stripe.paymentIntents.create({
          amount: -100, // 无效金额
          currency: 'jpy',
          payment_method_types: ['card'],
        })
      ).rejects.toThrow();
    });
  });

  describe('Payment Method API', () => {
    it('should create card payment method', async () => {
      const paymentMethod = await stripe.paymentMethods.create({
        type: 'card',
        card: {
          token: 'tok_visa', // Stripe测试token
        },
      });

      expect(paymentMethod).toBeDefined();
      expect(paymentMethod.id).toMatch(/^pm_/);
      expect(paymentMethod.type).toBe('card');
      expect(paymentMethod.card).toBeDefined();
    });

    it('should attach payment method to customer', async () => {
      // 创建测试客户
      const customer = await stripe.customers.create({
        email: 'test-contract@example.com',
        metadata: { test: 'contract-test' },
      });

      // 创建支付方式
      const paymentMethod = await stripe.paymentMethods.create({
        type: 'card',
        card: { token: 'tok_visa' },
      });

      // 附加到客户
      const attached = await stripe.paymentMethods.attach(paymentMethod.id, {
        customer: customer.id,
      });

      expect(attached.customer).toBe(customer.id);

      // 清理
      await stripe.customers.del(customer.id);
    });
  });

  describe('Refund API', () => {
    it('should create refund for charge', async () => {
      // 创建并确认支付意图
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 1000,
        currency: 'jpy',
        payment_method_types: ['card'],
        payment_method: 'pm_card_visa', // 测试支付方式
        confirm: true,
        return_url: 'https://example.com/return',
      });

      // 等待支付成功
      if (paymentIntent.status === 'succeeded' && paymentIntent.latest_charge) {
        const refund = await stripe.refunds.create({
          charge: paymentIntent.latest_charge as string,
          amount: 500, // 部分退款
        });

        expect(refund).toBeDefined();
        expect(refund.id).toMatch(/^re_/);
        expect(refund.amount).toBe(500);
        expect(refund.status).toBe('succeeded');
      }
    });
  });

  describe('Customer API', () => {
    let testCustomerId: string;

    it('should create customer with metadata', async () => {
      const customer = await stripe.customers.create({
        email: 'test-customer@example.com',
        name: 'Test Customer',
        metadata: {
          user_id: 'test-user-123',
          source: 'contract-test',
        },
      });

      expect(customer).toBeDefined();
      expect(customer.id).toMatch(/^cus_/);
      expect(customer.email).toBe('test-customer@example.com');
      expect(customer.metadata.user_id).toBe('test-user-123');

      testCustomerId = customer.id;
    });

    it('should update customer information', async () => {
      const updated = await stripe.customers.update(testCustomerId, {
        name: 'Updated Customer Name',
        metadata: {
          updated: 'true',
        },
      });

      expect(updated.name).toBe('Updated Customer Name');
      expect(updated.metadata.updated).toBe('true');
    });

    it('should delete customer', async () => {
      const deleted = await stripe.customers.del(testCustomerId);

      expect(deleted.deleted).toBe(true);
      expect(deleted.id).toBe(testCustomerId);
    });
  });
});

