# 支付路由安全分析：速率限制和幂等性中间件

## 📋 问题概述

部分支付路由缺少**速率限制（Rate Limiting）**和**幂等性（Idempotency）**中间件，存在安全风险和重复操作风险。

## 🔍 什么是速率限制中间件？

### 定义

**速率限制（Rate Limiting）**是一种保护机制，用于限制用户在特定时间窗口内可以发送的请求数量。

### 工作原理

```typescript
// 示例：purchase 速率限制配置
rateLimits.purchase = rateLimit({
  windowMs: 60 * 1000,      // 时间窗口：1分钟
  maxRequests: 5,            // 最大请求数：5次
  keyPrefix: 'purchase',     // Redis key 前缀
});
```

**工作流程**：
```
用户发送请求
  ↓
检查 Redis 中该用户的请求计数
  ↓
如果计数 < 5 → 允许请求，计数 +1
如果计数 >= 5 → 拒绝请求，返回 429 Too Many Requests
  ↓
1分钟后，计数重置
```

### 为什么需要速率限制？

#### 1. **防止滥用和攻击**
- ❌ 没有速率限制：攻击者可以每秒发送1000次请求，导致服务器崩溃
- ✅ 有速率限制：每分钟最多5次请求，有效防止攻击

#### 2. **保护支付系统**
- 支付操作涉及资金，必须严格控制频率
- 防止恶意用户快速创建大量支付请求
- 防止自动化脚本攻击

#### 3. **公平使用资源**
- 确保所有用户都能正常使用服务
- 防止单个用户占用过多资源

## 🔍 什么是幂等性中间件？

### 定义

**幂等性（Idempotency）**是指同一个请求执行多次和执行一次的效果相同。

### 工作原理

```typescript
// 幂等性中间件示例
idempotencyMiddleware(24 * 60 * 60) // 24小时幂等性窗口
```

**工作流程**：
```
用户发送请求（包含请求体）
  ↓
计算请求的唯一标识：hash(用户ID + 路径 + 请求体)
  ↓
检查 Redis 中是否存在该标识
  ↓
如果不存在 → 处理请求，存储响应到 Redis
如果存在 → 直接返回缓存的响应（不重复处理）
  ↓
24小时后，缓存过期
```

### 为什么需要幂等性？

#### 1. **防止重复支付**
```
场景：用户点击"支付"按钮，网络延迟导致重复请求

❌ 没有幂等性：
  请求1 → 创建 PaymentIntent A
  请求2 → 创建 PaymentIntent B  (重复！)
  结果：用户被扣款两次！

✅ 有幂等性：
  请求1 → 创建 PaymentIntent A，缓存响应
  请求2 → 检测到重复，直接返回 PaymentIntent A
  结果：用户只被扣款一次
```

#### 2. **处理网络重试**
```
场景：移动网络不稳定，自动重试机制触发

❌ 没有幂等性：
  原始请求 → 已处理，但响应丢失
  重试请求 → 再次处理，导致重复操作

✅ 有幂等性：
  原始请求 → 已处理，响应已缓存
  重试请求 → 返回缓存响应，不重复处理
```

#### 3. **防止并发重复请求**
```
场景：用户快速双击按钮，同时发送两个相同请求

❌ 没有幂等性：
  请求A → 正在处理...
  请求B → 也在处理... (重复！)

✅ 有幂等性：
  请求A → 获取锁，正在处理...
  请求B → 检测到锁，返回 409 Conflict
```

## 📊 当前支付路由安全状态

### ✅ 已保护的路由

```typescript
// POST /api/payments/create-intent
router.post(
  '/create-intent',
  rateLimits.purchase,                    // ✅ 速率限制：1分钟5次
  idempotencyMiddleware(24 * 60 * 60),  // ✅ 幂等性：24小时窗口
  validateBody(createPaymentIntentSchema),
  paymentController.createPaymentIntent
);
```

**保护效果**：
- ✅ 防止频繁创建支付意图
- ✅ 防止重复创建支付意图
- ✅ 防止网络重试导致的重复操作

### ❌ 缺少保护的路由

