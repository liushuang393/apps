const { spawn } = require('child_process');
const fs = require('fs');

console.log('Running Jest tests...\n');

const jest = spawn('npx', ['jest', '--verbose', '--no-coverage'], {
  cwd: __dirname,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});

let stdout = '';
let stderr = '';

jest.stdout.on('data', (data) => {
  const text = data.toString();
  stdout += text;
  process.stdout.write(text);
});

jest.stderr.on('data', (data) => {
  const text = data.toString();
  stderr += text;
  process.stderr.write(text);
});

jest.on('close', (code) => {
  console.log(`\n\nJest exited with code ${code}`);
  
  // Save output to file
  fs.writeFileSync('jest-debug-output.txt', stdout + '\n\nSTDERR:\n' + stderr);
  console.log('\nOutput saved to jest-debug-output.txt');
  
  // Extract failed tests
  const failedMatches = stdout.match(/FAIL\s+([^\n]+)/g);
  if (failedMatches) {
    console.log('\nFailed tests:');
    failedMatches.forEach(match => console.log('  ' + match));
  }
  
  process.exit(code);
});

jest.on('error', (err) => {
  console.error('Failed to start Jest:', err);
  process.exit(1);
});
