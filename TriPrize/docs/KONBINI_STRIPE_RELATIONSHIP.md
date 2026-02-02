# Konbini 支付与 Stripe 的关系说明

## 📋 Konbini 支付是什么？

**Konbini（コンビニ）**是日语"便利店"的意思。Konbini 支付是日本流行的便利店支付方式，允许用户在便利店（如 7-Eleven、Lawson、FamilyMart 等）使用现金支付在线订单。

## 🔗 Konbini 支付与 Stripe 的关系

### Stripe 支持 Konbini 支付

**Stripe 是支付处理平台，支持多种支付方式，包括 Konbini 支付。**

```
Stripe 支付平台
  ├── 信用卡支付 (Card)
  ├── 银行转账 (Bank Transfer)
  ├── Konbini 支付 (便利店支付) ✅
  │   ├── 7-Eleven
  │   ├── Lawson
  │   ├── FamilyMart
  │   ├── Ministop
  │   └── Seicomart
  └── 其他支付方式...
```

### 工作流程

```
用户选择 Konbini 支付
  ↓
调用 Stripe API 创建 PaymentIntent
  ↓
Stripe 生成支付编号（confirmation_number）
  ↓
用户到便利店使用支付编号支付
  ↓
Stripe 通过 Webhook 通知支付结果
  ↓
系统更新订单状态
```

## 💳 Stripe 测试账号 vs 生产账号

### 测试账号（Test Mode）

**特点**：
- ✅ **不会产生实际费用**
- ✅ 使用测试卡号和测试支付编号
- ✅ 可以模拟各种支付场景（成功、失败、取消）
- ✅ 适合开发和测试

**测试账号配置**：
```env
# 测试环境
STRIPE_SECRET_KEY=sk_test_xxxxx  # 以 sk_test_ 开头
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx  # 以 pk_test_ 开头
```

**测试 Konbini 支付编号示例**：
- 7-Eleven: `123456789012`
- Lawson: `987654321098`
- FamilyMart: `111111111111`

### 生产账号（Live Mode）

**特点**：
- ⚠️ **会产生实际费用**
- ⚠️ 使用真实的支付方式
- ⚠️ 真实的资金流动
- ✅ 用于真实业务

**生产账号配置**：
```env
# 生产环境
STRIPE_SECRET_KEY=sk_live_xxxxx  # 以 sk_live_ 开头
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx  # 以 pk_live_ 开头
```

## 🎯 为什么可以使用 Stripe 测试账号？

### 1. 测试账号不会产生费用

```
测试账号支付流程：
用户选择 Konbini 支付
  ↓
Stripe 生成测试支付编号
  ↓
用户在便利店使用测试编号
  ↓
便利店系统：识别为测试编号，不实际扣款
  ↓
Stripe 模拟支付成功
  ↓
系统收到 Webhook，更新订单状态
  ↓
结果：订单完成，但没有实际资金流动 ✅
```

### 2. 完整的支付流程测试

使用 Stripe 测试账号可以：
- ✅ 测试完整的支付流程
- ✅ 测试 Webhook 处理
- ✅ 测试支付成功/失败场景
- ✅ 测试退款流程
- ✅ 测试 Konbini 支付过期处理

### 3. 与生产环境一致

```
测试环境（Stripe Test Mode）
  ↓
代码逻辑完全相同
  ↓
只是使用测试密钥
  ↓
生产环境（Stripe Live Mode）
```

## 🔧 环境切换策略

### 方案：根据环境自动切换

```
开发环境 (NODE_ENV=development)
  ↓
选项1: 使用 Stripe 测试账号（推荐）
  - 真实 API 调用
  - 不会产生费用
  - 完整流程测试

选项2: 使用假支付（仅用于单元测试）
  - 不调用 Stripe API
  - 快速测试
  - 跳过网络请求

生产环境 (NODE_ENV=production)
  ↓
强制使用 Stripe 生产账号
  - 真实支付
  - 真实资金流动
  - 不允许假支付
```

## 📝 实现建议

### 1. 环境变量配置

```env
# .env.development
NODE_ENV=development
STRIPE_SECRET_KEY=sk_test_xxxxx  # 测试账号
USE_MOCK_PAYMENT=false  # 是否使用假支付（仅开发环境）

# .env.production
NODE_ENV=production
STRIPE_SECRET_KEY=sk_live_xxxxx  # 生产账号
USE_MOCK_PAYMENT=false  # 生产环境强制 false
```

### 2. 代码实现

```typescript
// 判断是否使用假支付
const isDevelopment = process.env.NODE_ENV !== 'production';
const useMockPayment = process.env.USE_MOCK_PAYMENT === 'true' && isDevelopment;

if (useMockPayment) {
  // 使用假支付实现（仅开发环境）
  return mockPaymentService.createPaymentIntent(...);
} else {
  // 使用真实 Stripe API（开发和生产环境）
  return stripe.paymentIntents.create(...);
}
```

### 3. 假支付实现（仅用于单元测试）

```typescript
// 假支付服务（仅开发环境）
class MockPaymentService {
  createPaymentIntent(params) {
    // 生成假的 PaymentIntent
    return {
      id: 'pi_mock_xxxxx',
      status: 'requires_payment_method',
      // ...
    };
  }
  
  getKonbiniPaymentInfo(paymentIntentId) {
    // 返回假的 Konbini 信息
    return {
      confirmation_number: '123456789012',
      store_type: 'lawson',
      expires_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
    };
  }
}
```

## ✅ 推荐方案

### 开发环境：使用 Stripe 测试账号（推荐）

**优点**：
- ✅ 真实 API 调用，测试完整流程
- ✅ 不会产生实际费用
- ✅ 与生产环境代码一致
- ✅ 可以测试 Webhook、退款等所有功能

**配置**：
```env
NODE_ENV=development
STRIPE_SECRET_KEY=sk_test_xxxxx
USE_MOCK_PAYMENT=false
```

### 单元测试：使用假支付（可选）

**优点**：
- ✅ 测试速度快，不依赖网络
- ✅ 可以模拟各种场景
- ✅ 适合单元测试

**配置**：
```env
NODE_ENV=test
USE_MOCK_PAYMENT=true
```

### 生产环境：强制使用真实支付

**要求**：
- ✅ 必须使用 Stripe 生产账号
- ✅ 不允许假支付
- ✅ 强制验证环境变量

**配置**：
```env
NODE_ENV=production
STRIPE_SECRET_KEY=sk_live_xxxxx
USE_MOCK_PAYMENT=false  # 强制 false
```

## 🎯 总结

1. **Konbini 支付是 Stripe 支持的一种支付方式**
   - Stripe 提供完整的 Konbini 支付 API
   - 支持日本主要便利店（7-Eleven、Lawson 等）

2. **可以使用 Stripe 测试账号**
   - 测试账号不会产生实际费用
   - 可以完整测试支付流程
   - 适合开发和测试

3. **环境切换策略**
   - 开发环境：使用 Stripe 测试账号（推荐）
   - 单元测试：可以使用假支付（可选）
   - 生产环境：强制使用真实支付

4. **实现方式**
   - 根据 `NODE_ENV` 和 `USE_MOCK_PAYMENT` 环境变量切换
   - 生产环境强制使用真实支付
   - 开发环境可以选择使用测试账号或假支付
