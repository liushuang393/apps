/** Launch a packaged Electron executable in main's non-interactive smoke mode. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const explicitExecutable = process.argv[2];
const defaultExecutable = path.join(
    __dirname,
    '..',
    'release',
    'win-unpacked',
    'VoiceTranslate Pro.exe'
);
const executable = path.resolve(explicitExecutable || defaultExecutable);

if (!fs.existsSync(executable)) {
    console.error(`Packaged executable was not found: ${executable}`);
    process.exit(1);
}

const childEnvironment = { ...process.env, NODE_ENV: 'production' };
delete childEnvironment.ELECTRON_RUN_AS_NODE;

const result = spawnSync(executable, ['--smoke-test'], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    env: childEnvironment
});

if (result.stdout) {
    process.stdout.write(result.stdout);
}
if (result.stderr) {
    process.stderr.write(result.stderr);
}
if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}
process.exit(result.status === 0 ? 0 : 1);
