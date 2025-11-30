/**
 * API业务流程测试 - 直接测试数据库和服务层
 * 绕过Firebase认证，直接测试业务逻辑
 */

import { Pool } from 'pg';
import * as campaignService from '../../api/src/services/campaign.service';
import * as purchaseService from '../../api/src/services/purchase.service';
import * as lotteryService from '../../api/src/services/lottery.service';
import { PurchaseStatus } from '../../api/src/models/purchase.entity';
import { CampaignStatus } from '../../api/src/models/campaign.entity';

const pool = new Pool({
  connectionString: 'postgresql://triprize:triprize_password@localhost:5432/triprize',
});

describe('完整业务流程测试（API层）', () => {
  let adminUserId: string;
  let userUserId: string;
  let campaignId: string;
  let positionIds: string[] = [];
  let purchaseId: string;

  beforeAll(async () => {
    // 清理旧测试数据
    await pool.query('DELETE FROM users WHERE email LIKE \'%api-e2e-test%\'');
  });

  afterAll(async () => {
    // 清理测试数据
    try {
      await pool.query('DELETE FROM payment_transactions WHERE purchase_id IN (SELECT purchase_id FROM purchases WHERE user_id IN ($1, $2))', [adminUserId, userUserId]);
      await pool.query('DELETE FROM purchases WHERE user_id IN ($1, $2)', [adminUserId, userUserId]);
      await pool.query('DELETE FROM positions WHERE campaign_id = $1', [campaignId]);
      await pool.query('DELETE FROM prizes WHERE campaign_id = $1', [campaignId]);
      await pool.query('DELETE FROM layers WHERE campaign_id = $1', [campaignId]);
      await pool.query('DELETE FROM campaigns WHERE campaign_id = $1', [campaignId]);
      await pool.query('DELETE FROM users WHERE user_id IN ($1, $2)', [adminUserId, userUserId]);
    } catch (error) {
      console.error('Cleanup error:', error);
    }
    await pool.end();
  });

  test('1. 创建管理员用户', async () => {
    const result = await pool.query(
      `INSERT INTO users (user_id, firebase_uid, email, display_name, role, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       RETURNING user_id`,
      [`api-e2e-admin-${Date.now()}`, `admin-api-e2e-test@example.com`, 'API E2E Admin', 'ADMIN']
    );
    adminUserId = result.rows[0].user_id;
    expect(adminUserId).toBeDefined();
    console.log('✅ 管理员用户创建成功:', adminUserId);
  });

  test('2. 创建普通用户', async () => {
    const result = await pool.query(
      `INSERT INTO users (user_id, firebase_uid, email, display_name, role, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       RETURNING user_id`,
      [`api-e2e-user-${Date.now()}`, `user-api-e2e-test@example.com`, 'API E2E User', 'USER']
    );
    userUserId = result.rows[0].user_id;
    expect(userUserId).toBeDefined();
    console.log('✅ 普通用户创建成功:', userUserId);
  });

  test('3. 创建活动', async () => {
    const campaign = await campaignService.createCampaign(
      {
        name: `API E2E测试活动 ${Date.now()}`,
        description: 'API层完整业务流程测试',
        base_length: 3,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        purchase_limit: 5,
        prizes: [
          { name: '一等奖', rank: 1, quantity: 1, value: 10000, description: '大奖', image_url: 'https://example.com/prize1.jpg' },
          { name: '二等奖', rank: 2, quantity: 2, value: 5000, description: '二奖', image_url: 'https://example.com/prize2.jpg' },
        ],
      },
      adminUserId
    );
    
    campaignId = campaign.campaign_id;
    expect(campaignId).toBeDefined();
    expect(campaign.status).toBe(CampaignStatus.DRAFT);
    console.log('✅ 活动创建成功:', campaignId);
  });

  test('4. 发布活动', async () => {
    await campaignService.publishCampaign(campaignId);
    
    const result = await pool.query('SELECT status FROM campaigns WHERE campaign_id = $1', [campaignId]);
    expect(result.rows[0].status).toBe(CampaignStatus.PUBLISHED);
    console.log('✅ 活动发布成功');
  });

  test('5. 查询可用位置', async () => {
    const result = await pool.query(
      'SELECT position_id FROM positions WHERE campaign_id = $1 AND status = $2 LIMIT 2',
      [campaignId, 'available']
    );
    
    positionIds = result.rows.map(r => r.position_id);
    expect(positionIds.length).toBe(2);
    console.log('✅ 查询到', positionIds.length, '个可用位置');
  });

  test('6. 创建购买订单', async () => {
    const purchase = await purchaseService.createPurchase(
      {
        campaign_id: campaignId,
        position_ids: positionIds,
        payment_method: 'card',
      },
      userUserId
    );
    
    purchaseId = purchase.purchase_id;
    expect(purchaseId).toBeDefined();
    expect(purchase.status).toBe(PurchaseStatus.PENDING);
    console.log('✅ 购买订单创建成功:', purchaseId);
  });

  test('7. 模拟支付完成', async () => {
    await purchaseService.updatePurchaseStatus(
      purchaseId,
      PurchaseStatus.COMPLETED,
      'test_payment_intent_123'
    );
    
    const result = await pool.query('SELECT status FROM purchases WHERE purchase_id = $1', [purchaseId]);
    expect(result.rows[0].status).toBe(PurchaseStatus.COMPLETED);
    console.log('✅ 支付完成');
  });

  test('8. 查看活动统计', async () => {
    const stats = await campaignService.getCampaignStats(campaignId);
    expect(stats.positions_sold).toBe(2);
    expect(stats.positions_available).toBeGreaterThan(0);
    console.log('✅ 活动统计查询成功，已售出:', stats.positions_sold);
  });

  test('9. 关闭活动', async () => {
    await pool.query('UPDATE campaigns SET status = $1 WHERE campaign_id = $2', [CampaignStatus.CLOSED, campaignId]);

    const result = await pool.query('SELECT status FROM campaigns WHERE campaign_id = $1', [campaignId]);
    expect(result.rows[0].status).toBe(CampaignStatus.CLOSED);
    console.log('✅ 活动关闭成功');
  });

  test('10. 执行抽奖', async () => {
    const lotteryResult = await lotteryService.conductLottery(campaignId);

    expect(lotteryResult.winners).toBeDefined();
    expect(lotteryResult.winners.length).toBeGreaterThan(0);
    console.log('✅ 抽奖执行成功，中奖人数:', lotteryResult.winners.length);
  });

  test('11. 查看中奖结果', async () => {
    const result = await pool.query(
      `SELECT w.*, u.email, p.name as prize_name
       FROM winners w
       JOIN users u ON w.user_id = u.user_id
       JOIN prizes p ON w.prize_id = p.prize_id
       WHERE w.campaign_id = $1`,
      [campaignId]
    );

    expect(result.rows.length).toBeGreaterThan(0);
    console.log('✅ 中奖结果查询成功，中奖记录数:', result.rows.length);
    result.rows.forEach(winner => {
      console.log(`  - ${winner.email} 中奖: ${winner.prize_name}`);
    });
  });

  test('12. 验证活动状态为已抽奖', async () => {
    const result = await pool.query('SELECT status FROM campaigns WHERE campaign_id = $1', [campaignId]);
    expect(result.rows[0].status).toBe(CampaignStatus.DRAWN);
    console.log('✅ 活动状态已更新为DRAWN');
  });
});

