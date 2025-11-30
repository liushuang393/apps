import { test, expect } from '@playwright/test';

const API_BASE_URL = 'http://localhost:3000';

// 测试数据
const testAdmin = {
  email: `admin-e2e-${Date.now()}@example.com`,
  password: 'Test123456!',
  displayName: 'E2E Test Admin',
};

const testUser = {
  email: `user-e2e-${Date.now()}@example.com`,
  password: 'Test123456!',
  displayName: 'E2E Test User',
};

let adminToken: string;
let userToken: string;
let campaignId: string;
let positionIds: string[] = [];
let purchaseId: string;

test.describe('完整业务流程 E2E 测试', () => {
  
  test('1. 管理员注册', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/auth/register`, {
      data: testAdmin,
    });
    
    expect(response.status()).toBe(201);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.user.email).toBe(testAdmin.email);
    adminToken = data.data.token;
    
    console.log('✅ 管理员注册成功:', testAdmin.email);
  });

  test('2. 普通用户注册', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/auth/register`, {
      data: testUser,
    });
    
    expect(response.status()).toBe(201);
    const data = await response.json();
    expect(data.success).toBe(true);
    userToken = data.data.token;
    
    console.log('✅ 普通用户注册成功:', testUser.email);
  });

  test('3. 管理员登录', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/auth/login`, {
      data: {
        email: testAdmin.email,
        password: testAdmin.password,
      },
    });
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    adminToken = data.data.token;
    
    console.log('✅ 管理员登录成功');
  });

  test('4. 创建活动（管理员）', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/campaigns`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      },
      data: {
        name: `E2E测试活动 ${Date.now()}`,
        description: '完整业务流程测试活动',
        base_length: 3,
        layer_prices: { '1': 100, '2': 200, '3': 300 },
        profit_margin_percent: 10,
        purchase_limit: 5,
        prizes: [
          { name: '一等奖', rank: 1, quantity: 1, value: 10000, description: '大奖', image_url: 'https://example.com/prize1.jpg' },
          { name: '二等奖', rank: 2, quantity: 2, value: 5000, description: '二奖', image_url: 'https://example.com/prize2.jpg' },
        ],
      },
    });
    
    expect(response.status()).toBe(201);
    const data = await response.json();
    campaignId = data.data.campaign_id;
    
    console.log('✅ 活动创建成功:', campaignId);
  });

  test('5. 发布活动（管理员）', async ({ request }) => {
    const response = await request.patch(`${API_BASE_URL}/api/campaigns/${campaignId}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      },
      data: {
        status: 'PUBLISHED',
      },
    });
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.status).toBe('PUBLISHED');
    
    console.log('✅ 活动发布成功');
  });

  test('6. 查看活动列表（公开）', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/api/campaigns?status=PUBLISHED`);
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.length).toBeGreaterThan(0);
    
    const campaign = data.data.find((c: any) => c.campaign_id === campaignId);
    expect(campaign).toBeDefined();
    
    console.log('✅ 活动列表查询成功，找到测试活动');
  });

  test('7. 查看活动详情', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/api/campaigns/${campaignId}`);
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.campaign_id).toBe(campaignId);
    expect(data.data.status).toBe('PUBLISHED');
    
    console.log('✅ 活动详情查询成功');
  });

  test('8. 查看可用位置', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/api/campaigns/${campaignId}/positions?status=available`);

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.length).toBeGreaterThan(0);

    positionIds = data.data.slice(0, 2).map((p: any) => p.position_id);

    console.log('✅ 可用位置查询成功，获取了', positionIds.length, '个位置');
  });

  test('9. 创建购买订单（用户）', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/purchases`, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      },
      data: {
        campaign_id: campaignId,
        position_ids: positionIds,
      },
    });

    expect(response.status()).toBe(201);
    const data = await response.json();
    purchaseId = data.data.purchase_id;
    expect(data.data.status).toBe('PENDING');

    console.log('✅ 购买订单创建成功:', purchaseId);
  });

  test('10. 创建支付意图', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/payments/create-payment-intent`, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      },
      data: {
        purchase_id: purchaseId,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.client_secret).toBeDefined();

    console.log('✅ 支付意图创建成功');
  });

  test('11. 模拟支付成功（直接更新状态）', async ({ request }) => {
    // 在测试环境中，我们直接调用内部API更新支付状态
    const response = await request.post(`${API_BASE_URL}/api/purchases/${purchaseId}/complete`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      },
      data: {
        payment_intent_id: 'test_payment_intent_123',
      },
    });

    // 如果没有这个端点，我们跳过
    if (response.status() === 404) {
      console.log('⚠️  跳过支付完成步骤（需要webhook）');
      test.skip();
    } else {
      expect(response.status()).toBe(200);
      console.log('✅ 支付完成');
    }
  });

  test('12. 查看我的购买记录', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/api/purchases/my-purchases`, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.length).toBeGreaterThan(0);

    const purchase = data.data.find((p: any) => p.purchase_id === purchaseId);
    expect(purchase).toBeDefined();

    console.log('✅ 购买记录查询成功');
  });

  test('13. 查看活动统计', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/api/campaigns/${campaignId}/stats`);

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.positions_sold).toBeGreaterThan(0);

    console.log('✅ 活动统计查询成功，已售出:', data.data.positions_sold);
  });

  test('14. 关闭活动（管理员）', async ({ request }) => {
    const response = await request.patch(`${API_BASE_URL}/api/campaigns/${campaignId}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      },
      data: {
        status: 'CLOSED',
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.status).toBe('CLOSED');

    console.log('✅ 活动关闭成功');
  });

  test('15. 执行抽奖（管理员）', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/campaigns/${campaignId}/lottery`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.winners).toBeDefined();

    console.log('✅ 抽奖执行成功，中奖人数:', data.data.winners.length);
  });

  test('16. 查看中奖结果', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/api/campaigns/${campaignId}/winners`);

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.length).toBeGreaterThan(0);

    console.log('✅ 中奖结果查询成功');
  });

  test('17. 用户查看个人资料', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/api/users/profile`, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.email).toBe(testUser.email);

    console.log('✅ 个人资料查询成功');
  });
});

