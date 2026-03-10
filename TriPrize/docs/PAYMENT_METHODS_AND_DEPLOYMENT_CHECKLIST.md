# 支付方法说明和上线检查清单

## 📋 问题回答

### 1. 上线前检查清单

#### ✅ 已完成的功能

- ✅ 支付环境自动切换（开发/生产）
- ✅ 假支付服务（用于单元测试）
- ✅ Konbini 支付支持
- ✅ 信用卡支付支持
- ✅ 支付路由安全保护（速率限制和幂等性）
- ✅ Webhook 处理
- ✅ 退款功能

#### 🚀 上线前需要做的事情

**只需要切换 Stripe 生产密钥即可！**

```env
# .env.production
NODE_ENV=production
USE_MOCK_PAYMENT=false  # 强制 false（系统会自动验证）

# Stripe 生产密钥（必须）
STRIPE_SECRET_KEY=sk_live_xxxxx  # 必须以 sk_live_ 开头
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx  # 必须设置
```

**系统会自动验证**：
- ✅ 生产环境不能使用假支付
- ✅ 生产环境不能使用测试密钥（`sk_test_`）
- ✅ 生产环境必须设置 Webhook Secret

**启动后检查日志**：
```
✓ Stripe initialized (LIVE MODE - real charges)
```

### 2. 当前支持的支付方法

根据代码分析，系统目前支持 **2 种支付方法**：

#### ✅ 信用卡支付（Card Payment）

```typescript
PaymentMethod.CARD = 'card'
```

**特点**：
- ✅ 即时支付
- ✅ 支持 3D Secure（需要 return_url）
- ✅ 支付完成后立即确认订单

**使用流程**：
```
用户选择信用卡支付
  ↓
创建 PaymentIntent（payment_method_types: ['card']）
  ↓
前端使用 Stripe Elements 收集卡号
  ↓
确认支付（confirmPayment）
  ↓
支付完成，订单确认
```

#### ✅ Konbini 支付（便利店支付）

```typescript
PaymentMethod.KONBINI = 'konbini'
```

**特点**：
- ✅ 现金支付（在便利店）
- ✅ 4 天有效期
- ✅ 过期自动取消
- ✅ 支持日本主要便利店（7-Eleven、Lawson、FamilyMart 等）

**使用流程**：
```
用户选择 Konbini 支付
  ↓
创建 PaymentIntent（payment_method_types: ['konbini']）
  ↓
获取支付编号（confirmation_number）
  ↓
用户在便利店使用支付编号支付
  ↓
Stripe Webhook 通知支付完成
  ↓
订单确认
```

### 3. 用户能否预先登录信用卡？

#### ❌ 当前系统**不支持**保存支付方式

**当前实现**：
- ❌ 没有 Stripe Customer 创建功能
- ❌ 没有保存支付方式的功能
- ❌ 每次支付都需要重新输入卡号

**每次支付流程**：
```
用户选择商品
  ↓
创建 Purchase
  ↓
创建 PaymentIntent（每次都是新的）
  ↓
用户输入卡号（每次都需要输入）
  ↓
确认支付
```

#### 💡 如果要实现保存支付方式功能

**Stripe 的实现方式**：

1. **创建 Stripe Customer**
   ```typescript
   const customer = await stripe.customers.create({
     email: user.email,
     metadata: {
       user_id: user.id,
     },
   });
   ```

2. **保存支付方式到 Customer**
   ```typescript
   // 使用 Stripe Elements 创建 PaymentMethod
   const paymentMethod = await stripe.paymentMethods.create({
     type: 'card',
     card: { token: cardToken },
   });

   // 附加到 Customer
   await stripe.paymentMethods.attach(paymentMethod.id, {
     customer: customer.id,
   });
   ```

3. **使用保存的支付方式**
   ```typescript
   // 创建 PaymentIntent 时使用保存的支付方式
   const paymentIntent = await stripe.paymentIntents.create({
     amount: 1000,
     currency: 'jpy',
     customer: customer.id,
     payment_method: savedPaymentMethod.id,
     off_session: true, // 不需要用户在场
   });
   ```

**安全说明**：
- ✅ **不会存储卡号**：Stripe 使用 PaymentMethod ID（如 `pm_xxxxx`）
- ✅ **PCI 合规**：卡号由 Stripe 处理，系统不接触
- ✅ **Token 化**：系统只存储 PaymentMethod ID，不是卡号

**数据库设计（如果实现）**：
```sql
CREATE TABLE user_payment_methods (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id),
  stripe_customer_id VARCHAR(255) NOT NULL,
  stripe_payment_method_id VARCHAR(255) NOT NULL,
  card_brand VARCHAR(50), -- visa, mastercard, etc.
  card_last4 VARCHAR(4),   -- 最后4位数字
  card_exp_month INT,
  card_exp_year INT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

## 📝 上线检查清单

### 环境变量配置

- [ ] `NODE_ENV=production`
- [ ] `USE_MOCK_PAYMENT=false`（系统会自动验证）
- [ ] `STRIPE_SECRET_KEY=sk_live_xxxxx`（生产密钥）
- [ ] `STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx`（生产密钥）
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_xxxxx`（必须设置）

### Stripe 配置

- [ ] 在 Stripe Dashboard 切换到 **Live mode**
- [ ] 复制生产环境的 Secret Key（`sk_live_` 开头）
- [ ] 复制生产环境的 Publishable Key（`pk_live_` 开头）
- [ ] 配置 Webhook endpoint（生产环境 URL）
- [ ] 复制 Webhook Signing Secret（`whsec_` 开头）

### 功能验证

- [ ] 信用卡支付测试（使用 Stripe 测试卡号）
- [ ] Konbini 支付测试（使用 Stripe 测试模式）
- [ ] Webhook 接收测试
- [ ] 退款功能测试
- [ ] 支付路由速率限制测试
- [ ] 幂等性测试（重复请求）

### 安全验证

- [ ] 确认生产环境不能使用假支付（系统会自动阻止）
- [ ] 确认生产环境不能使用测试密钥（系统会自动阻止）
- [ ] 确认所有支付路由都有速率限制和幂等性保护
- [ ] 确认 Webhook 签名验证启用

### 监控和日志

- [ ] 启动日志显示 `LIVE MODE - real charges`
- [ ] 设置 Stripe Dashboard 告警
- [ ] 设置支付失败告警
- [ ] 设置 Webhook 失败告警

## 🎯 总结

### 1. 上线准备

**只需要切换 Stripe 生产密钥即可！**

系统已经实现了：
- ✅ 环境自动切换
- ✅ 生产环境强制验证
- ✅ 所有安全保护机制

### 2. 支持的支付方法

**2 种支付方法**：
1. ✅ **信用卡支付**（Card）
2. ✅ **Konbini 支付**（便利店）

### 3. 保存支付方式

**当前不支持**：
- ❌ 没有保存支付方式功能
- ❌ 每次支付都需要重新输入卡号

**如果未来要实现**：
- ✅ 使用 Stripe Customer API
- ✅ 使用 Stripe PaymentMethod API
- ✅ 系统只存储 PaymentMethod ID，不存储卡号
- ✅ 符合 PCI 合规要求

## 📚 相关文档

- [支付环境配置指南](./PAYMENT_ENVIRONMENT_CONFIG.md)
- [Konbini 支付与 Stripe 的关系](./KONBINI_STRIPE_RELATIONSHIP.md)
- [支付路由安全分析](./PAYMENT_ROUTES_SECURITY_ANALYSIS.md)
