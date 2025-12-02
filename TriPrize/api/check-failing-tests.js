const { execSync } = require('child_process');
const fs = require('fs');

try {
  console.log('Running tests...');
  const output = execSync('npx jest --testPathPattern=tests/unit --no-coverage --json', {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024
  });
  
  const results = JSON.parse(output);
  
  console.log(`\nTest Summary:`);
  console.log(`  Test Suites: ${results.numFailedTestSuites} failed, ${results.numPassedTestSuites} passed, ${results.numTotalTestSuites} total`);
  console.log(`  Tests: ${results.numFailedTests} failed, ${results.numPassedTests} passed, ${results.numTotalTests} total\n`);
  
  if (results.testResults) {
    results.testResults.forEach((suite, idx) => {
      if (suite.status === 'failed') {
        console.log(`\n${idx + 1}. FAILED: ${suite.name}`);
        console.log(`   Status: ${suite.status}`);
        if (suite.message) {
          console.log(`   Message: ${suite.message.substring(0, 500)}`);
        }
        if (suite.assertionResults) {
          suite.assertionResults.forEach((test, testIdx) => {
            if (test.status === 'failed') {
              console.log(`\n   Test ${testIdx + 1}: ${test.title}`);
              if (test.failureMessages && test.failureMessages.length > 0) {
                console.log(`   Error: ${test.failureMessages[0].substring(0, 300)}`);
              }
            }
          });
        }
      }
    });
  }
  
  // Save full results
  fs.writeFileSync('jest-results-full.json', JSON.stringify(results, null, 2));
  console.log('\n\nFull results saved to jest-results-full.json');
  
} catch (error) {
  console.error('Error running tests:', error.message);
  if (error.stdout) {
    try {
      const results = JSON.parse(error.stdout);
      console.log(`\nTest Summary:`);
      console.log(`  Test Suites: ${results.numFailedTestSuites} failed, ${results.numPassedTestSuites} passed, ${results.numTotalTestSuites} total`);
      console.log(`  Tests: ${results.numFailedTests} failed, ${results.numPassedTests} passed, ${results.numTotalTests} total\n`);
      
      if (results.testResults) {
        results.testResults.forEach((suite, idx) => {
          if (suite.status === 'failed') {
            console.log(`\n${idx + 1}. FAILED: ${suite.name}`);
            if (suite.assertionResults) {
              suite.assertionResults.forEach((test, testIdx) => {
                if (test.status === 'failed') {
                  console.log(`   Test ${testIdx + 1}: ${test.title}`);
                  if (test.failureMessages && test.failureMessages.length > 0) {
                    console.log(`   Error: ${test.failureMessages[0].substring(0, 500)}`);
                  }
                }
              });
            }
          }
        });
      }
    } catch (e) {
      console.log('Raw output:', error.stdout.substring(0, 2000));
    }
  }
}
