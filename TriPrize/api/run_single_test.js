const { spawn } = require('child_process');

const testFile = process.argv[2];
if (!testFile) {
  console.error('Usage: node run_single_test.js <test-file>');
  process.exit(1);
}

console.log(`Running test: ${testFile}`);
const proc = spawn('npx', ['jest', testFile, '--no-coverage'], {
  stdio: 'inherit',
  shell: true,
});

proc.on('exit', (code) => {
  process.exit(code);
});
