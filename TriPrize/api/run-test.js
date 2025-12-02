const { spawn } = require('child_process');
const path = require('path');

const testFile = process.argv[2] || '';

if (!testFile) {
  console.error('Usage: node run-test.js <test-file-path>');
  process.exit(1);
}

console.log(`Running test: ${testFile}`);
console.log('---');

const jest = spawn('npx', ['jest', testFile, '--no-coverage', '--verbose'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

jest.on('close', (code) => {
  console.log('---');
  console.log(`Test completed with exit code: ${code}`);
  process.exit(code || 0);
});

jest.on('error', (err) => {
  console.error('Error running test:', err);
  process.exit(1);
});
