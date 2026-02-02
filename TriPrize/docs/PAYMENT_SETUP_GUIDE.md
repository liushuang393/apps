# 💳 TriPrize 支付系统配置完整指南

**重要**: 支付系统需要完整配置才能真正收钱！

---

## ⚠️ 上线前必须完成的支付配置

### 当前状态检查

❌ **未配置 = 无法收钱**

需要完成以下配置才能真正收款:

1. ❌ Stripe账户未激活
2. ❌ 银行账户未绑定
3. ❌ 身份验证未完成
4. ❌ Webhook未配置
5. ❌ 测试密钥 → 生产密钥未切换
6. ❌ 日本支付方式未启用

---

## 📋 Stripe完整配置步骤

### 步骤1: 创建Stripe账户

1. **注册Stripe账户**
   ```
   访问: https://dashboard.stripe.com/register
   选择国家: 日本 (Japan)
   ```

2. **完成身份验证** (KYC)
   - 提供公司信息或个人信息
   - 上传身份证明文件
   - 提供地址证明
   - **重要**: 未完成验证 = 无法提现

3. **绑定银行账户**
   - 添加日本银行账户信息
   - 银行名称
   - 支店名称
   - 口座番号 (账户号码)
   - 口座名義 (账户名)

---

### 步骤2: 获取API密钥

#### 测试环境 (开发用)

1. 登录 Stripe Dashboard
2. 点击右上角 "开发者" → "API密钥"
3. 复制以下密钥:
   ```
   公开可能キー (Publishable key): pk_test_xxxxx
   シークレットキー (Secret key): sk_test_xxxxx
   ```

4. 更新 `api/.env`:
   ```env
   STRIPE_SECRET_KEY=sk_test_xxxxx
   STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
   ```

5. 更新 `mobile/.env`:
   ```env
   STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
   ```

#### 生产环境 (上线用)

⚠️ **上线前必须切换到生产密钥!**

1. Stripe Dashboard → 右上角切换到 "本番モード" (Live mode)
2. 复制生产密钥:
   ```
   公开可能キー: pk_live_xxxxx
   シークレットキー: sk_live_xxxxx
   ```

3. 更新生产环境变量:
   ```env
   STRIPE_SECRET_KEY=sk_live_xxxxx
   STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
   ```

---

### 步骤3: 启用日本支付方式

#### 3.1 信用卡支付 (默认已启用)

支持的卡:
- ✅ Visa
- ✅ Mastercard
- ✅ American Express
- ✅ JCB
- ✅ Diners Club

#### 3.2 便利店支付 (Konbini)

1. Stripe Dashboard → "設定" → "支払い方法"
2. 找到 "Konbini" → 点击 "有効化"
3. 支持的便利店:
   - FamilyMart
   - Lawson
   - Ministop
   - Seicomart
   - Daily Yamazaki

**重要配置**:
```typescript
// 在代码中已实现,确认配置正确
payment_method_types: ['card', 'konbini']
payment_method_options: {
  konbini: {
    expires_after_days: 3  // 3天内支付有效
  }
}
```

#### 3.3 其他日本支付方式 (可选)

可以启用的其他方式:
- **PayPay** (需要申请)
- **LINE Pay** (需要申请)
- **楽天ペイ** (需要申请)
- **銀行振込** (Bank Transfer)

---

### 步骤4: 配置Webhook

⚠️ **Webhook是必须的! 没有Webhook = 支付状态不会更新**

#### 4.1 开发环境 (使用Stripe CLI)

