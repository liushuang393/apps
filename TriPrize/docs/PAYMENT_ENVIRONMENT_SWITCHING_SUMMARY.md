# 支付环境切换功能总结

## 📋 实现概述

根据您的要求，已实现支付系统的环境自动切换功能：
- **开发环境**：可以使用假支付（用于单元测试）或 Stripe 测试账号
- **生产环境**：强制使用真实 Stripe 支付，不允许假支付

## ✅ 已实现的功能

### 1. 环境自动检测和切换

系统会根据以下环境变量自动切换支付模式：
- `NODE_ENV`：环境类型（development/test/production）
- `USE_MOCK_PAYMENT`：是否使用假支付
- `STRIPE_SECRET_KEY`：Stripe 密钥类型（test/live）

### 2. 假支付服务（Mock Payment Service）

创建了 `mock-payment.service.ts`，提供完整的假支付实现：
- ✅ 创建 PaymentIntent
- ✅ 获取 PaymentIntent
- ✅ 获取 PaymentMethod（Konbini）
- ✅ 确认支付
- ✅ 取消支付
- ✅ 创建退款

### 3. 支付服务环境切换

修改了 `payment.service.ts`，所有支付相关方法都支持环境切换：
- ✅ `createPaymentIntent` - 创建支付意图
- ✅ `getKonbiniPaymentInfo` - 获取 Konbini 支付详情
- ✅ `confirmPayment` - 确认支付
- ✅ `initiateRefund` - 发起退款

### 4. Stripe 配置增强

修改了 `stripe.config.ts`，添加了：
- ✅ 环境检测和验证
- ✅ 生产环境强制使用真实支付
- ✅ 生产环境禁止使用测试密钥
- ✅ 支付模式配置导出（`PAYMENT_CONFIG`）

## 🔒 安全机制

### 生产环境强制验证

```typescript
// 1. 禁止生产环境使用假支付
if (isProduction && useMockPayment) {
  throw new Error('USE_MOCK_PAYMENT cannot be true in production environment');
}

// 2. 禁止生产环境使用测试密钥
if (isProduction && secretKey.startsWith('sk_test_')) {
  throw new Error('Cannot use test Stripe key (sk_test_) in production environment');
}

// 3. 强制生产环境设置 Webhook Secret
if (!webhookSecretEnv && isProduction) {
  throw new Error('STRIPE_WEBHOOK_SECRET is required in production environment');
}
```

## 📝 使用方法

### 开发环境 - 使用 Stripe 测试账号（推荐）

```env
# .env.development
NODE_ENV=development
USE_MOCK_PAYMENT=false
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
```

**优点**：
- ✅ 真实 API 调用，测试完整流程
- ✅ 不会产生实际费用
- ✅ 可以测试 Webhook、退款等所有功能

### 开发环境 - 使用假支付（单元测试）

```env
# .env.development
NODE_ENV=development
USE_MOCK_PAYMENT=true
```

**优点**：
- ✅ 测试速度快，不依赖网络
- ✅ 适合单元测试

### 生产环境 - 强制使用真实支付

```env
# .env.production
NODE_ENV=production
USE_MOCK_PAYMENT=false  # 强制 false
STRIPE_SECRET_KEY=sk_live_xxxxx  # 必须是生产密钥
STRIPE_WEBHOOK_SECRET=whsec_xxxxx  # 必须设置
```

## 🔍 Konbini 支付与 Stripe 的关系

### 关键点

1. **Konbini 支付是 Stripe 支持的一种支付方式**
   - Stripe 提供完整的 Konbini 支付 API
   - 支持日本主要便利店（7-Eleven、Lawson、FamilyMart 等）

2. **可以使用 Stripe 测试账号**
   - 测试账号不会产生实际费用
   - 可以完整测试支付流程
   - 适合开发和测试

3. **测试账号 vs 生产账号**
   ```
   测试账号 (sk_test_xxx):
   - 不会产生实际费用 ✅
   - 使用测试支付编号
   - 可以模拟各种场景
   
   生产账号 (sk_live_xxx):
   - 会产生实际费用 ⚠️
   - 使用真实支付方式
   - 真实的资金流动
   ```

## 📊 代码修改清单

### 新增文件

1. **`api/src/services/mock-payment.service.ts`**
   - 假支付服务实现
   - 模拟 Stripe API 响应
   - 支持所有支付操作

### 修改文件

1. **`api/src/config/stripe.config.ts`**
   - 添加环境检测和验证
   - 添加支付模式配置导出
   - 强制生产环境使用真实支付

2. **`api/src/services/payment.service.ts`**
   - 所有支付方法支持环境切换
   - 根据 `PAYMENT_CONFIG.useMockPayment` 选择使用真实或假支付

### 文档文件

1. **`docs/KONBINI_STRIPE_RELATIONSHIP.md`**
   - Konbini 支付与 Stripe 的关系说明
   - 测试账号 vs 生产账号的区别

2. **`docs/PAYMENT_ENVIRONMENT_CONFIG.md`**
   - 环境配置指南
   - 配置示例和最佳实践

3. **`docs/PAYMENT_ENVIRONMENT_SWITCHING_SUMMARY.md`**（本文档）
   - 功能总结和使用说明

## 🎯 使用场景

### 场景 1: 开发环境 - 使用 Stripe 测试账号

```env
NODE_ENV=development
USE_MOCK_PAYMENT=false
STRIPE_SECRET_KEY=sk_test_xxxxx
```

**适用**：
- ✅ 功能开发
- ✅ 集成测试
- ✅ Webhook 测试
- ✅ 完整支付流程测试

### 场景 2: 单元测试 - 使用假支付

```env
NODE_ENV=test
USE_MOCK_PAYMENT=true
```

**适用**：
- ✅ 单元测试
- ✅ 快速验证逻辑
- ✅ CI/CD 自动化测试

### 场景 3: 生产环境 - 使用真实支付

```env
NODE_ENV=production
USE_MOCK_PAYMENT=false
STRIPE_SECRET_KEY=sk_live_xxxxx
```

**适用**：
- ✅ 生产环境部署
- ✅ 真实业务场景

## ✅ 验证清单

部署前请确认：

- [ ] 开发环境配置了正确的环境变量
- [ ] 生产环境 `USE_MOCK_PAYMENT=false`
- [ ] 生产环境使用生产密钥（`sk_live_` 开头）
- [ ] 生产环境设置了 `STRIPE_WEBHOOK_SECRET`
- [ ] 启动日志显示正确的支付模式
- [ ] 单元测试使用假支付可以正常运行
- [ ] 开发环境使用 Stripe 测试账号可以正常支付

## 🚀 下一步

1. **配置环境变量**
   - 根据 `docs/PAYMENT_ENVIRONMENT_CONFIG.md` 配置各环境

2. **测试验证**
   - 开发环境：测试 Stripe 测试账号支付
   - 单元测试：测试假支付功能
   - 生产环境：验证强制使用真实支付

3. **更新前端**
   - 修复 Konbini 支付流程，使用真实 API（参考之前的分析文档）

## 📚 相关文档

- [Konbini 支付与 Stripe 的关系](./KONBINI_STRIPE_RELATIONSHIP.md)
- [支付环境配置指南](./PAYMENT_ENVIRONMENT_CONFIG.md)
- [Konbini 支付流程分析](./KONBINI_PAYMENT_FLOW_ANALYSIS.md)
