# Unit Test Fixes

## 修复的问题

### 1. `lottery.service.test.ts` - Mock Campaign 对象缺少字段

**问题**: `mockCampaign` 对象缺少 `getCampaignDetail` 返回所需的一些字段

**修复**: 添加了缺失的字段：
- `created_by`
- `base_length`
- `layer_prices`
- `profit_margin_percent`
- `purchase_limit`
- `auto_draw`
- `start_date`
- `drawn_at`
- `created_at`
- `updated_at`

### 2. `lottery.service.test.ts` - Advisory Lock 测试缺少 Mock

**问题**: "should throw error if advisory lock cannot be acquired" 测试中缺少 `campaignService.getCampaignDetail` 的 mock

**修复**: 在测试开始时添加了 `campaignService.getCampaignDetail` 的 mock

### 3. `lottery.service.test.ts` - Campaign Not Closed 测试

**问题**: Mock campaign 对象缺少 `positions_total` 字段，导致测试逻辑不正确

**修复**: 在测试中添加了 `positions_total: 10` 字段

### 4. `purchase.service.test.ts` - 缺少 UPDATE users stats 查询

**问题**: Mock 设置中缺少 `UPDATE users` 查询（更新用户统计信息）

**修复**: 在两个测试用例的 mock 链中添加了 `UPDATE users stats` 查询

### 5. `purchase.service.test.ts` - Idempotency Key 测试期望值不正确

**问题**: 测试期望 idempotency key 直接使用传入的值，但实际实现中会对每个 position 生成唯一的 hashed key

**修复**: 更新了测试期望值，检查 idempotency key 参数存在（即使它是 hashed 的），并验证每个 position 都有自己的 hashed idempotency key

## 测试文件修改列表

1. `api/tests/unit/services/lottery.service.test.ts`
   - 添加了完整的 `mockCampaign` 对象字段
   - 修复了 advisory lock 测试的 mock 设置
   - 修复了 campaign not closed 测试的 mock 设置

2. `api/tests/unit/services/purchase.service.test.ts`
   - 添加了 `UPDATE users stats` 查询到 mock 链
   - 修复了 idempotency key 测试的期望值

## 运行测试

```bash
cd api
npm run test:unit
```

预期结果：所有单元测试应该通过。
