# 支付环境配置指南

## 📋 概述

本系统支持根据环境自动切换支付模式：
- **开发环境**：可以使用 Stripe 测试账号或假支付（用于单元测试）
- **生产环境**：强制使用 Stripe 生产账号，不允许假支付

## 🔧 环境变量配置

### 开发环境（Development）

#### 选项 1: 使用 Stripe 测试账号（推荐）

```env
# .env.development
NODE_ENV=development
USE_MOCK_PAYMENT=false

# Stripe 测试账号（不会产生实际费用）
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_test_xxxxx
```

**优点**：
- ✅ 真实 API 调用，测试完整流程
- ✅ 不会产生实际费用
- ✅ 可以测试 Webhook、退款等所有功能
- ✅ 与生产环境代码一致

#### 选项 2: 使用假支付（仅用于单元测试）

```env
# .env.development
NODE_ENV=development
USE_MOCK_PAYMENT=true

# Stripe 密钥可以不设置（如果使用假支付）
# STRIPE_SECRET_KEY=sk_test_xxxxx
```

**优点**：
- ✅ 测试速度快，不依赖网络
- ✅ 可以模拟各种场景
- ✅ 适合单元测试

**注意**：假支付仅用于快速测试，无法测试完整的支付流程（如 Webhook）。

### 测试环境（Test）

```env
# .env.test
NODE_ENV=test
USE_MOCK_PAYMENT=true  # 单元测试使用假支付

# 或者使用 Stripe 测试账号
# USE_MOCK_PAYMENT=false
# STRIPE_SECRET_KEY=sk_test_xxxxx
```

### 生产环境（Production）

```env
# .env.production
NODE_ENV=production
USE_MOCK_PAYMENT=false  # 强制 false，不允许假支付

# Stripe 生产账号（会产生实际费用）
STRIPE_SECRET_KEY=sk_live_xxxxx  # 必须以 sk_live_ 开头
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx  # 必须设置
```

**安全验证**：
- ✅ 系统会自动验证生产环境不能使用测试密钥
- ✅ 系统会自动验证生产环境不能使用假支付
- ✅ 系统会强制要求设置 Webhook Secret

## 🔒 安全机制

### 1. 生产环境强制验证

```typescript
// 生产环境强制使用真实支付
if (isProduction && useMockPayment) {
  throw new Error('USE_MOCK_PAYMENT cannot be true in production environment');
}

// 生产环境不能使用测试密钥
if (isProduction && secretKey.startsWith('sk_test_')) {
  throw new Error('Cannot use test Stripe key (sk_test_) in production environment');
}
```

### 2. 环境检测

系统会自动检测：
- `NODE_ENV`：环境类型（development/test/production）
- `STRIPE_SECRET_KEY`：密钥类型（test/live）
- `USE_MOCK_PAYMENT`：是否使用假支付

### 3. 启动时日志

系统启动时会显示当前支付模式：

```
# 假支付模式
⚠ Mock payment mode enabled. Stripe API calls will be simulated.
✓ Payment service initialized (MOCK MODE)

# Stripe 测试模式
✓ Stripe initialized (TEST MODE - no real charges)

# Stripe 生产模式
✓ Stripe initialized (LIVE MODE - real charges)
```

## 📝 配置示例

### 开发环境配置（使用 Stripe 测试账号）

```env
# .env.development
NODE_ENV=development
USE_MOCK_PAYMENT=false

# Stripe 测试账号（Stripeダッシュボードから取得）
STRIPE_SECRET_KEY=YOUR_STRIPE_TEST_SECRET_KEY
STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_TEST_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET
```

### 开发环境配置（使用假支付）

```env
# .env.development
NODE_ENV=development
USE_MOCK_PAYMENT=true
```

### 生产环境配置

```env
# .env.production
NODE_ENV=production
USE_MOCK_PAYMENT=false

# Stripe 生产账号（Stripeダッシュボードから取得）
STRIPE_SECRET_KEY=YOUR_STRIPE_LIVE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_LIVE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_LIVE_WEBHOOK_SECRET
```

## 🎯 使用建议

### 开发阶段

1. **推荐使用 Stripe 测试账号**
   - 可以完整测试支付流程
   - 不会产生实际费用
   - 与生产环境代码一致

2. **单元测试可以使用假支付**
   - 测试速度快
   - 不依赖网络
   - 适合快速验证逻辑

### 生产部署

1. **必须使用 Stripe 生产账号**
   - 系统会自动验证
   - 不允许使用测试密钥
   - 不允许使用假支付

2. **必须设置 Webhook Secret**
   - 确保 Webhook 安全
   - 系统会自动验证

## 🔍 如何获取 Stripe 密钥

### 测试账号密钥

1. 登录 [Stripe Dashboard](https://dashboard.stripe.com/)
2. 确保在 **Test mode**（右上角切换）
3. 进入 **Developers** → **API keys**
4. 复制 **Secret key**（以 `sk_test_` 开头）
5. 复制 **Publishable key**（以 `pk_test_` 开头）

### 生产账号密钥

1. 登录 [Stripe Dashboard](https://dashboard.stripe.com/)
2. 切换到 **Live mode**（右上角切换）
3. 进入 **Developers** → **API keys**
4. 复制 **Secret key**（以 `sk_live_` 开头）
5. 复制 **Publishable key**（以 `pk_live_` 开头）

### Webhook Secret

1. 进入 **Developers** → **Webhooks**
2. 创建或选择 Webhook endpoint
3. 点击 **Reveal** 显示 **Signing secret**
4. 复制 Secret（以 `whsec_` 开头）

## ✅ 验证配置

启动应用后，检查日志：

```
✓ Stripe initialized (TEST MODE - no real charges)
```

或

```
✓ Stripe initialized (LIVE MODE - real charges)
```

或（如果使用假支付）

```
⚠ Mock payment mode enabled. Stripe API calls will be simulated.
✓ Payment service initialized (MOCK MODE)
```

## 🚨 常见错误

### 错误 1: 生产环境使用测试密钥

```
Error: Cannot use test Stripe key (sk_test_) in production environment
```

**解决方案**：使用生产密钥（`sk_live_` 开头）

### 错误 2: 生产环境使用假支付

```
Error: USE_MOCK_PAYMENT cannot be true in production environment
```

**解决方案**：设置 `USE_MOCK_PAYMENT=false`

### 错误 3: 生产环境缺少 Webhook Secret

```
Error: STRIPE_WEBHOOK_SECRET is required in production environment
```

**解决方案**：设置 `STRIPE_WEBHOOK_SECRET`

## 📚 相关文档

- [Konbini 支付与 Stripe 的关系](./KONBINI_STRIPE_RELATIONSHIP.md)
- [支付路由安全分析](./PAYMENT_ROUTES_SECURITY_ANALYSIS.md)
