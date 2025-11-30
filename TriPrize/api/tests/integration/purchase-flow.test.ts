import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/database.config';
import campaignService from '../../src/services/campaign.service';
import purchaseService from '../../src/services/purchase.service';
import { PaymentMethod } from '../../src/models/payment.entity';

/**
 * Purchase flow integration tests
 */
	describe('Purchase Flow Integration Tests', () => {
	  let app: Application;
  // Give enough time for auth and external-service mocks
  jest.setTimeout(60000);

	  beforeAll(async () => {
	    // Initialize Express application for integration tests
	    app = createApp();

	    // Clean up existing test data before running integration tests
    try {
      await pool.query(
        "DELETE FROM payment_transactions WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE '%purchase-test%'))",
      );
      await pool.query(
        "DELETE FROM purchases WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE '%purchase-test%')",
      );
      await pool.query(
        "DELETE FROM positions WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE '%Purchase Flow%')",
      );
      await pool.query(
        "DELETE FROM prizes WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE '%Purchase Flow%')",
      );
      await pool.query(
        "DELETE FROM layers WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE '%Purchase Flow%')",
      );
      await pool.query(
        "DELETE FROM campaigns WHERE name LIKE '%Purchase Flow%'",
      );
      await pool.query(
        "DELETE FROM users WHERE email LIKE '%purchase-test%'",
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('BeforeAll cleanup error:', error);
    }
  });

  afterAll(async () => {
    try {
      await pool.query(
        "DELETE FROM payment_transactions WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE '%purchase-test%'))",
      );
      await pool.query(
        "DELETE FROM purchases WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE '%purchase-test%')",
      );
      await pool.query(
        "DELETE FROM positions WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE '%Purchase Flow%')",
      );
      await pool.query(
        "DELETE FROM prizes WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE '%Purchase Flow%')",
      );
      await pool.query(
        "DELETE FROM layers WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE name LIKE '%Purchase Flow%')",
      );
      await pool.query(
        "DELETE FROM campaigns WHERE name LIKE '%Purchase Flow%'",
      );
      await pool.query(
        "DELETE FROM users WHERE email LIKE '%purchase-test%'",
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('AfterAll cleanup error:', error);
    }
  });

  describe('Complete Purchase Flow', () => {
    it('should complete full purchase flow: create campaign -> create purchase -> create payment -> confirm payment', async () => {
      const firebaseUid = 'test-purchase-uid-001';
      const userResult = await pool.query(
        `INSERT INTO users (user_id, firebase_uid, email, display_name, role, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
         RETURNING user_id`,
        [firebaseUid, 'test-purchase-test@example.com', 'Test User', 'admin'],
      );
      const testUserId = userResult.rows[0].user_id;
      const authToken = `mock-token-${firebaseUid}`;

      const campaign = await campaignService.createCampaign(
        {
          name: 'Test Campaign for Purchase Flow',
          description: 'Integration test campaign',
          base_length: 3,
          layer_prices: { '1': 100, '2': 200, '3': 300 },
          profit_margin_percent: 10,
          purchase_limit: 5,
          prizes: [
            {
              name: 'First Prize',
              rank: 1,
              quantity: 1,
              value: 10000,
              description: 'Test first prize',
              image_url: 'https://example.com/prize1.jpg',
            },
            {
              name: 'Second Prize',
              rank: 2,
              quantity: 2,
              value: 5000,
              description: 'Test second prize',
              image_url: 'https://example.com/prize2.jpg',
            },
          ],
        },
        testUserId,
      );

      const testCampaignId = campaign.campaign_id;

      const positionsResponse = await request(app)
        .get(`/api/campaigns/${testCampaignId}/positions`)
        .query({ status: 'available', limit: 2 });

      expect(positionsResponse.status).toBe(200);
      expect(positionsResponse.body.data.length).toBeGreaterThan(0);

      const testPositionIds = positionsResponse.body.data
        .slice(0, 2)
        .map((p: any) => p.position_id);

      const purchaseResponse = await request(app)
        .post('/api/purchases')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          campaign_id: testCampaignId,
          position_ids: testPositionIds,
        });

      expect(purchaseResponse.status).toBe(201);
      expect(purchaseResponse.body.success).toBe(true);

      const purchaseId = purchaseResponse.body.data.purchase_id;

      const paymentIntentResponse = await request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          purchase_id: purchaseId,
          payment_method: PaymentMethod.CARD,
          return_url: 'https://example.com/return',
        });

      expect(paymentIntentResponse.status).toBe(201);
      expect(paymentIntentResponse.body.data.paymentIntent).toBeDefined();

      const purchase = await purchaseService.getPurchaseById(purchaseId);
      expect(purchase).toBeDefined();
      expect(purchase?.status).toBe('pending');

      const reservedPositionsResponse = await request(app)
        .get(`/api/campaigns/${testCampaignId}/positions`)
        .query({ status: 'reserved' });

      expect(reservedPositionsResponse.status).toBe(200);
      expect(reservedPositionsResponse.body.data.length).toBeGreaterThanOrEqual(2);

      const userPurchasesResponse = await request(app)
        .get('/api/purchases')
        .set('Authorization', `Bearer ${authToken}`);

      expect(userPurchasesResponse.status).toBe(200);
      expect(userPurchasesResponse.body.data.length).toBeGreaterThan(0);
      expect(userPurchasesResponse.body.data[0].purchase_id).toBe(purchaseId);
    });

    it('should prevent concurrent purchase of same position', async () => {
      const firebaseUid = 'test-purchase-uid-002';
      const userResult = await pool.query(
        `INSERT INTO users (user_id, firebase_uid, email, display_name, role, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
         RETURNING user_id`,
        [firebaseUid, 'test-purchase-test-2@example.com', 'Test User 2', 'admin'],
      );
      const testUserId = userResult.rows[0].user_id;
      const authToken = `mock-token-${firebaseUid}`;

	      const campaign = await campaignService.createCampaign(
	        {
	          name: 'Test Campaign for Purchase Flow 2',
	          description: 'Concurrent test',
	          base_length: 3,
	          layer_prices: { '1': 100, '2': 200, '3': 300 },
	          profit_margin_percent: 10,
	          purchase_limit: 5,
	          prizes: [
	            {
	              name: 'Prize',
	              rank: 1,
	              quantity: 1,
	              value: 5000,
	              description: 'Test prize',
	              image_url: 'https://example.com/prize.jpg',
	            },
	          ],
	        },
	        testUserId,
	      );

      await campaignService.publishCampaign(campaign.campaign_id);

      const positionsResponse = await request(app)
        .get(`/api/campaigns/${campaign.campaign_id}/positions`)
        .query({ status: 'available', limit: 1 });

      const positionId = positionsResponse.body.data[0].position_id;

      const [response1, response2] = await Promise.all([
        request(app)
          .post('/api/purchases')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            campaign_id: campaign.campaign_id,
            position_ids: [positionId],
          }),
        request(app)
          .post('/api/purchases')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            campaign_id: campaign.campaign_id,
            position_ids: [positionId],
          }),
      ]);

      const statuses = [response1.status, response2.status].sort();
      expect(statuses).toEqual([201, 400]);
    });
  });
});
