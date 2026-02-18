/**
 * E2E Tests for ForgePay Payment Platform
 *
 * These tests verify the complete payment flow and all major features
 * from checkout creation to entitlement verification.
 *
 * IMPORTANT: All test data is created via API requests, not direct DB insertion.
 * This ensures tests are realistic and test the full stack.
 *
 * Requirements: 1.1, 2.1, 3.1, 4.1, 5.4, 6.1, 7.2, 8.8, 10.2
 *
 * NOTE: These tests require:
 * - A running backend server (npm run dev)
 * - A test developer registered (node scripts/setup-test-developer.js)
 * - Set ENABLE_E2E_TESTS=true and TEST_API_KEY=<your_key>
 */

// Skip all E2E tests if not explicitly enabled
if (process.env.ENABLE_E2E_TESTS !== 'true') {
  describe.skip('E2E: ForgePay Payment Platform', () => {
    it('skipped - set ENABLE_E2E_TESTS=true to run', () => {});
  });
} else {
  // Only import when actually running tests
  const request = require('supertest');
  const app = require('../../app').default;

  // Test API key from environment (created via /onboarding/register API)
  const TEST_API_KEY = process.env.TEST_API_KEY;
  
  if (!TEST_API_KEY) {
    console.error('❌ TEST_API_KEY is not set!');
    console.error('   Run: node scripts/setup-test-developer.js');
    console.error('   Then: export TEST_API_KEY=<your_api_key>');
    process.exit(1);
  }

  describe('E2E: ForgePay Payment Platform', () => {
    // Test data IDs - created via API
    let testProductId: string;
    let testPriceId: string;
    const testPurchaseIntentId = `pi_e2e_test_${Date.now()}`;
    const testEmail = `e2e-test-${Date.now()}@example.com`;

    beforeAll(async () => {
      console.log('🚀 Setting up E2E test data via API...');
      
      try {
        // Step 1: Create test product via Admin API
        const productResponse = await request(app)
          .post('/api/v1/admin/products')
          .set('X-API-Key', TEST_API_KEY)
          .send({
            name: `E2E Test Product ${Date.now()}`,
            description: 'Product created for E2E testing',
            type: 'one_time',
          });

        if (productResponse.status === 201) {
          testProductId = productResponse.body.id;
          console.log(`✅ Created test product: ${testProductId}`);
        } else {
          console.warn('⚠️  Failed to create test product:', productResponse.body);
        }

        // Step 2: Create test price via Admin API
        if (testProductId) {
          const priceResponse = await request(app)
            .post('/api/v1/admin/prices')
            .set('X-API-Key', TEST_API_KEY)
            .send({
              product_id: testProductId,
              amount: 999,
              currency: 'usd',
            });

          if (priceResponse.status === 201) {
            testPriceId = priceResponse.body.id;
            console.log(`✅ Created test price: ${testPriceId}`);
          } else {
            console.warn('⚠️  Failed to create test price:', priceResponse.body);
          }
        }

        console.log('✅ E2E test setup complete');
      } catch (error) {
        console.warn('⚠️  E2E test setup had issues:', error);
      }
    });

    afterAll(async () => {
      console.log('🧹 Cleaning up E2E test data via API...');
      
      try {
        // Archive test product via API (soft delete)
        if (testProductId) {
          await request(app)
            .delete(`/api/v1/admin/products/${testProductId}`)
            .set('X-API-Key', TEST_API_KEY);
          console.log(`✅ Archived test product: ${testProductId}`);
        }
        console.log('✅ E2E test cleanup complete');
      } catch (error) {
        console.warn('⚠️  E2E test cleanup had issues:', error);
      }
    });

    // ============================================================
    // HEALTH CHECK TESTS
    // ============================================================
    describe('Health Check Endpoints', () => {
      it('GET /health - should return healthy status', async () => {
        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body).toHaveProperty('environment');
      });

      it('GET /api/v1/health - should return detailed health status', async () => {
        const response = await request(app).get('/api/v1/health');

        expect([200, 503]).toContain(response.status);
        expect(response.body).toHaveProperty('status');
        expect(response.body).toHaveProperty('timestamp');
      });

      it('GET /api/v1/health/live - should return alive', async () => {
        const response = await request(app).get('/api/v1/health/live');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('alive');
      });

      it('GET /api/v1/health/ready - should return ready status', async () => {
        const response = await request(app).get('/api/v1/health/ready');

        expect([200, 503]).toContain(response.status);
        expect(response.body).toHaveProperty('status');
      });
    });

    // ============================================================
    // AUTHENTICATION TESTS
    // ============================================================
    describe('API Authentication', () => {
      it('should reject requests without API key', async () => {
        const response = await request(app)
          .get('/api/v1/admin/products');

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('unauthorized');
      });

      it('should reject requests with invalid API key', async () => {
        const response = await request(app)
          .get('/api/v1/admin/products')
          .set('X-API-Key', 'invalid_key_12345');

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('unauthorized');
      });

      it('should accept requests with valid API key', async () => {
        const response = await request(app)
          .get('/api/v1/admin/products')
          .set('X-API-Key', TEST_API_KEY);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('data');
      });
    });

    // ============================================================
    // CHECKOUT FLOW TESTS
    // ============================================================
    describe('Checkout Flow', () => {
      it('should create checkout session with valid data', async () => {
        if (!testProductId || !testPriceId) {
          console.log('Skipping - no test product/price');
          return;
        }

        const response = await request(app)
          .post('/api/v1/checkout/sessions')
          .set('X-API-Key', TEST_API_KEY)
          .send({
            product_id: testProductId,
            price_id: testPriceId,
            purchase_intent_id: testPurchaseIntentId,
            success_url: 'https://example.com/success',
            cancel_url: 'https://example.com/cancel',
            customer_email: testEmail,
          });

        expect([200, 201]).toContain(response.status);
        expect(response.body).toHaveProperty('checkout_url');
        expect(response.body).toHaveProperty('session_id');
      });

      it('should validate required fields with Zod', async () => {
        const response = await request(app)
          .post('/api/v1/checkout/sessions')
          .set('X-API-Key', TEST_API_KEY)
          .send({
            product_id: testProductId,
            // missing price_id, purchase_intent_id, success_url, cancel_url
          });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('invalid_request');
      });

      it('should validate UUID format for product_id', async () => {
        const response = await request(app)
          .post('/api/v1/checkout/sessions')
          .set('X-API-Key', TEST_API_KEY)
          .send({
            product_id: 'not-a-uuid',
            price_id: testPriceId,
            purchase_intent_id: 'test_123',
            success_url: 'https://example.com/success',
            cancel_url: 'https://example.com/cancel',
          });

        expect(response.status).toBe(400);
      });

      it('should validate URL format for success_url', async () => {
        const response = await request(app)
          .post('/api/v1/checkout/sessions')
          .set('X-API-Key', TEST_API_KEY)
          .send({
            product_id: testProductId,
            price_id: testPriceId,
            purchase_intent_id: 'test_123',
            success_url: 'not-a-url',
            cancel_url: 'https://example.com/cancel',
          });

        expect(response.status).toBe(400);
      });
    });

    // ============================================================
    // ENTITLEMENT VERIFICATION TESTS
    // ============================================================
    describe('Entitlement Verification', () => {
      it('should return 404 for non-existent purchase intent', async () => {
        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ purchase_intent_id: 'non_existent_id_12345' });

        expect(response.status).toBe(404);
      });

      it('should return 400 when no parameters provided', async () => {
        const response = await request(app)
          .get('/api/v1/entitlements/verify');

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('invalid_request');
      });

      it('should return 401 for invalid unlock token', async () => {
        const response = await request(app)
          .get('/api/v1/entitlements/verify')
          .query({ unlock_token: 'invalid_token_12345' });

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('invalid_token');
      });
    });

    // ============================================================
    // PRODUCT MANAGEMENT TESTS (via API)
    // ============================================================
    describe('Admin API - Products', () => {
      it('should list products', async () => {
        const response = await request(app)
          .get('/api/v1/admin/products')
          .set('X-API-Key', TEST_API_KEY);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('data');
        expect(Array.isArray(response.body.data)).toBe(true);
      });

      it('should create a new product via API', async () => {
        const productName = `API Test Product ${Date.now()}`;
        
        const response = await request(app)
          .post('/api/v1/admin/products')
          .set('X-API-Key', TEST_API_KEY)
          .send({
            name: productName,
            description: 'Created via E2E test',
            type: 'one_time',
          });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('id');
        expect(response.body.name).toBe(productName);

        // Cleanup: Archive the product
        await request(app)
          .delete(`/api/v1/admin/products/${response.body.id}`)
          .set('X-API-Key', TEST_API_KEY);
      });

      it('should get product by ID', async () => {
        if (!testProductId) {
          console.log('Skipping - no test product');
          return;
        }

        const response = await request(app)
          .get(`/api/v1/admin/products/${testProductId}`)
          .set('X-API-Key', TEST_API_KEY);

        expect(response.status).toBe(200);
        expect(response.body.id).toBe(testProductId);
      });

      it('should return 404 for non-existent product', async () => {
        const fakeUUID = '00000000-0000-0000-0000-000000000000';
        const response = await request(app)
          .get(`/api/v1/admin/products/${fakeUUID}`)
          .set('X-API-Key', TEST_API_KEY);

        expect(response.status).toBe(404);
      });
    });

    // ============================================================
    // CUSTOMER MANAGEMENT TESTS (via API)
    // ============================================================
    describe('Admin API - Customers', () => {
      it('should list customers', async () => {
        const response = await request(app)
          .get('/api/v1/admin/customers')
          .set('X-API-Key', TEST_API_KEY);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('data');
      });

      it('should return 404 for non-existent customer', async () => {
        const fakeUUID = '00000000-0000-0000-0000-000000000000';
        const response = await request(app)
          .get(`/api/v1/admin/customers/${fakeUUID}`)
          .set('X-API-Key', TEST_API_KEY);

        expect(response.status).toBe(404);
      });
    });

    // 削除済みテスト（Stripe に委譲）:
    // - Coupon System → Stripe Coupon / Promotion Code
    // - Multi-Currency → Stripe 自動通貨変換
    // - Legal Templates → 外部法的テンプレートサービス
    // - GDPR Compliance → 外部コンプライアンスツール
    // - Monitoring & Metrics → 外部モニタリング（Datadog 等）

    // ============================================================
    // DEVELOPER ONBOARDING TESTS (via API)
    // ============================================================
    describe('Developer Onboarding', () => {
      it('should get current developer info', async () => {
        const response = await request(app)
          .get('/api/v1/onboarding/me')
          .set('X-API-Key', TEST_API_KEY);

        expect(response.status).toBe(200);
        // API returns { developer: { ... } }
        const dev = response.body.developer || response.body;
        expect(dev).toHaveProperty('id');
        expect(dev).toHaveProperty('email');
      });

      it('should get onboarding status', async () => {
        const response = await request(app)
          .get('/api/v1/onboarding/status')
          .set('X-API-Key', TEST_API_KEY);

        expect([200, 404]).toContain(response.status);
      });

      it('should get quick-start guide', async () => {
        const response = await request(app)
          .get('/api/v1/onboarding/quick-start')
          .set('X-API-Key', TEST_API_KEY);

        if (response.status === 200) {
          expect(response.body).toHaveProperty('developer');
        }
      });
    });

    // Invoice テストは削除済み（Stripe Invoicing に委譲）

    // ============================================================
    // AUDIT LOG TESTS (via API)
    // ============================================================
    describe('Audit Logs', () => {
      it('should list audit logs', async () => {
        const response = await request(app)
          .get('/api/v1/admin/audit-logs')
          .set('X-API-Key', TEST_API_KEY);

        expect(response.status).toBe(200);
        // API returns { data: [...], pagination: {...} }
        const logs = response.body.logs || response.body.data;
        expect(Array.isArray(logs)).toBe(true);
      });

      it('should filter audit logs by action', async () => {
        const response = await request(app)
          .get('/api/v1/admin/audit-logs')
          .query({ action: 'product.created' })
          .set('X-API-Key', TEST_API_KEY);

        expect(response.status).toBe(200);
      });
    });

    // ============================================================
    // ERROR HANDLING TESTS
    // ============================================================
    describe('Error Handling', () => {
      it('should return 404 for unknown routes', async () => {
        const response = await request(app).get('/api/v1/unknown-route');

        expect(response.status).toBe(404);
      });

      it('should return proper error format', async () => {
        const response = await request(app)
          .get('/api/v1/admin/products')
          .set('X-API-Key', 'invalid_key');

        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
        expect(response.body.error).toHaveProperty('type');
      });
    });

    // ============================================================
    // API DOCUMENTATION TESTS
    // ============================================================
    describe('API Documentation', () => {
      it('should serve OpenAPI spec', async () => {
        const response = await request(app).get('/api-docs.json');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('openapi');
        expect(response.body).toHaveProperty('info');
        expect(response.body).toHaveProperty('paths');
      });

      it('should serve Swagger UI', async () => {
        const response = await request(app).get('/api-docs/');

        expect([200, 301, 304]).toContain(response.status);
      });
    });
  });
}
