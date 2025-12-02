/**
 * 检查测试状态
 * 目的: 运行所有测试并识别失败的测试
 * I/O: 输出测试结果到控制台和文件
 */

const { execSync } = require('child_process');
const fs = require('fs');

const testFiles = [
  'tests/unit/utils/crypto.test.ts',
  'tests/unit/utils/position-calculator.test.ts',
  'tests/unit/middleware/auth.middleware.test.ts',
  'tests/unit/middleware/role.middleware.test.ts',
  'tests/unit/services/user.service.test.ts',
  'tests/unit/services/campaign.service.test.ts',
  'tests/unit/services/lottery.service.test.ts',
  'tests/unit/services/purchase.service.test.ts',
  'tests/unit/services/payment.service.test.ts',
  'tests/unit/services/notification.service.test.ts',
  'tests/unit/services/idempotency.service.test.ts',
  'tests/unit/controllers/user.controller.test.ts',
  'tests/unit/controllers/purchase.controller.test.ts',
  'tests/unit/controllers/payment.controller.test.ts',
  'tests/unit/controllers/auth-flow-comprehensive.test.ts',
  'tests/unit/controllers/purchase-flow-comprehensive.test.ts',
  'tests/unit/controllers/lottery-flow-comprehensive.test.ts',
  'tests/unit/controllers/admin-management-comprehensive.test.ts',
  'tests/integration/auth-flow.test.ts',
  'tests/integration/campaigns.test.ts',
  'tests/integration/lottery-flow.test.ts',
  'tests/integration/payment-webhook.test.ts',
  'tests/integration/purchase-validation.test.ts',
  'tests/integration/purchase-flow.test.ts',
  'tests/contract/stripe-api.test.ts',
  'tests/contract/stripe-webhook.test.ts',
];

console.log('开始运行测试...\n');

const results = [];
let passCount = 0;
let failCount = 0;

for (let i = 0; i < testFiles.length; i++) {
  const file = testFiles[i];
  console.log(`[${i + 1}/${testFiles.length}] 测试: ${file}`);
  
  try {
    const output = execSync(
      `npx jest "${file}" --no-coverage --no-watchman --silent`,
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      }
    );
    
    // 检查输出中是否包含失败信息
    if (output.includes('FAIL') || output.includes('failing')) {
      throw new Error('Test failed');
    }
    
    console.log('  ✓ 通过\n');
    results.push({ file, status: 'PASS', output: output.substring(0, 200) });
    passCount++;
  } catch (error) {
    console.log('  ✗ 失败\n');
    const errorOutput = error.stdout || error.stderr || error.message || '';
    results.push({ 
      file, 
      status: 'FAIL',
      error: errorOutput.substring(0, 500)
    });
    failCount++;
  }
}

console.log('\n=== 测试结果汇总 ===');
console.log(`总计: ${testFiles.length} 个测试文件`);
console.log(`通过: ${passCount} 个`);
console.log(`失败: ${failCount} 个\n`);

if (failCount > 0) {
  console.log('失败的测试文件:');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  - ${r.file}`);
  });
}

// 保存详细结果
fs.writeFileSync(
  'test-check-results.json',
  JSON.stringify(results, null, 2),
  'utf8'
);

console.log('\n详细结果已保存到: test-check-results.json');
