const { spawn } = require('child_process');
const fs = require('fs');

const testProcess = spawn('npx', ['jest', '--testPathPattern=tests/unit', '--no-watchman', '--verbose'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';

testProcess.stdout.on('data', (data) => {
  stdout += data.toString();
  process.stdout.write(data);
});

testProcess.stderr.on('data', (data) => {
  stderr += data.toString();
  process.stderr.write(data);
});

testProcess.on('close', (code) => {
  fs.writeFileSync('test-failures.log', stdout + '\n\nSTDERR:\n' + stderr);
  console.log('\n\nTest output saved to test-failures.log');
  process.exit(code);
});
