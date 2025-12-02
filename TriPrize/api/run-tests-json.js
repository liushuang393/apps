/**
 * 运行测试并保存JSON结果
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('运行测试中...\n');

try {
  // 运行测试并获取JSON输出
  const output = execSync(
    'npx jest --no-coverage --no-watchman --json',
    {
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 50 * 1024 * 1024,
      cwd: process.cwd(),
    }
  );

  // 解析JSON
  const result = JSON.parse(output);
  
  // 保存结果
  const resultFile = path.join(process.cwd(), 'test-results.json');
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf8');
  
  console.log('='.repeat(60));
  console.log('测试结果摘要');
  console.log('='.repeat(60));
  console.log(`测试套件: ${result.numPassedTestSuites} 通过, ${result.numFailedTestSuites} 失败`);
  console.log(`测试用例: ${result.numPassedTests} 通过, ${result.numFailedTests} 失败`);
  console.log('='.repeat(60));
  
  if (result.numFailedTests > 0) {
    console.log('\n失败的测试:');
    result.testResults
      .filter(r => r.status === 'failed')
      .forEach((r, idx) => {
        console.log(`\n${idx + 1}. ${r.name}`);
        if (r.assertionResults) {
          r.assertionResults
            .filter(a => a.status === 'failed')
            .forEach(a => {
              console.log(`   - ${a.title}`);
              if (a.failureMessages && a.failureMessages.length > 0) {
                console.log(`     错误: ${a.failureMessages[0].substring(0, 200)}`);
              }
            });
        }
      });
  }
  
  console.log(`\n详细结果已保存到: ${resultFile}`);
  
  process.exit(result.numFailedTests > 0 ? 1 : 0);
  
} catch (error) {
  console.error('运行测试时出错:', error.message);
  if (error.stdout) {
    try {
      const result = JSON.parse(error.stdout);
      const resultFile = path.join(process.cwd(), 'test-results.json');
      fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf8');
      console.log(`结果已保存到: ${resultFile}`);
      
      if (result.numFailedTests > 0) {
        console.log('\n失败的测试:');
        result.testResults
          .filter(r => r.status === 'failed')
          .forEach((r, idx) => {
            console.log(`\n${idx + 1}. ${r.name}`);
          });
      }
    } catch (e) {
      console.error('无法解析输出:', e.message);
    }
  }
  process.exit(1);
}
