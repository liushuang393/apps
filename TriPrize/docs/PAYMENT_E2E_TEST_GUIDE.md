# 支付功能 E2E 测试指南

## 📋 测试概述

本文档说明如何运行支付功能的 E2E（端到端）测试，这些测试覆盖了所有支付相关的业务场景和代码分支。

## 🎯 测试覆盖范围

### 1. 信用卡支付流程
- ✅ 创建支付意图
- ✅ 确认支付（成功）
- ✅ 3D Secure 支付（带 return_url）
- ✅ 已支付订单的拒绝
- ✅ 重复支付意图的拒绝

### 2. Konbini 支付流程
- ✅ 创建 Konbini 支付意图
- ✅ 获取 Konbini 支付详情（支付编号、过期时间等）
- ✅ 不存在的支付意图处理

### 3. 退款流程
- ✅ 全额退款（管理员）
- ✅ 部分退款
- ✅ 非管理员用户拒绝
- ✅ 不存在的交易拒绝
- ✅ 已退款交易的拒绝

### 4. 速率限制和幂等性
- ✅ 支付意图创建的速率限制
- ✅ 支付意图创建的幂等性

### 5. Webhook 处理
- ✅ `payment_intent.succeeded` 事件处理
- ✅ `payment_intent.payment_failed` 事件处理
- ✅ 无效签名的拒绝

### 6. 错误场景和边界情况
- ✅ 不存在的购买订单
- ✅ 其他用户的购买订单
- ✅ 无效的支付意图
- ✅ 未授权请求
- ✅ 请求体验证

### 7. 交易查询
- ✅ 获取用户交易列表
- ✅ 根据 ID 获取交易详情
- ✅ 不存在的交易处理

## 🚀 运行测试

### 前置条件

1. **Docker 服务运行**：
   ```bash
   # Redis 和 PostgreSQL 必须运行
   docker ps
   ```

2. **环境变量设置**：
   ```bash
   # 测试环境会自动设置 USE_MOCK_PAYMENT=true
   # 确保不产生真实费用
   ```

### 运行所有支付 E2E 测试

```bash
cd api
npm run test:integration -- payment-e2e-comprehensive
```

### 运行单个测试套件

```bash
# 信用卡支付流程
npx jest tests/integration/payment-e2e-comprehensive.test.ts -t "Card Payment Flow"

# Konbini 支付流程
npx jest tests/integration/payment-e2e-comprehensive.test.ts -t "Konbini Payment Flow"

# 退款流程
npx jest tests/integration/payment-e2e-comprehensive.test.ts -t "Refund Flow"

# Webhook 处理
npx jest tests/integration/payment-e2e-comprehensive.test.ts -t "Webhook Handling"
```

### 运行单个测试用例

```bash
npx jest tests/integration/payment-e2e-comprehensive.test.ts -t "should create payment intent for card payment"
```

## 📊 测试统计

### 测试用例总数
- **信用卡支付流程**: 5 个测试用例
- **Konbini 支付流程**: 3 个测试用例
- **退款流程**: 5 个测试用例
- **速率限制和幂等性**: 2 个测试用例
- **Webhook 处理**: 3 个测试用例
- **错误场景**: 5 个测试用例
- **交易查询**: 3 个测试用例

**总计**: 26 个测试用例

## 🔍 测试详细说明

### 信用卡支付流程测试

#### 1. 创建支付意图
```typescript
it('should create payment intent for card payment', async () => {
  // 创建购买 → 创建支付意图
  // 验证: payment_intent_id, client_secret, status
});
```

#### 2. 确认支付
```typescript
it('should confirm card payment successfully', async () => {
  // 创建购买 → 创建支付意图 → 确认支付
  // 验证: 支付状态为 succeeded
});
```

#### 3. 3D Secure 支付
```typescript
it('should handle card payment with return_url (3D Secure)', async () => {
  // 创建支付意图时提供 return_url
  // 验证: return_url 被正确设置
});
```

#### 4. 已支付订单拒绝
```typescript
it('should reject creating payment intent for already paid purchase', async () => {
  // 将购买状态设为 completed
  // 验证: 创建支付意图返回 400
});
```

#### 5. 重复支付意图拒绝
```typescript
it('should reject creating duplicate payment intent for same purchase', async () => {
  // 创建第一个支付意图 → 尝试创建第二个
  // 验证: 第二个请求返回 400，提示 "already in progress"
});
```

### Konbini 支付流程测试

#### 1. 创建 Konbini 支付意图
```typescript
it('should create payment intent for konbini payment', async () => {
  // 创建购买 → 创建 Konbini 支付意图
  // 验证: payment_intent_id, status
});
```

#### 2. 获取 Konbini 详情
```typescript
it('should get konbini payment details', async () => {
  // 创建 Konbini 支付意图 → 获取详情
  // 验证: confirmation_number, payment_code, expires_at, store_type
});
```

#### 3. 不存在的支付意图
```typescript
it('should return 404 for non-existent konbini payment', async () => {
  // 使用不存在的 payment_intent_id
  // 验证: 返回 404
});
```

