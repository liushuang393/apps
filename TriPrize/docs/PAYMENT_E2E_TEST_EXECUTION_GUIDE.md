# 支付 E2E 测试执行指南

## 📋 测试文件

**文件路径**: `api/tests/integration/payment-e2e-comprehensive.test.ts`

**测试覆盖**: 26 个测试用例

## 🚀 运行测试

### 方法 1: 使用 npm 脚本

```bash
cd api
npm run test:integration -- payment-e2e-comprehensive
```

### 方法 2: 使用 Jest 直接运行

```bash
cd api
npx jest tests/integration/payment-e2e-comprehensive.test.ts --verbose
```

### 方法 3: 使用 PowerShell 脚本

```powershell
cd api
powershell -ExecutionPolicy Bypass -File run-payment-e2e-test.ps1
```

### 方法 4: 运行特定测试套件

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

## 📊 测试覆盖率

运行测试时使用 `--coverage` 参数查看覆盖率：

```bash
npx jest tests/integration/payment-e2e-comprehensive.test.ts --coverage
```

## ⚠️ 前置条件

1. **Docker 服务运行**:
   ```bash
   docker ps
   # 确保 PostgreSQL 和 Redis 容器运行
   ```

2. **数据库迁移**:
   ```bash
   cd api
   npm run migrate
   # 或手动运行迁移文件 007_fix_payment_transactions_schema.sql
   ```

3. **环境变量**:
   - `USE_MOCK_PAYMENT=true` (测试环境自动设置)
   - `NODE_ENV=test` (测试环境自动设置)

## 🔍 测试检查清单

### 信用卡支付流程 (5 个测试)
- [ ] 创建支付意图
- [ ] 确认支付成功
- [ ] 3D Secure 支付
- [ ] 已支付订单拒绝
- [ ] 重复支付意图拒绝

### Konbini 支付流程 (3 个测试)
- [ ] 创建 Konbini 支付意图
- [ ] 获取 Konbini 支付详情
- [ ] 不存在的支付意图处理

### 退款流程 (5 个测试)
- [ ] 全额退款（管理员）
- [ ] 部分退款
- [ ] 非管理员用户拒绝
- [ ] 不存在的交易拒绝
- [ ] 已退款交易拒绝

### 速率限制和幂等性 (2 个测试)
- [ ] 支付意图创建的速率限制
- [ ] 支付意图创建的幂等性

### Webhook 处理 (3 个测试)
- [ ] `payment_intent.succeeded` 事件处理
- [ ] `payment_intent.payment_failed` 事件处理
- [ ] 无效签名拒绝

### 错误场景 (5 个测试)
- [ ] 不存在的购买订单
- [ ] 其他用户的购买订单
- [ ] 无效的支付意图
- [ ] 未授权请求
- [ ] 请求体验证

### 交易查询 (3 个测试)
- [ ] 获取用户交易列表
- [ ] 根据 ID 获取交易详情
- [ ] 不存在的交易处理

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

### 运行单个测试用例

```bash
npx jest tests/integration/payment-e2e-comprehensive.test.ts -t "should create payment intent for card payment"
```

## 📝 已知问题

### 数据库字段名不一致

**问题**: 数据库 schema 中使用 `payment_method_type` 和 `status`，但代码中使用 `payment_method` 和 `payment_status`。

**解决方案**: 已创建迁移文件 `007_fix_payment_transactions_schema.sql` 来修复此问题。

**运行迁移**:
```bash
psql -U triprize -d triprize -f migrations/007_fix_payment_transactions_schema.sql
```

## ✅ 测试验证

运行测试后，检查以下内容：

1. **所有测试通过**: 26/26 测试用例通过
2. **代码覆盖率**: 支付相关代码覆盖率 > 90%
3. **无错误**: 没有未处理的错误或警告
4. **数据清理**: 测试数据已正确清理

## 📚 相关文档

- [支付 E2E 测试指南](./PAYMENT_E2E_TEST_GUIDE.md)
- [支付 E2E 测试总结](./PAYMENT_E2E_TEST_SUMMARY.md)
- [支付方法说明和上线检查清单](./PAYMENT_METHODS_AND_DEPLOYMENT_CHECKLIST.md)