#### 1. **POST /api/payments/confirm** - 确认支付

```typescript
// 当前代码
router.post(
  '/confirm',
  validateBody(confirmPaymentSchema),
  paymentController.confirmPayment
);
```

**风险**：
- ❌ **没有速率限制**：攻击者可以快速发送大量确认请求
- ❌ **没有幂等性**：网络重试可能导致重复确认支付
- ⚠️ **严重性**：**高** - 涉及实际扣款操作

**攻击场景**：
```
恶意用户：
1. 创建支付意图
2. 快速发送100次确认请求
3. 可能导致多次扣款或系统崩溃
```

#### 2. **POST /api/payments/refund** - 发起退款（管理员）

```typescript
// 当前代码
router.post(
  '/refund',
  validateBody(initiateRefundSchema),
  paymentController.initiateRefund
);
```

**风险**：
- ❌ **没有速率限制**：管理员可能误操作，快速发起多次退款
- ❌ **没有幂等性**：网络重试可能导致重复退款
- ⚠️ **严重性**：**高** - 涉及资金退款操作

**攻击场景**：
```
恶意管理员或账户被盗：
1. 快速发起多次退款请求
2. 可能导致重复退款，造成资金损失
```

#### 3. **GET /api/payments/konbini/:paymentIntentId** - 获取 Konbini 详情

```typescript
// 当前代码
router.get(
  '/konbini/:paymentIntentId',
  validateParams(paymentIntentIdSchema),
  paymentController.getKonbiniDetails
);
```

**风险**：
- ❌ **没有速率限制**：可能被用于信息收集攻击
- ⚠️ **严重性**：**中** - 只读操作，但可能泄露信息

#### 4. **GET /api/payments/transactions/me** - 获取用户交易列表

```typescript
// 当前代码
router.get(
  '/transactions/me',
  validateQuery(listTransactionsSchema),
  paymentController.getMyTransactions
);
```

**风险**：
- ❌ **没有速率限制**：可能被用于数据爬取
- ⚠️ **严重性**：**低** - 只读操作，但可能影响性能

#### 5. **GET /api/payments/transactions/:transactionId** - 获取交易详情

```typescript
// 当前代码
router.get(
  '/transactions/:transactionId',
  validateParams(transactionIdSchema),
  paymentController.getTransaction
);
```

**风险**：
- ❌ **没有速率限制**：可能被用于信息收集
- ⚠️ **严重性**：**低** - 只读操作

## 🎯 推荐修复方案

### 方案 1: 为关键路由添加保护（推荐）

#### 1.1 确认支付路由（高优先级）

```typescript
router.post(
  '/confirm',
  rateLimits.purchase,                    // ✅ 添加速率限制
  idempotencyMiddleware(24 * 60 * 60),   // ✅ 添加幂等性（24小时）
  validateBody(confirmPaymentSchema),
  paymentController.confirmPayment
);
```

**理由**：
- 确认支付涉及实际扣款，必须防止重复和滥用
- 24小时幂等性窗口确保网络重试不会重复扣款

#### 1.2 退款路由（高优先级）

```typescript
router.post(
  '/refund',
  rateLimits.purchase,                    // ✅ 添加速率限制
  idempotencyMiddleware(24 * 60 * 60),   // ✅ 添加幂等性（24小时）
  validateBody(initiateRefundSchema),
  paymentController.initiateRefund
);
```

**理由**：
- 退款涉及资金操作，必须严格控制
- 防止误操作或恶意退款

#### 1.3 查询路由（中优先级）

```typescript
// 为查询路由添加较宽松的速率限制
router.get(
  '/konbini/:paymentIntentId',
  rateLimits.api,  // ✅ 使用通用 API 速率限制（15分钟100次）
  validateParams(paymentIntentIdSchema),
  paymentController.getKonbiniDetails
);

router.get(
  '/transactions/me',
  rateLimits.api,  // ✅ 使用通用 API 速率限制
  validateQuery(listTransactionsSchema),
  paymentController.getMyTransactions
);

router.get(
  '/transactions/:transactionId',
  rateLimits.api,  // ✅ 使用通用 API 速率限制
  validateParams(transactionIdSchema),
  paymentController.getTransaction
);
```

