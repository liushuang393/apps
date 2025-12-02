/**
 * 逐个运行测试文件并保存结果
 * 目的: 识别失败的测试用例
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

const results = [];
let totalPassed = 0;
let totalFailed = 0;

console.log('开始逐个运行测试文件...\n');
console.log('='.repeat(60));

for (let i = 0; i < testFiles.length; i++) {
  const file = testFiles[i];
  console.log(`\n[${i + 1}/${testFiles.length}] 运行: ${file}`);
  console.log('-'.repeat(60));

  try {
    const output = execSync(
      `npx jest "${file}" --no-coverage --no-watchman 2>&1`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
      }
    );

    // 检查输出中是否包含失败信息
    const hasFailures = output.includes('FAIL') || 
                       output.includes('failing') ||
                       output.match(/Tests:\s+\d+\s+passed,\s+(\d+)\s+failed/)?.groups?.[1] !== '0';

    if (hasFailures) {
      console.log('✗ 失败');
      totalFailed++;
      
      // 提取失败详情
      const failureLines = output.split('\n').filter(line => 
        line.includes('FAIL') || 
        line.includes('●') ||
        line.includes('Expected:') ||
        line.includes('Received:')
      );
      
      results.push({
        file,
        status: 'FAIL',
        output: output.substring(0, 2000),
        failureLines: failureLines.slice(0, 20),
      });
      
      // 保存失败输出到单独文件
      const failureFile = path.join(process.cwd(), `test-failure-${i + 1}-${path.basename(file, '.test.ts')}.txt`);
      fs.writeFileSync(failureFile, output, 'utf8');
      console.log(`  失败详情已保存到: ${failureFile}`);
    } else {
      console.log('✓ 通过');
      totalPassed++;
      results.push({
        file,
        status: 'PASS',
      });
    }
  } catch (error) {
    console.log('✗ 失败 (执行错误)');
    totalFailed++;
    
    const errorOutput = error.stdout || error.stderr || error.message || '';
    results.push({
      file,
      status: 'FAIL',
      error: errorOutput.substring(0, 2000),
    });
    
    // 保存错误输出
    const errorFile = path.join(process.cwd(), `test-error-${i + 1}-${path.basename(file, '.test.ts')}.txt`);
    fs.writeFileSync(errorFile, errorOutput, 'utf8');
    console.log(`  错误详情已保存到: ${errorFile}`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('测试结果汇总');
console.log('='.repeat(60));
console.log(`总计: ${testFiles.length} 个测试文件`);
console.log(`通过: ${totalPassed} 个`);
console.log(`失败: ${totalFailed} 个`);

if (totalFailed > 0) {
  console.log('\n失败的测试文件:');
  results.filter(r => r.status === 'FAIL').forEach((r, idx) => {
    console.log(`  ${idx + 1}. ${r.file}`);
  });
}

// 保存结果到JSON
const resultsFile = path.join(process.cwd(), 'test-results-individual.json');
fs.writeFileSync(
  resultsFile,
  JSON.stringify({
    summary: {
      total: testFiles.length,
      passed: totalPassed,
      failed: totalFailed,
    },
    results,
  }, null, 2),
  'utf8'
);
console.log(`\n详细结果已保存到: ${resultsFile}`);

// 退出码
process.exit(totalFailed > 0 ? 1 : 0);
