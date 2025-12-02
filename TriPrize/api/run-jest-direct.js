/**
 * 直接运行Jest并捕获输出
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('开始运行测试...\n');

const jestProcess = spawn('npx', ['jest', '--no-coverage', '--no-watchman'], {
  cwd: process.cwd(),
  shell: true,
  stdio: ['inherit', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

jestProcess.stdout.on('data', (data) => {
  const text = data.toString();
  stdout += text;
  process.stdout.write(text);
});

jestProcess.stderr.on('data', (data) => {
  const text = data.toString();
  stderr += text;
  process.stderr.write(text);
});

jestProcess.on('close', (code) => {
  console.log(`\n测试进程退出，代码: ${code}`);
  
  // 保存完整输出
  const outputFile = path.join(process.cwd(), 'jest-full-output.txt');
  fs.writeFileSync(outputFile, stdout + '\n\nSTDERR:\n' + stderr, 'utf8');
  console.log(`完整输出已保存到: ${outputFile}`);
  
  // 解析结果
  const allOutput = stdout + stderr;
  
  // 提取测试摘要
  const suiteMatch = allOutput.match(/Test Suites:\s+(\d+)\s+passed,?\s*(\d+)\s+failed/);
  const testMatch = allOutput.match(/Tests:\s+(\d+)\s+passed,?\s*(\d+)\s+failed/);
  
  if (suiteMatch && testMatch) {
    const suitesPassed = parseInt(suiteMatch[1], 10);
    const suitesFailed = parseInt(suiteMatch[2], 10);
    const testsPassed = parseInt(testMatch[1], 10);
    const testsFailed = parseInt(testMatch[2], 10);
    
    console.log('\n' + '='.repeat(60));
    console.log('测试结果摘要');
    console.log('='.repeat(60));
    console.log(`测试套件: ${suitesPassed} 通过, ${suitesFailed} 失败`);
    console.log(`测试用例: ${testsPassed} 通过, ${testsFailed} 失败`);
    console.log('='.repeat(60));
    
    // 提取失败的测试
    const failMatches = allOutput.matchAll(/FAIL\s+(tests\/[^\s]+)/g);
    const failedFiles = Array.from(failMatches, m => m[1]);
    
    if (failedFiles.length > 0) {
      console.log('\n失败的测试文件:');
      failedFiles.forEach((file, idx) => {
        console.log(`  ${idx + 1}. ${file}`);
      });
    }
  }
  
  process.exit(code || 0);
});

jestProcess.on('error', (error) => {
  console.error('启动Jest时出错:', error);
  process.exit(1);
});
