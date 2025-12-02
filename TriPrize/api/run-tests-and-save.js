/**
 * 运行所有测试并保存结果
 * 目的: 识别失败的测试用例
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('开始运行测试...\n');

try {
  // 运行测试并捕获输出
  const output = execSync(
    'npx jest --no-coverage --no-watchman 2>&1',
    {
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 50 * 1024 * 1024, // 50MB
      cwd: process.cwd(),
    }
  );

  // 保存完整输出
  const outputFile = path.join(process.cwd(), 'test-results-full.txt');
  fs.writeFileSync(outputFile, output, 'utf8');
  console.log(`完整输出已保存到: ${outputFile}\n`);

  // 解析输出
  const lines = output.split('\n');
  
  // 提取测试摘要
  let testSuitesPassed = 0;
  let testSuitesFailed = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  
  const failedTests = [];
  let currentFailedFile = null;
  let collectingFailure = false;
  let failureDetails = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 提取测试套件统计
    const suiteMatch = line.match(/Test Suites:\s+(\d+) passed,?\s*(\d+) failed/);
    if (suiteMatch) {
      testSuitesPassed = parseInt(suiteMatch[1], 10);
      testSuitesFailed = parseInt(suiteMatch[2], 10);
    }
    
    // 提取测试用例统计
    const testMatch = line.match(/Tests:\s+(\d+) passed,?\s*(\d+) failed/);
    if (testMatch) {
      testsPassed = parseInt(testMatch[1], 10);
      testsFailed = parseInt(testMatch[2], 10);
    }
    
    // 提取失败的测试文件
    if (line.includes('FAIL') && line.includes('tests/')) {
      const fileMatch = line.match(/FAIL\s+(tests\/[^\s]+)/);
      if (fileMatch) {
        currentFailedFile = fileMatch[1];
        failedTests.push({
          file: currentFailedFile,
          failures: [],
        });
        collectingFailure = true;
        failureDetails = [];
      }
    }
    
    // 收集失败详情
    if (collectingFailure && currentFailedFile) {
      failureDetails.push(line);
      
      // 如果遇到新的测试文件或测试摘要，停止收集
      if ((line.includes('PASS') || line.includes('Test Suites:') || line.includes('Tests:')) && failureDetails.length > 1) {
        const lastFailed = failedTests[failedTests.length - 1];
        if (lastFailed) {
          lastFailed.failures.push(failureDetails.join('\n'));
        }
        collectingFailure = false;
        failureDetails = [];
      }
    }
  }

  // 打印摘要
  console.log('='.repeat(60));
  console.log('测试结果摘要');
  console.log('='.repeat(60));
  console.log(`测试套件: ${testSuitesPassed} 通过, ${testSuitesFailed} 失败`);
  console.log(`测试用例: ${testsPassed} 通过, ${testsFailed} 失败`);
  console.log('='.repeat(60));

  if (failedTests.length > 0) {
    console.log('\n失败的测试文件:');
    failedTests.forEach((failed, index) => {
      console.log(`\n${index + 1}. ${failed.file}`);
      if (failed.failures && failed.failures.length > 0) {
        console.log('失败详情:');
        console.log(failed.failures[0].substring(0, 500));
      }
    });
  }

  // 保存失败信息到JSON
  const failuresFile = path.join(process.cwd(), 'test-failures.json');
  fs.writeFileSync(
    failuresFile,
    JSON.stringify({
      summary: {
        testSuitesPassed,
        testSuitesFailed,
        testsPassed,
        testsFailed,
      },
      failedTests: failedTests.map(f => ({
        file: f.file,
        failureCount: f.failures ? f.failures.length : 0,
      })),
    }, null, 2),
    'utf8'
  );
  console.log(`\n失败信息已保存到: ${failuresFile}`);

  // 返回退出码
  process.exit(testSuitesFailed > 0 || testsFailed > 0 ? 1 : 0);

} catch (error) {
  console.error('运行测试时出错:', error.message);
  if (error.stdout) {
    const errorFile = path.join(process.cwd(), 'test-error.txt');
    fs.writeFileSync(errorFile, error.stdout, 'utf8');
    console.log(`错误输出已保存到: ${errorFile}`);
  }
  process.exit(1);
}
