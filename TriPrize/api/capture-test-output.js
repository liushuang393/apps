const { execSync } = require('child_process');

try {
  const output = execSync('npx jest --testPathPattern=tests/unit --no-coverage', {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024
  });
  console.log(output);
} catch (error) {
  console.log(error.stdout || error.message);
  if (error.stderr) {
    console.log('STDERR:', error.stderr);
  }
}
