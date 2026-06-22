#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const electron = require('electron');

if (process.platform === 'win32') {
    spawnSync('cmd.exe', ['/d', '/s', '/c', 'chcp 65001 >nul'], {
        stdio: 'ignore'
    });
}

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: childEnv,
    windowsHide: false
});

child.on('error', (error) => {
    console.error('[electron:run] Failed to start Electron:', error.message);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal) {
        console.error(`[electron:run] Electron exited by signal ${signal}`);
        process.exit(1);
    }
    process.exit(code ?? 0);
});
