/**
 * 验证测试修复
 * 目的: 运行所有测试并识别失败的测试
 */

const { execSync } = require('child_process');
const fs = require('fs');

console.log('运行所有测试...\n');

try {
  const output = execSync(
    'npx jest --no-coverage --no-watchman --verbose 2>&1',
    {
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    }
  );

  // 保存完整输出
  fs.writeFileSync('test-full-output.txt', output, 'utf8');
  
  // 分析输出
  const lines = output.split('\n');
  const failedTests = [];
  const passedTests = [];
  let currentTest = null;
  let inFailedTest = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('FAIL') || line.includes('●')) {
      inFailedTest = true;
      currentTest = line.trim();
    } else if (line.includes('PASS') || line.includes('✓')) {
      if (currentTest && inFailedTest) {
        failedTests.push(currentTest);
        currentTest = null;
        inFailedTest = false;
      } else {
        passedTests.push(line.trim());
      }
    } else if (line.includes('Test Suites:') || line.includes('Tests:')) {
      console.log(line);
    }
  }

  // 提取测试摘要
  const summaryMatch = output.match(/Test Suites:.*?(\d+) passed.*?(\d+) failed/);
  if (summaryMatch) {
    console.log(`\n测试摘要:`);
    console.log(`通过: ${summaryMatch[1]}`);
    console.log(`失败: ${summaryMatch[2]}`);
  }

  // 提取失败的测试
  const failMatch = output.match(/Tests:.*?(\d+) passed.*?(\d+) failed/);
  if (failMatch) {
    console.log(`\n测试用例:`);
    console.log(`通过: ${failMatch[1]}`);
    console.log(`失败: ${failMatch[2]}`);
  }

  // 查找失败的测试文件
  const failPattern = /FAIL\s+(tests\/[^\s]+)/g;
  const failedFiles = [];
  let match;
  while ((match = failPattern.exec(output)) !== null) {
    failedFiles.push(match[1]);
  }

  if (failedFiles.length > 0) {
    console.log('\n失败的测试文件:');
    failedFiles.forEach(file => {
      console.log(`  - ${file}`);
    });
  }

  // 保存失败信息
  fs.writeFileSync(
    'test-failures.json',
    JSON.stringify({ failedFiles, output: output.substring(0, 50000) }, null, 2),
    'utf8'
  );

  console.log('\n详细输出已保存到: test-full-output.txt');
  console.log('失败信息已保存到: test-failures.json');

} catch (error) {
  console.error('测试运行出错:', error.message);
  if (error.stdout) {
    fs.writeFileSync('test-error-output.txt', error.stdout, 'utf8');
    console.log('错误输出已保存到: test-error-output.txt');
  }
  process.exit(1);
}
