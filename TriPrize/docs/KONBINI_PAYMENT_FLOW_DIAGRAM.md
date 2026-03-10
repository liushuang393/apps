# Konbini 支付流程对比图

## 🔴 当前实现（使用模拟数据）

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 PaymentProcessingPage                │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ 1. createPurchase()
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              POST /api/purchases                             │
│  请求: { campaign_id, position_ids, payment_method: 'konbini' }│
│  响应: Purchase { purchase_id, status: 'pending', ... }      │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ ✅ Purchase 创建成功
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  前端代码: payment_processing_page.dart:378-390              │
│                                                              │
│  if (widget.paymentMethod == 'konbini') {                   │
│    // ❌ 使用硬编码的模拟数据                                │
│    _paymentIntent = PaymentIntentModel(                      │
│      paymentIntentId: 'pi_konbini_${timestamp}',            │
│      konbiniReference: '123456789012',  // ❌ 假的！         │
│      konbiniExpiresAt: DateTime.now() + 4 days,             │
│    );                                                        │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ ❌ 没有调用后端 API
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  显示支付编号: "123456789012"  (假的，用户无法支付！)        │
└─────────────────────────────────────────────────────────────┘
```

## ✅ 正确实现（使用真实数据）

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 PaymentProcessingPage                │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ 1. createPurchase()
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              POST /api/purchases                             │
│  请求: { campaign_id, position_ids, payment_method: 'konbini' }│
│  响应: Purchase { purchase_id, status: 'pending', ... }      │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ ✅ Purchase 创建成功
                          │
                          │ 2. createPaymentIntent()
                          ▼
┌─────────────────────────────────────────────────────────────┐
│         POST /api/payments/create-intent                     │
│  请求: { purchase_id, payment_method: 'konbini' }           │
│  响应: {                                                    │
│    payment_intent_id: "pi_xxx",                            │
│    transaction_id: "xxx",                                  │
│    amount: 1000,                                           │
│    status: "requires_payment_method"                       │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ ✅ PaymentIntent 创建成功
                          │
                          │ 3. getKonbiniDetails()
                          ▼
┌─────────────────────────────────────────────────────────────┐
│      GET /api/payments/konbini/:paymentIntentId             │
│  响应: {                                                    │
│    store_type: "lawson",                                   │
│    confirmation_number: "123456789012",  // ✅ 真实数据！   │
│    payment_code: "123456789012",                           │
│    expires_at: "2025-12-05T12:00:00Z",                     │
│    instructions_url: "https://..."                          │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ ✅ 获取到真实数据
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  显示支付编号: "123456789012"  (真实，用户可以在便利店支付！) │
└─────────────────────────────────────────────────────────────┘
```

## 📊 数据流对比

### 当前流程（错误）
```
Purchase API
    ↓
前端直接使用模拟数据
    ↓
显示假的支付编号 ❌
```

### 正确流程
```
Purchase API
    ↓
PaymentIntent API
    ↓
Konbini Details API
    ↓
显示真实的支付编号 ✅
```

## 🔑 关键问题

### 问题 1: API 调用缺失
```dart
// ❌ 当前代码缺少这些调用：
// POST /api/payments/create-intent
// GET /api/payments/konbini/:id
```

### 问题 2: 数据源方法缺失
```dart
// ❌ purchase_remote_datasource.dart 中缺少：
Future<PaymentIntentModel> createPaymentIntent(...);
Future<KonbiniPaymentInfo> getKonbiniDetails(...);
```

### 问题 3: 时序问题
```
当前: Purchase → 立即显示模拟数据
正确: Purchase → PaymentIntent → KonbiniInfo → 显示真实数据
```

## 💡 为什么不能用真实数据？

### 技术层面
1. **没有 PaymentIntent ID**
   - 前端没有调用 `createPaymentIntent` API
   - 因此没有 `payment_intent_id`
   - 没有 ID 就无法获取 Konbini 详情

2. **数据流断裂**
   - 后端设计：Purchase → PaymentIntent → KonbiniInfo
   - 前端实现：Purchase → 模拟数据
   - 中间环节缺失

### 业务层面
1. **用户无法支付**
   - 模拟的支付编号 `123456789012` 在 Stripe 中不存在
   - 用户在便利店无法使用这个编号支付
   - 导致购买流程无法完成

2. **数据不一致**
   - 前端显示的是假数据
   - 后端没有对应的 PaymentIntent
   - 支付状态无法同步

## 🎯 修复后的效果

### 修复前
```
用户看到: "123456789012" (假的)
Stripe 中: 不存在这个 PaymentIntent
结果: 用户无法支付 ❌
```

### 修复后
```
用户看到: "987654321098" (真实的)
Stripe 中: 存在对应的 PaymentIntent
结果: 用户可以在便利店支付 ✅
```
