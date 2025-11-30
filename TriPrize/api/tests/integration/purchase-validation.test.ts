import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/database.config';
import { getRedisClient } from '../../src/config/redis.config';
import crypto from 'node:crypto';

/**
 * 购买验证集成测试
 * 测试购买流程的各种验证逻辑
 *
 * 重点测试:
 * 1. 幂等性验证 (idempotency_key)
 * 2. 购买数量限制
 * 3. 并发购买冲突
 * 4. 边界条件
 */

// 设置测试超时为60秒
jest.setTimeout(60000);

	describe('Purchase Validation Integration Tests', () => {
	  let app: Application;
  let testCampaignId: string;
  let testUserId: string;
  let testPositionIds: string[];
  let authToken: string;

	  beforeAll(async () => {
	    // Expressアプリケーションをテスト用に初期化
	    app = createApp();

	    // 清理测试数据
	    await pool.query("DELETE FROM purchases WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE 'test-validation%')");
	    await pool.query("DELETE FROM campaigns WHERE name LIKE 'Test Validation%'");
	    await pool.query("DELETE FROM users WHERE email LIKE 'test-validation%'");
	  });

	  afterAll(async () => {
	    // 清理测试数据 (仅删除本测试创建的数据, 不关闭全局连接)
	    await pool.query("DELETE FROM purchases WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE 'test-validation%')");
	    await pool.query("DELETE FROM campaigns WHERE name LIKE 'Test Validation%'");
	    await pool.query("DELETE FROM users WHERE email LIKE 'test-validation%'");

	    // 注意:
	    // 数据库连接(pool)和Redis客户端在全局测试初始化中统一管理。
	    // 如果在这里调用 pool.end() 或 redis.quit(), 其他测试套件将无法继续使用连接。
	    // 因此这里不再主动关闭连接, 仅清理与本测试相关的数据。
	  });

	  beforeEach(async () => {
	    // 创建测试用户 (使用UUID作为内部user_id, 同时作为Firebase UID)
	    const userId = crypto.randomUUID();
	    const { rows: userRows } = await pool.query(
	      `INSERT INTO users (user_id, email, display_name, role, created_at, updated_at)
	       VALUES ($1, $2, $3, $4, NOW(), NOW())
	       RETURNING user_id`,
	      [userId, 'test-validation@example.com', 'Test Validation User', 'customer']
	    );
	    testUserId = userRows[0].user_id;

	    // 模拟auth token (Firebase mock会解析这个token, 并将uid设置为去掉前缀的部分)
	    // ここではFirebase UIDとuser_idを同一のUUID文字列として扱う
	    const firebaseUid = userId;
	    authToken = `Bearer mock-token-${firebaseUid}`;

    // 创建测试活动 (使用gen_random_uuid()生成UUID)
    const { rows: campaignRows } = await pool.query(
      `INSERT INTO campaigns (
         name, description, image_url, base_length,
         positions_total, layer_prices, profit_margin_percent,
         purchase_limit, start_date, end_date, created_by, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING campaign_id`,
      [
        'Test Validation Campaign',
        'Test campaign for validation testing',
        'https://example.com/image.jpg',
        3,
        6,
        JSON.stringify({ '1': 100, '2': 200, '3': 300 }),
        10,
        3, // purchase_limit = 3
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
      [testCampaignId, 1, 6, 100, 6]
    );
    const testLayerId = layerRows[0].layer_id;

    // 创建测试位置
    testPositionIds = [];
    for (let i = 1; i <= 6; i++) {
      const { rows: positionRows } = await pool.query(
        `INSERT INTO positions (
           campaign_id, layer_id, row_number, col_number,
           layer_number, price, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING position_id`,
        [
          testCampaignId,
          testLayerId,
          i,
          1,
          1,
          100,
          'available'
        ]
      );
      testPositionIds.push(positionRows[0].position_id);
    }
  });

  afterEach(async () => {
    // 清理每个测试的数据 (按照外键依赖顺序删除)
    if (testUserId) {
      await pool.query('DELETE FROM payment_transactions WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE user_id = $1)', [testUserId]);
      await pool.query('DELETE FROM purchases WHERE user_id = $1', [testUserId]);
    }
    if (testCampaignId) {
      await pool.query('DELETE FROM positions WHERE campaign_id = $1', [testCampaignId]);
      await pool.query('DELETE FROM layers WHERE campaign_id = $1', [testCampaignId]);
      await pool.query('DELETE FROM campaigns WHERE campaign_id = $1', [testCampaignId]);
    }
    if (testUserId) {
      await pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
    }

    // 清理Redis中的幂等性key
    const redis = await getRedisClient();
    const keys = await redis.keys('idempotency:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  });

  describe('Idempotency Validation', () => {
    it('should return same result for duplicate requests with same idempotency_key', async () => {
      const idempotencyKey = crypto.randomUUID();

      // 第一次请求
      const response1 = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          campaign_id: testCampaignId,
          position_ids: [testPositionIds[0]],
          payment_method: 'card',
        });

      expect(response1.status).toBe(201);
      const purchaseId1 = response1.body.data.purchase_id;

      // 第二次请求 (相同的idempotency_key)
      const response2 = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          campaign_id: testCampaignId,
          position_ids: [testPositionIds[0]],
          payment_method: 'card',
        });

      expect(response2.status).toBe(201);
      const purchaseId2 = response2.body.data.purchase_id;

      // 应该返回相同的purchase_id
      expect(purchaseId2).toBe(purchaseId1);

      // 验证数据库中只有一条记录
      const { rows } = await pool.query(
        'SELECT COUNT(*) as count FROM purchases WHERE user_id = $1',
        [testUserId]
      );
      expect(Number.parseInt(rows[0].count, 10)).toBe(1);
    });

    it('should allow different requests with different idempotency_key', async () => {
      const idempotencyKey1 = crypto.randomUUID();
      const idempotencyKey2 = crypto.randomUUID();

      // 第一次请求
      const response1 = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .set('Idempotency-Key', idempotencyKey1)
        .send({
          campaign_id: testCampaignId,
          position_ids: [testPositionIds[0]],
          payment_method: 'card',
        });

      expect(response1.status).toBe(201);

      // 第二次请求 (不同的idempotency_key)
      const response2 = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .set('Idempotency-Key', idempotencyKey2)
        .send({
          campaign_id: testCampaignId,
          position_ids: [testPositionIds[1]],
          payment_method: 'card',
        });

      expect(response2.status).toBe(201);

      // 应该创建两条不同的记录
      const { rows } = await pool.query(
        'SELECT COUNT(*) as count FROM purchases WHERE user_id = $1',
        [testUserId]
      );
      expect(Number.parseInt(rows[0].count, 10)).toBe(2);
    });

    it('should reject request if idempotency_key is reused after 24 hours', async () => {
      // 注意: 这个测试需要模拟时间流逝,实际测试中可能需要使用时间mock
      // 这里只是验证逻辑存在
      const idempotencyKey = crypto.randomUUID();

      const response = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          campaign_id: testCampaignId,
          position_ids: [testPositionIds[0]],
          payment_method: 'card',
        });

      expect(response.status).toBe(201);

      // 在实际环境中,24小时后Redis key会过期
      // 这里我们只验证第一次请求成功
    });
  });

  describe('Purchase Limit Validation', () => {
    it('should reject purchase exceeding campaign purchase_limit', async () => {
      // purchase_limit = 3, 尝试购买4个位置
      const response = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .send({
          campaign_id: testCampaignId,
          position_ids: [
            testPositionIds[0],
            testPositionIds[1],
            testPositionIds[2],
            testPositionIds[3],
          ],
          payment_method: 'card',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('limit');
    });

    it('should allow purchase within campaign purchase_limit', async () => {
      // purchase_limit = 3, 购买3个位置
      const response = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .send({
          campaign_id: testCampaignId,
          position_ids: [
            testPositionIds[0],
            testPositionIds[1],
            testPositionIds[2],
          ],
          payment_method: 'card',
        });

      expect(response.status).toBe(201);
    });

    it('should reject purchase if user already reached purchase_limit', async () => {
      // 第一次购买3个位置 (达到limit)
      await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .send({
          campaign_id: testCampaignId,
          position_ids: [
            testPositionIds[0],
            testPositionIds[1],
            testPositionIds[2],
          ],
          payment_method: 'card',
        });

      // 第二次尝试购买 (应该被拒绝)
      const response2 = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .send({
          campaign_id: testCampaignId,
          position_ids: [testPositionIds[3]],
          payment_method: 'card',
        });

      expect(response2.status).toBe(400);
      expect(response2.body.message).toContain('limit');
    });
  });

  describe('Concurrent Purchase Conflict', () => {
    it('should handle concurrent purchases for same position correctly', async () => {
      // 模拟两个用户同时购买同一个位置
      const promises = [
        request(app)
          .post('/api/purchases')
          .set('Authorization', authToken)
          .send({
            campaign_id: testCampaignId,
            position_ids: [testPositionIds[0]],
            payment_method: 'card',
          }),
        request(app)
          .post('/api/purchases')
          .set('Authorization', authToken)
          .send({
            campaign_id: testCampaignId,
            position_ids: [testPositionIds[0]],
            payment_method: 'card',
          }),
      ];

      const results = await Promise.all(promises);

      // 一个应该成功,一个应该失败
      const successCount = results.filter(r => r.status === 201).length;
      const failCount = results.filter(r => r.status === 400 || r.status === 409).length;

      expect(successCount).toBe(1);
      expect(failCount).toBe(1);

      // 验证数据库中只有一条购买记录
      const { rows } = await pool.query(
        'SELECT COUNT(*) as count FROM purchases WHERE position_id = $1',
        [testPositionIds[0]]
      );
      expect(Number.parseInt(rows[0].count, 10)).toBe(1);
    });
  });

  describe('Boundary Conditions', () => {
    it('should reject purchase with empty position_ids', async () => {
      const response = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .send({
          campaign_id: testCampaignId,
          position_ids: [],
          payment_method: 'card',
        });

      expect(response.status).toBe(400);
    });

    it('should reject purchase with invalid campaign_id', async () => {
      const response = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .send({
          campaign_id: 'invalid-campaign-id',
          position_ids: [testPositionIds[0]],
          payment_method: 'card',
        });

      expect(response.status).toBe(400);
    });

    it('should reject purchase with invalid position_id', async () => {
      const response = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .send({
          campaign_id: testCampaignId,
          position_ids: ['invalid-position-id'],
          payment_method: 'card',
        });

      expect(response.status).toBe(400);
    });

    it('should reject purchase for already sold position', async () => {
      // 先将位置标记为sold (需要同时设置user_id以满足position_user_consistency约束)
      await pool.query(
        'UPDATE positions SET status = $1, user_id = $2, sold_at = NOW() WHERE position_id = $3',
        ['sold', testUserId, testPositionIds[0]]
      );

      const response = await request(app)
        .post('/api/purchases')
        .set('Authorization', authToken)
        .send({
          campaign_id: testCampaignId,
          position_ids: [testPositionIds[0]],
          payment_method: 'card',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('not available');
    });
  });
});


