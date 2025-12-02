const { spawn } = require('child_process');
const path = require('path');

const testFile = process.argv[2];

if (!testFile) {
  console.error('Usage: node run-single-test.js <test-file-path>');
  process.exit(1);
}

console.log(`Running test: ${testFile}\n`);

const jest = spawn('npx', ['jest', testFile, '--no-coverage', '--verbose'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
});

jest.on('close', (code) => {
  process.exit(code);
});

jest.on('error', (err) => {
  console.error('Failed to start Jest:', err);
  process.exit(1);
});
