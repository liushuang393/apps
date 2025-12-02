/**
 * 逐个运行测试文件并显示结果
 * 目的: 识别失败的测试文件
 * I/O: 控制台输出测试结果
 * 注意点: 逐个运行以便识别具体失败的测试
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

console.log('\n=== 开始逐个运行测试 ===\n');

const results = [];
const failedTests = [];

for (const file of testFiles) {
  console.log(`\n测试文件: ${file}`);
  console.log('----------------------------------------');
  
  try {
    const output = execSync(
      `npx jest ${file} --no-coverage --no-watchman`,
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );
    
    console.log('✓ 通过');
    results.push({ file, status: 'PASS' });
  } catch (error) {
    console.log('✗ 失败');
    console.log(error.stdout || error.message);
    if (error.stderr) {
      console.log('错误输出:', error.stderr);
    }
    results.push({ 
      file, 
      status: 'FAIL',
      error: error.stdout || error.message 
    });
    failedTests.push(file);
  }
}

console.log('\n=== 测试结果汇总 ===\n');
console.log(`总计: ${results.length} 个测试文件`);
console.log(`通过: ${results.filter(r => r.status === 'PASS').length} 个`);
console.log(`失败: ${failedTests.length} 个`);

if (failedTests.length > 0) {
  console.log('\n失败的测试文件:');
  failedTests.forEach(file => {
    console.log(`  - ${file}`);
  });
}

// 保存结果到文件
fs.writeFileSync(
  'test-results-individual.json',
  JSON.stringify(results, null, 2),
  'utf8'
);
console.log('\n结果已保存到: test-results-individual.json');
