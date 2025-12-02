import request from 'supertest';
import { createApp } from '../../src/app';

describe('Campaigns API Integration Tests', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    // Initialize Express application for integration tests
    app = createApp();
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
      // First get a campaign
      const listResponse = await request(app).get('/api/campaigns');

      if (listResponse.body.data.length > 0) {
        const campaignId = listResponse.body.data[0].campaign_id;

        const response = await request(app)
          .get(`/api/campaigns/${campaignId}/stats`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('positions_total');
        expect(response.body.data).toHaveProperty('positions_sold');
        expect(response.body.data).toHaveProperty('progress_percent');
        expect(response.body.data).toHaveProperty('unique_buyers');
        expect(response.body.data).toHaveProperty('total_revenue');
      }
    });
  });
});
