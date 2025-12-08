const { execSync } = require('child_process');

try {
  const output = execSync('npx jest --testPathPattern=tests/unit --no-watchman --verbose', {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024
  });
  console.log(output);
} catch (error) {
  console.error('Test execution failed:');
  console.error(error.stdout);
  console.error(error.stderr);
  process.exit(1);
}
