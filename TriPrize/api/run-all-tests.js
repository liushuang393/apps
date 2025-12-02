const { execSync } = require('child_process');
const fs = require('fs');

console.log('Running all tests...\n');

try {
  // Run tests with verbose output
  const output = execSync('npx jest --verbose --no-coverage 2>&1', {
    cwd: __dirname,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  // Save full output
  fs.writeFileSync('test-output-full.txt', output);
  
  // Extract summary
  const lines = output.split('\n');
  const summaryStart = lines.findIndex(line => line.includes('Test Suites:') || line.includes('Tests:'));
  
  if (summaryStart >= 0) {
    console.log('\n=== TEST SUMMARY ===');
    lines.slice(summaryStart).forEach(line => console.log(line));
  }
  
  // Extract failed tests
  const failedTests = [];
  let inFailedTest = false;
  let currentTest = '';
  
  lines.forEach((line, index) => {
    if (line.includes('FAIL') && line.includes('.test.ts')) {
      inFailedTest = true;
      currentTest = line.trim();
    } else if (inFailedTest && (line.includes('PASS') || line.includes('Test Suites:'))) {
      if (currentTest) {
        failedTests.push(currentTest);
        currentTest = '';
      }
      inFailedTest = false;
    } else if (inFailedTest && line.trim().startsWith('●')) {
      currentTest += '\n  ' + line.trim();
    }
  });
  
  if (failedTests.length > 0) {
    console.log('\n=== FAILED TESTS ===');
    failedTests.forEach(test => console.log(test));
  }
  
  // Count failures
  const failMatch = output.match(/(\d+) failed/);
  const passMatch = output.match(/(\d+) passed/);
  
  console.log('\n=== STATISTICS ===');
  if (failMatch) console.log(`Failed: ${failMatch[1]}`);
  if (passMatch) console.log(`Passed: ${passMatch[1]}`);
  
  console.log('\nFull output saved to test-output-full.txt');
  
} catch (error) {
  console.error('Error running tests:', error.message);
  if (error.stdout) {
    fs.writeFileSync('test-output-error.txt', error.stdout);
    console.log('Error output saved to test-output-error.txt');
  }
  process.exit(1);
}
