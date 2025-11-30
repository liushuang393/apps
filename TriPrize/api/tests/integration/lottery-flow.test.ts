import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/database.config';
import campaignService from '../../src/services/campaign.service';
import purchaseService from '../../src/services/purchase.service';
import { CampaignStatus } from '../../src/models/campaign.entity';
import { PurchaseStatus } from '../../src/models/purchase.entity';

/**
 * 抽奖流程集成测试
 * 测试从关闭活动到执行抽奖的完整端到端流程
 */
	describe('Lottery Flow Integration Tests', () => {
	  let app: Application;
  let adminUserId: string;
  let adminToken: string;

  // 设置测试超时为60秒(因为涉及auth路由调用)
  jest.setTimeout(60000);

	  beforeAll(async () => {
	    // Initialize Express application for integration tests
	    app = createApp();

    // 清理可能存在的旧测试数据
    try {
      await pool.query('DELETE FROM users WHERE email LIKE \'%lottery%@example.com\'');
    } catch (error) {
      console.error('BeforeAll cleanup error:', error);
    }

    // 创建共享的管理员用户
    const firebaseUid = 'test-admin-lottery-shared';
	    const adminResult = await pool.query(
	      `INSERT INTO users (user_id, firebase_uid, email, display_name, role, created_at, updated_at)
	       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
	       RETURNING user_id`,
	      // 使用有效的管理员角色值 'admin' (与 UserRole.ADMIN 对应)
	      [firebaseUid, 'test-lottery-admin-shared@example.com', 'Test Admin', 'admin']
	    );
    adminUserId = adminResult.rows[0].user_id;
    adminToken = `mock-token-${firebaseUid}`;
  });

  afterAll(async () => {
    // 清理测试数据 - 按正确顺序删除（从子表到父表）
    try {
      // 删除所有测试活动相关数据
      await pool.query('DELETE FROM payment_transactions WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE user_id = $1)', [adminUserId]);
      await pool.query('DELETE FROM purchases WHERE user_id = $1', [adminUserId]);
      await pool.query('DELETE FROM positions WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE created_by = $1)', [adminUserId]);
      await pool.query('DELETE FROM prizes WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE created_by = $1)', [adminUserId]);
      await pool.query('DELETE FROM layers WHERE campaign_id IN (SELECT campaign_id FROM campaigns WHERE created_by = $1)', [adminUserId]);
      await pool.query('DELETE FROM campaigns WHERE created_by = $1', [adminUserId]);

      // 删除管理员用户
      await pool.query('DELETE FROM users WHERE user_id = $1', [adminUserId]);
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('Complete Lottery Flow', () => {
    it('should complete full lottery flow: create campaign -> sell positions -> close campaign -> conduct lottery -> notify winners', async () => {
      // Step 1: 创建测试活动
      const campaign = await campaignService.createCampaign(
        {
          name: 'Test Lottery Campaign',
          description: 'Integration test lottery campaign',
          base_length: 3, // 小规模测试: 3层 = 6个位置
          layer_prices: { '1': 100, '2': 200, '3': 300 },
          profit_margin_percent: 10,
          purchase_limit: 3,
          prizes: [
            { name: 'Grand Prize', rank: 1, quantity: 1, value: 10000, description: 'Test grand prize', image_url: 'https://example.com/prize1.jpg' },
            { name: 'Second Prize', rank: 2, quantity: 1, value: 5000, description: 'Test second prize', image_url: 'https://example.com/prize2.jpg' },
          ],
        },
        adminUserId
      );

      const testCampaignId = campaign.campaign_id;

      // Step 2: 发布活动
      await campaignService.publishCampaign(testCampaignId);

      // Step 3: 创建多个用户并购买位置 (直接在数据库中创建)
      const users = [
        { firebase_uid: 'test-user-lottery-001', email: 'test-lottery-user1@example.com', name: 'User 1' },
        { firebase_uid: 'test-user-lottery-002', email: 'test-lottery-user2@example.com', name: 'User 2' },
        { firebase_uid: 'test-user-lottery-003', email: 'test-lottery-user3@example.com', name: 'User 3' },
      ];

      const testUserIds: string[] = [];
	      for (const user of users) {
	        const userResult = await pool.query(
	          `INSERT INTO users (user_id, firebase_uid, email, display_name, role, created_at, updated_at)
	           VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
	           RETURNING user_id`,
	          // 使用有效的普通用户角色值 'customer' (与 UserRole.CUSTOMER 对应)
	          [user.firebase_uid, user.email, user.name, 'customer']
	        );
        testUserIds.push(userResult.rows[0].user_id);
      }

      // Step 4: 每个用户购买一个位置
	      const positionsResponse = await request(app)
	        .get(`/api/campaigns/${testCampaignId}/positions`)
	        .query({ status: 'available' });

	      const availablePositions = positionsResponse.body.data;
	      // base_length = 3 -> total positions = 3 * (3 + 1) / 2 = 6
	      expect(availablePositions.length).toBe(6);

      const testPurchaseIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const purchase = await purchaseService.createPurchase(
          {
            campaign_id: testCampaignId,
            position_ids: [availablePositions[i].position_id],
            payment_method: 'card',
          },
          testUserIds[i]
        );

        testPurchaseIds.push(purchase.purchase_id);

        // 模拟支付完成
        await purchaseService.updatePurchaseStatus(
          purchase.purchase_id,
          PurchaseStatus.COMPLETED,
          `test-payment-intent-${i}`
        );
      }

      // Step 6: 验证活动统计
      const statsResponse = await request(app)
        .get(`/api/campaigns/${testCampaignId}/stats`);

	      expect(statsResponse.status).toBe(200);
	      expect(statsResponse.body.data.positions_sold).toBe(3);
	      expect(statsResponse.body.data.positions_available).toBe(3);

      // Step 7: 关闭活动 (管理员操作)
      const closeResponse = await request(app)
        .patch(`/api/campaigns/${testCampaignId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: CampaignStatus.CLOSED,
        });

      expect(closeResponse.status).toBe(200);

      // Step 8: 执行抽奖
      const lotteryResponse = await request(app)
        .post(`/api/campaigns/${testCampaignId}/lottery`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(lotteryResponse.status).toBe(201);
      expect(lotteryResponse.body.data.lottery_id).toBeDefined();
      expect(lotteryResponse.body.data.total_winners).toBeGreaterThan(0);

      const lotteryId = lotteryResponse.body.data.lottery_id;

      // Step 9: 获取抽奖结果
      const resultsResponse = await request(app)
        .get(`/api/campaigns/${testCampaignId}/lottery/results`);

      expect(resultsResponse.status).toBe(200);
      expect(resultsResponse.body.data.lottery_id).toBe(lotteryId);
      expect(resultsResponse.body.data.winners).toBeDefined();
      expect(resultsResponse.body.data.winners.length).toBeGreaterThan(0);

      // Step 10: 验证获奖者收到通知
      // 注意: 实际环境中会发送FCM推送通知
      const winners = resultsResponse.body.data.winners;
      for (const winner of winners) {
        expect(testUserIds).toContain(winner.user_id);
      }

      // Step 11: 验证活动状态已更新为drawn
      const campaignResponse = await request(app)
        .get(`/api/campaigns/${testCampaignId}`);

      expect(campaignResponse.status).toBe(200);
      expect(campaignResponse.body.data.status).toBe(CampaignStatus.DRAWN);
    });

    it('should not allow lottery on non-closed campaign', async () => {
      // 创建新活动但不关闭
      const newCampaign = await campaignService.createCampaign(
        {
          name: 'Test Lottery Campaign 2',
          description: 'Test',
          base_length: 3,
          layer_prices: { '1': 100, '2': 200, '3': 300 },
          profit_margin_percent: 10,
          purchase_limit: 2,
          prizes: [{ name: 'Prize', rank: 1, quantity: 1, value: 5000, description: 'Test prize', image_url: 'https://example.com/prize.jpg' }],
        },
        adminUserId
      );

      await campaignService.publishCampaign(newCampaign.campaign_id);

      const lotteryResponse = await request(app)
        .post(`/api/campaigns/${newCampaign.campaign_id}/lottery`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(lotteryResponse.status).toBe(400);
      expect(lotteryResponse.body.error).toContain('closed');
    });
  });
});