**理由**：
- 查询操作不涉及资金，使用较宽松的限制即可
- 防止数据爬取和性能问题

### 方案 2: 创建专门的速率限制配置

如果需要更细粒度的控制，可以创建专门的配置：

```typescript
// rate-limit.middleware.ts
export const rateLimits = {
  // ... 现有配置 ...
  
  // 支付确认（非常严格）
  paymentConfirm: rateLimit({
    windowMs: 60 * 1000,      // 1分钟
    maxRequests: 3,            // 最多3次（比 purchase 更严格）
    keyPrefix: 'payment-confirm',
  }),
  
  // 退款（非常严格）
  refund: rateLimit({
    windowMs: 60 * 60 * 1000,  // 1小时
    maxRequests: 10,            // 每小时最多10次
    keyPrefix: 'refund',
  }),
};
```

## 📝 修复后的完整路由配置

```typescript
// payment.routes.ts

// Webhook（不需要速率限制和幂等性，由 Stripe 控制）
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  paymentController.handleWebhook
);

// 所有其他路由需要认证
router.use(authenticate);
router.use(loadUser);

// ✅ 创建支付意图（已有保护）
router.post(
  '/create-intent',
  rateLimits.purchase,
  idempotencyMiddleware(24 * 60 * 60),
  validateBody(createPaymentIntentSchema),
  paymentController.createPaymentIntent
);

// ✅ 确认支付（添加保护）
router.post(
  '/confirm',
  rateLimits.purchase,                    // 新增
  idempotencyMiddleware(24 * 60 * 60),   // 新增
  validateBody(confirmPaymentSchema),
  paymentController.confirmPayment
);

// ✅ 获取 Konbini 详情（添加速率限制）
router.get(
  '/konbini/:paymentIntentId',
  rateLimits.api,                         // 新增
  validateParams(paymentIntentIdSchema),
  paymentController.getKonbiniDetails
);

// ✅ 获取用户交易列表（添加速率限制）
router.get(
  '/transactions/me',
  rateLimits.api,                         // 新增
  validateQuery(listTransactionsSchema),
  paymentController.getMyTransactions
);

// ✅ 获取交易详情（添加速率限制）
router.get(
  '/transactions/:transactionId',
  rateLimits.api,                         // 新增
  validateParams(transactionIdSchema),
  paymentController.getTransaction
);

// ✅ 发起退款（添加保护）
router.post(
  '/refund',
  rateLimits.purchase,                    // 新增
  idempotencyMiddleware(24 * 60 * 60),   // 新增
  validateBody(initiateRefundSchema),
  paymentController.initiateRefund
);
```

## 🎯 总结

### 什么是速率限制？
- **定义**：限制用户在特定时间内的请求数量
- **目的**：防止滥用、攻击和资源耗尽
- **实现**：使用 Redis 计数器，按用户ID或IP限制

### 什么是幂等性？
- **定义**：相同请求执行多次和执行一次效果相同
- **目的**：防止重复操作（特别是支付和退款）
- **实现**：使用 Redis 缓存响应，基于请求内容生成唯一标识

### 为什么需要它们？
1. **安全性**：防止恶意攻击和滥用
2. **可靠性**：防止网络重试导致的重复操作
3. **资金安全**：防止重复支付或退款
4. **系统稳定性**：防止资源耗尽

### 哪些路由缺少保护？
- ❌ **POST /confirm** - 缺少速率限制和幂等性（高优先级）
- ❌ **POST /refund** - 缺少速率限制和幂等性（高优先级）
- ❌ **GET /konbini/:id** - 缺少速率限制（中优先级）
- ❌ **GET /transactions/me** - 缺少速率限制（低优先级）
- ❌ **GET /transactions/:id** - 缺少速率限制（低优先级）

### 修复优先级
1. **立即修复**：`/confirm` 和 `/refund`（涉及资金操作）
2. **尽快修复**：`/konbini/:id`（可能泄露信息）
3. **建议修复**：查询路由（防止性能问题）