1. **安装Stripe CLI**
   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe
   
   # Windows
   scoop install stripe
   ```

2. **登录Stripe**
   ```bash
   stripe login
   ```

3. **启动Webhook监听**
   ```bash
   stripe listen --forward-to http://localhost:3000/api/payments/webhook
   ```

4. **复制Webhook签名密钥**
   ```
   输出示例:
   > Ready! Your webhook signing secret is whsec_xxxxx
   ```

5. **更新 .env**
   ```env
   STRIPE_WEBHOOK_SECRET=whsec_xxxxx
   ```

#### 4.2 生产环境 (配置真实Webhook)

1. **Stripe Dashboard → "開発者" → "Webhook"**

2. **点击 "エンドポイントを追加"**

3. **配置Webhook端点**
   ```
   エンドポイントURL: https://your-domain.com/api/payments/webhook
   説明: TriPrize Production Webhook
   ```

4. **选择要监听的事件**
   ```
   必须选择:
   ✅ payment_intent.succeeded
   ✅ payment_intent.payment_failed
   ✅ payment_intent.canceled
   ✅ charge.refunded
   
   可选:
   □ payment_intent.created
   □ charge.succeeded
   □ charge.failed
   ```

5. **复制Webhook签名密钥**
   ```
   点击创建的Webhook → 复制 "署名シークレット"
   ```

6. **更新生产环境变量**
   ```env
   STRIPE_WEBHOOK_SECRET=whsec_xxxxx (生产密钥)
   ```

---

### 步骤5: 测试支付流程

#### 5.1 测试信用卡

Stripe提供的测试卡号:

**成功支付**:
```
卡号: 4242 4242 4242 4242
有效期: 任意未来日期 (例: 12/25)
CVC: 任意3位数字 (例: 123)
邮编: 任意 (例: 123-4567)
```

**需要3D认证**:
```
卡号: 4000 0027 6000 3184
```

**支付失败**:
```
卡号: 4000 0000 0000 0002 (卡被拒绝)
卡号: 4000 0000 0000 9995 (余额不足)
```

#### 5.2 测试Konbini支付

1. 创建支付时选择 `payment_method: 'konbini'`
2. Stripe会返回:
   ```json
   {
     "konbini": {
       "confirmation_number": "123456789012",
       "expires_at": 1234567890,
       "store": "familymart"
     }
   }
   ```
3. 测试环境下,可以手动触发Webhook模拟支付完成

---

## 🔒 安全配置

### 1. Webhook签名验证

**已在代码中实现**,确认以下代码存在:

```typescript
// api/src/services/payment.service.ts
const signature = request.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(
  request.body,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

### 2. 密钥安全

❌ **绝对不要**:
- 将密钥提交到Git
- 在前端代码中使用Secret Key
- 在日志中打印密钥

✅ **必须做**:
- 使用环境变量存储密钥
- 定期轮换密钥
- 限制API密钥权限

### 3. HTTPS要求

⚠️ **生产环境必须使用HTTPS**

Stripe要求:
- Webhook端点必须是HTTPS
- 移动应用API调用必须是HTTPS

---

## 💰 收款和提现

### 1. 收款流程

```
用户支付 → Stripe收款 → 扣除手续费 → 余额
```

### 2. Stripe手续费

**日本标准费率**:
- 信用卡: 3.6%
- Konbini: ¥190/笔

**示例**:
```
用户支付: ¥1,000
Stripe手续费: ¥36 (3.6%)
您收到: ¥964
```

### 3. 提现设置

1. **Stripe Dashboard → "残高" → "支払い"**

2. **配置自动提现**
   ```
   频率: 每日 / 每周 / 每月
   最小金额: ¥1,000
   ```

3. **手动提现**
   ```
   点击 "今すぐ支払う" 立即提现到银行账户
   ```

4. **到账时间**
   ```
   日本银行: 通常2-3个工作日
   ```

---

## 📊 监控和报表

### 1. Stripe Dashboard

监控以下指标:
- 成功支付数量和金额
- 失败支付原因
- 退款请求
- 争议 (Dispute)

### 2. 设置通知

```
Stripe Dashboard → "設定" → "通知"

启用:
✅ 支付成功通知
✅ 支付失败通知
✅ 争议通知
✅ 每日摘要邮件
```

---

## ⚠️ 上线前检查清单

### Stripe配置
- [ ] Stripe账户已激活
- [ ] 身份验证已完成 (KYC)
- [ ] 银行账户已绑定
- [ ] 切换到生产密钥 (pk_live_, sk_live_)
- [ ] Webhook已配置并测试
- [ ] 支付方式已启用 (Card + Konbini)

### 代码配置
- [ ] 环境变量使用生产密钥
- [ ] Webhook签名验证已启用
- [ ] HTTPS已配置
- [ ] 错误处理已完善
- [ ] 日志记录已配置

### 测试
- [ ] 信用卡支付测试通过
- [ ] Konbini支付测试通过
- [ ] Webhook接收测试通过
- [ ] 退款流程测试通过
- [ ] 错误处理测试通过

---

## 🆘 常见问题

### Q1: 为什么测试支付成功但没收到钱?

**A**: 测试模式下的支付是模拟的,不会真正扣款和收款。必须切换到生产模式才能真正收钱。

### Q2: Webhook没有触发怎么办?

**A**: 检查:
1. Webhook URL是否正确
2. 服务器是否可以从外网访问
3. HTTPS证书是否有效
4. Webhook签名密钥是否正确

### Q3: 如何测试Konbini支付?

**A**: 测试环境下:
```bash
# 使用Stripe CLI触发事件
stripe trigger payment_intent.succeeded
```

### Q4: 多久能收到钱?

**A**: 
- 首次支付: 7-14天 (Stripe审核期)
- 后续支付: 2-3个工作日

---

**重要提醒**: 
- ⚠️ 测试密钥 ≠ 能收钱
- ⚠️ 必须完成KYC才能提现
- ⚠️ 必须配置Webhook才能更新订单状态
- ⚠️ 生产环境必须使用HTTPS

---

生成时间: 2025-11-14
版本: 1.0.0