### 退款流程测试

#### 1. 全额退款
```typescript
it('should create full refund successfully', async () => {
  // 完成支付 → 管理员发起全额退款
  // 验证: refund_id, 交易状态为 refunded
});
```

#### 2. 部分退款
```typescript
it('should create partial refund successfully', async () => {
  // 完成支付 → 管理员发起部分退款（指定金额）
  // 验证: 退款成功
});
```

#### 3. 非管理员拒绝
```typescript
it('should reject refund by non-admin user', async () => {
  // 普通用户尝试退款
  // 验证: 返回 403
});
```

#### 4. 不存在的交易
```typescript
it('should reject refund for non-existent transaction', async () => {
  // 使用不存在的 transaction_id
  // 验证: 返回 404
});
```

#### 5. 已退款交易拒绝
```typescript
it('should reject refund for already refunded transaction', async () => {
  // 退款一次 → 再次退款
  // 验证: 第二次退款返回 400
});
```

### 速率限制和幂等性测试

#### 1. 速率限制
```typescript
it('should enforce rate limiting on create payment intent', async () => {
  // 快速发送 10 个请求
  // 验证: 部分请求返回 429 Too Many Requests
});
```

#### 2. 幂等性
```typescript
it('should enforce idempotency on create payment intent', async () => {
  // 发送相同的请求两次
  // 验证: 两次返回相同的 PaymentIntent ID
});
```

### Webhook 处理测试

#### 1. 支付成功 Webhook
```typescript
it('should handle payment_intent.succeeded webhook', async () => {
  // 发送 payment_intent.succeeded 事件
  // 验证: 交易状态更新为 succeeded
});
```

#### 2. 支付失败 Webhook
```typescript
it('should handle payment_intent.payment_failed webhook', async () => {
  // 发送 payment_intent.payment_failed 事件
  // 验证: 交易状态更新为 failed
});
```

#### 3. 无效签名拒绝
```typescript
it('should reject webhook with invalid signature', async () => {
  // 使用无效的签名
  // 验证: 返回 400
});
```

### 错误场景测试

#### 1. 不存在的购买订单
```typescript
it('should reject payment intent creation for non-existent purchase', async () => {
  // 使用不存在的 purchase_id
  // 验证: 返回 404
});
```

#### 2. 其他用户的购买订单
```typescript
it('should reject payment intent creation for other user\'s purchase', async () => {
  // 用户 A 创建购买 → 用户 B 尝试创建支付意图
  // 验证: 返回 403
});
```

#### 3. 无效的支付意图
```typescript
it('should reject payment confirmation with invalid payment intent', async () => {
  // 使用无效的 payment_intent_id
  // 验证: 返回 404
});
```

#### 4. 未授权请求
```typescript
it('should handle unauthorized requests', async () => {
  // 不提供 Authorization header
  // 验证: 返回 401
});
```

#### 5. 请求体验证
```typescript
it('should validate request body schema', async () => {
  // 缺少必填字段
  // 验证: 返回 400
});
```

### 交易查询测试

#### 1. 获取用户交易列表
```typescript
it('should get user transactions list', async () => {
  // 查询当前用户的交易列表
  // 验证: 返回交易数组
});
```

#### 2. 根据 ID 获取交易
```typescript
it('should get transaction by ID', async () => {
  // 使用 transaction_id 查询
  // 验证: 返回交易详情
});
```

#### 3. 不存在的交易
```typescript
it('should return 404 for non-existent transaction', async () => {
  // 使用不存在的 transaction_id
  // 验证: 返回 404
});
```

## 🐛 调试测试

### 查看详细输出

```bash
npx jest tests/integration/payment-e2e-comprehensive.test.ts --verbose
```

### 只运行失败的测试

```bash
npx jest tests/integration/payment-e2e-comprehensive.test.ts --onlyFailures
```

### 在测试失败时暂停

```bash
npx jest tests/integration/payment-e2e-comprehensive.test.ts --bail
```

## 📝 测试数据清理

测试会自动清理测试数据：
- 每个测试前清理旧数据（`beforeAll`）
- 每个测试后清理当前测试数据（`afterEach`）
- 所有测试后最终清理（`afterAll`）

测试数据标识：
- 用户邮箱: `%payment-e2e%`
- 活动名称: `%Payment E2E%`

## ⚠️ 注意事项

1. **使用假支付**: 测试环境自动设置 `USE_MOCK_PAYMENT=true`，不会产生真实费用
2. **数据库连接**: 确保 PostgreSQL 和 Redis 服务运行
3. **测试隔离**: 每个测试都是独立的，不会相互影响
4. **超时设置**: 测试超时设置为 2 分钟（120 秒）

## 📚 相关文档

- [支付环境配置指南](./PAYMENT_ENVIRONMENT_CONFIG.md)
- [支付方法说明和上线检查清单](./PAYMENT_METHODS_AND_DEPLOYMENT_CHECKLIST.md)
- [支付路由安全分析](./PAYMENT_ROUTES_SECURITY_ANALYSIS.md)
