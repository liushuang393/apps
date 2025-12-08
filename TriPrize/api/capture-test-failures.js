const { execSync } = require('child_process');
const fs = require('fs');

try {
  console.log('Running unit tests...\n');
  const output = execSync('npm run test:unit', {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024
  });
  
  fs.writeFileSync('test-output-full.log', output);
  console.log(output);
} catch (error) {
  const stdout = error.stdout || '';
  const stderr = error.stderr || '';
  const fullOutput = stdout + '\n\nSTDERR:\n' + stderr;
  
  fs.writeFileSync('test-output-full.log', fullOutput);
  console.error('Tests failed:');
  console.error(stdout);
  if (stderr) {
    console.error('\nSTDERR:');
    console.error(stderr);
  }
  
  // Extract failure details
  const failures = stdout.match(/● (.+)/g) || [];
  if (failures.length > 0) {
    console.error('\n\n=== FAILED TESTS ===');
    failures.forEach(f => console.error(f));
  }
  
  process.exit(error.status || 1);
}
