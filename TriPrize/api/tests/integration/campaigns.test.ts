import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/database.config';
import campaignService from '../../src/services/campaign.service';
import { UserRole } from '../../src/models/user.entity';

describe('Campaigns API Integration Tests', () => {
  let app: ReturnType<typeof createApp>;
  let adminUserId: string;
  let testCampaignId: string;

  beforeAll(async () => {
    // Initialize Express application for integration tests
    app = createApp();

    // Create a test admin user
    const adminEmail = 'test-campaigns-admin@example.com';
    const nodeCrypto = require('node:crypto');
    const hash = nodeCrypto.createHash('md5').update(adminEmail).digest('hex');
    const firebaseUid = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;

    const adminResult = await pool.query(
      `INSERT INTO users (user_id, firebase_uid, email, display_name, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET
         firebase_uid = EXCLUDED.firebase_uid,
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         updated_at = NOW()
       RETURNING user_id`,
      [firebaseUid, firebaseUid, adminEmail, 'Test Admin', UserRole.ADMIN]
    );
    adminUserId = adminResult.rows[0].user_id;

    // Create a test campaign
    const campaign = await campaignService.createCampaign(
      {
        name: 'Test Campaign for Stats',
        description: 'Test campaign for stats endpoint',
        base_length: 3,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        purchase_limit: 3,
        prizes: [
          { name: 'Prize 1', rank: 1, quantity: 1, value: 1000, description: 'Test prize', image_url: 'https://example.com/prize.jpg' },
        ],
      },
      adminUserId
    );
    testCampaignId = campaign.campaign_id;

    // Publish the campaign
    await campaignService.publishCampaign(testCampaignId);
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await pool.query('DELETE FROM payment_transactions WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE campaign_id = $1)', [testCampaignId]);
      await pool.query('DELETE FROM purchases WHERE campaign_id = $1', [testCampaignId]);
      await pool.query('DELETE FROM positions WHERE campaign_id = $1', [testCampaignId]);
      await pool.query('DELETE FROM prizes WHERE campaign_id = $1', [testCampaignId]);
      await pool.query('DELETE FROM layers WHERE campaign_id = $1', [testCampaignId]);
      await pool.query('DELETE FROM campaigns WHERE campaign_id = $1', [testCampaignId]);
      await pool.query('DELETE FROM users WHERE user_id = $1', [adminUserId]);
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('GET /api/campaigns', () => {
    it('should return list of campaigns', async () => {
      const response = await request(app)
        .get('/api/campaigns')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter campaigns by status', async () => {
      const response = await request(app)
        .get('/api/campaigns?status=published')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);

      // All campaigns should have status 'published'
      response.body.data.forEach((campaign: any) => {
        expect(campaign.status).toBe('published');
      });
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/campaigns?limit=5&offset=0')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
      expect(response.body.pagination).toHaveProperty('limit', 5);
      expect(response.body.pagination).toHaveProperty('offset', 0);
    });
  });

  describe('GET /api/campaigns/:campaignId', () => {
    it('should return 404 for non-existent campaign', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .get(`/api/campaigns/${fakeId}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await request(app)
        .get('/api/campaigns/invalid-uuid')
        .expect(400);

      expect(response.body).toHaveProperty('error', 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/campaigns', () => {
    it('should require authentication', async () => {
      const campaignData = {
        name: 'Test Campaign',
        base_length: 5,
        layer_prices: { '1': 500, '2': 400, '3': 300, '4': 200, '5': 100 },
        profit_margin_percent: 30,
        prizes: [
          {
            name: 'Grand Prize',
            rank: 1,
            quantity: 1,
          },
        ],
      };

      const response = await request(app)
        .post('/api/campaigns')
        .send(campaignData)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'UNAUTHORIZED');
    });

    it('should reject invalid campaign data even with authentication', async () => {
      const invalidData = {
        name: 'Test',
        // Missing required fields
      };

      const response = await request(app)
        .post('/api/campaigns')
        .set('Authorization', 'Bearer fake-token')
        .send(invalidData)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/campaigns/:campaignId/stats', () => {
    it('should return campaign statistics', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${testCampaignId}/stats`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('positions_total');
      expect(response.body.data).toHaveProperty('positions_sold');
      expect(response.body.data).toHaveProperty('progress_percent');
      expect(response.body.data).toHaveProperty('unique_buyers');
      expect(response.body.data).toHaveProperty('total_revenue');
    });
  });
});
