const { spawn } = require('child_process');
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

async function runTest(file) {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['jest', file, '--no-coverage', '--no-watchman'], {
      stdio: 'pipe',
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      resolve({
        file,
        passed: code === 0,
        stdout,
        stderr,
        code,
      });
    });
  });
}

async function main() {
  console.log('开始运行测试...\n');
  const results = [];

  for (let i = 0; i < testFiles.length; i++) {
    const file = testFiles[i];
    console.log(`\n[${i + 1}/${testFiles.length}] ${file}`);
    console.log('='.repeat(60));
    
    const result = await runTest(file);
    results.push(result);
    
    if (result.passed) {
      console.log(`✓ PASSED\n`);
    } else {
      console.log(`✗ FAILED (exit code: ${result.code})\n`);
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n' + '='.repeat(60));
  console.log('测试结果汇总:');
  console.log(`总计: ${results.length}`);
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);

  if (failed > 0) {
    console.log('\n失败的测试:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.file}`);
    });
  }

  fs.writeFileSync('test-results.json', JSON.stringify(results, null, 2));
  console.log('\n详细结果已保存到 test-results.json');
}

main().catch(console.error);
