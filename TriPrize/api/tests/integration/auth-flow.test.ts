import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/database.config';
import { UserRole } from '../../src/models/user.entity';

/**
 * 用户认证流程集成测试
 * 测试Firebase认证集成和权限控制
 *
 * 重点测试:
 * 1. Firebase Token验证
 * 2. 用户注册/登录流程
 * 3. 权限检查
 * 4. 无效Token处理
 * 5. 过期Token处理
 */

// 设置测试超时为60秒
jest.setTimeout(60000);

describe('Authentication Flow Integration Tests', () => {
  let app: ReturnType<typeof createApp>;
  let testUserId: string;
  let validToken: string;

  beforeAll(async () => {
    // Initialize Express application for integration tests
    app = createApp();
    // 清理测试数据
    await pool.query('DELETE FROM users WHERE email LIKE \'test-auth%\'');
  });

	  afterAll(async () => {
	    // 清理测试数据 (仅删除本测试创建的用户, 不关闭全局连接)
	    await pool.query("DELETE FROM users WHERE email LIKE 'test-auth%'");
	    // 注意: 数据库连接和 Redis 客户端 由全局测试配置统一管理, 这里不再调用 pool.end() 或 redis.quit()
	  });

  afterEach(async () => {
    // 清理每个测试的数据
    await pool.query('DELETE FROM users WHERE user_id::text LIKE \'test-auth-%\'');
  });

  describe('User Registration', () => {
    it('should register new user with valid Firebase token', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-001@example.com',
          email: 'test-auth-001@example.com',
          display_name: 'Test Auth User 001',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user_id');
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.email).toBe('test-auth-001@example.com');

      testUserId = response.body.data.user_id;
      validToken = response.body.data.token;
    });

    it('should reject registration with duplicate email', async () => {
      // 第一次注册
      await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-002@example.com',
          email: 'test-auth-002@example.com',
          display_name: 'Test Auth User 002',
        });

      // 第二次注册相同email
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-002-duplicate@example.com',
          email: 'test-auth-002@example.com',
          display_name: 'Test Auth User 003',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('email');
    });

    it('should reject registration with missing required fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-004@example.com',
          // missing email and display_name
        });

      expect(response.status).toBe(400);
    });

    it('should reject registration with invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_invalid-email',
          email: 'invalid-email',
          display_name: 'Test Auth User 005',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('email');
    });
  });

  describe('User Login', () => {
    beforeEach(async () => {
      // 创建测试用户
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-login@example.com',
          email: 'test-auth-login@example.com',
          display_name: 'Test Auth Login User',
        });

      testUserId = response.body.data.user_id;
      validToken = response.body.data.token;
    });

    it('should login existing user with valid Firebase UID', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          firebase_token: 'mock_test-auth-login@example.com',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user_id');
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.user_id).toBe(testUserId);
    });

    it('should reject login with non-existent Firebase UID', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          firebase_token: 'mock_non-existent@example.com',
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });

    it('should update last_login_at on successful login', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({
          firebase_token: 'mock_test-auth-login@example.com',
        });

      // 验证last_login_at已更新
      const { rows } = await pool.query(
        'SELECT last_login_at FROM users WHERE user_id = $1',
        [testUserId]
      );

      expect(rows[0].last_login_at).not.toBeNull();
    });
  });

  describe('Token Validation', () => {
    beforeEach(async () => {
      // 创建测试用户
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-token@example.com',
          email: 'test-auth-token@example.com',
          display_name: 'Test Auth Token User',
        });

      testUserId = response.body.data.user_id;
      validToken = response.body.data.token;
    });

    it('should allow access to protected routes with valid token', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.user_id).toBe(testUserId);
    });

    it('should reject access to protected routes without token', async () => {
      const response = await request(app)
        .get('/api/users/me');

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('token');
    });

    it('should reject access with invalid token format', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', 'InvalidTokenFormat');

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('token');
    });

    it('should reject access with malformed Bearer token', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', 'Bearer invalid-token-string');

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('token');
    });

    it('should reject access with expired token', async () => {
      // 注意: 这个测试需要模拟过期的Firebase token
      // 在实际环境中,Firebase会验证token的exp claim
      const expiredToken = 'expired-firebase-token';

      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('expired');
    });

    it('should reject access with revoked token', async () => {
      // 注意: 这个测试需要模拟被撤销的Firebase token
      // 在实际环境中,Firebase会检查token是否被撤销
      const revokedToken = 'revoked-firebase-token';

      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${revokedToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('revoked');
    });
  });

  describe('Permission Control', () => {
    let adminUserId: string;
    let adminToken: string;
    let regularUserId: string;
    let regularToken: string;

    beforeEach(async () => {
      // 创建管理员用户
      const adminResponse = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-admin@example.com',
          email: 'test-auth-admin@example.com',
          display_name: 'Test Auth Admin User',
        });

      adminUserId = adminResponse.body.data.user_id;
      adminToken = adminResponse.body.data.token;

      // 设置为管理员
      await pool.query(
        'UPDATE users SET role = $1 WHERE user_id = $2',
        [UserRole.ADMIN, adminUserId]
      );

      // 创建普通用户
      const regularResponse = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-regular@example.com',
          email: 'test-auth-regular@example.com',
          display_name: 'Test Auth Regular User',
        });

      regularUserId = regularResponse.body.data.user_id;
      regularToken = regularResponse.body.data.token;
    });

    it('should allow admin to access admin-only routes', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
    });

    it('should reject regular user from accessing admin-only routes', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('permission');
    });

    it('should allow user to access their own data', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.user_id).toBe(regularUserId);
    });

    it('should reject user from accessing other user data', async () => {
      const response = await request(app)
        .get(`/api/users/${adminUserId}`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('permission');
    });
  });

  describe('Email Verification', () => {
    it('should allow access for verified email users', async () => {
      // 创建已验证邮箱的用户
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-verified@example.com',
          email: 'test-auth-verified@example.com',
          display_name: 'Test Auth Verified User',
          email_verified: true,
        });

      const token = response.body.data.token;

      // 访问需要邮箱验证的路由
      const protectedResponse = await request(app)
        .post('/api/purchases')
        .set('Authorization', `Bearer ${token}`)
        .send({
          campaign_id: 'some-campaign-id',
          position_ids: ['some-position-id'],
          payment_method: 'card',
        });

      // 应该通过邮箱验证检查 (可能因为其他原因失败,但不是因为邮箱未验证)
      expect(protectedResponse.status).not.toBe(403);
    });

    it('should reject access for unverified email users to protected routes', async () => {
      // 创建未验证邮箱的用户
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firebase_token: 'mock_test-auth-unverified@example.com',
          email: 'test-auth-unverified@example.com',
          display_name: 'Test Auth Unverified User',
          email_verified: false,
        });

      const token = response.body.data.token;

      // 访问需要邮箱验证的路由
      const protectedResponse = await request(app)
        .post('/api/purchases')
        .set('Authorization', `Bearer ${token}`)
        .send({
          campaign_id: 'some-campaign-id',
          position_ids: ['some-position-id'],
          payment_method: 'card',
        });

      expect(protectedResponse.status).toBe(403);
      expect(protectedResponse.body.message).toContain('email');
    });
  });
});


