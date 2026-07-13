#!/usr/bin/env node
/**
 * Electron を CDP（Chrome DevTools Protocol）付きで起動する。
 *
 * @description
 * Playwright MCP / cursor-ide-browser からローカル Electron アプリを
 * 自動操作できるようにする。既定ポートは 9222。
 *
 * 使い方:
 *   npm run agent:electron
 *   npm run agent:electron -- --port=9222
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PORT = 9222;

/**
 * CLI 引数からポート番号を取得する
 *
 * @returns {number} CDP ポート
 */
function resolvePort() {
    const arg = process.argv.find((v) => v.startsWith('--port='));
    if (arg != null) {
        const parsed = Number(arg.slice('--port='.length));
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    if (process.env.AGENT_CDP_PORT != null && process.env.AGENT_CDP_PORT !== '') {
        const parsed = Number(process.env.AGENT_CDP_PORT);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return DEFAULT_PORT;
}

/**
 * CDP エンドポイントが応答するか確認する
 *
 * @param {number} port - ポート
 * @returns {Promise<boolean>} 応答すれば true
 */
function isCdpReady(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(400, () => {
            req.destroy();
            resolve(false);
        });
    });
}

/**
 * Electron メインプロセスがビルド済みか確認し、なければビルドする
 *
 * @returns {void}
 */
function ensureElectronBuild() {
    const mainJs = path.join(ROOT, 'dist', 'electron', 'main.js');
    if (fs.existsSync(mainJs)) {
        return;
    }
    console.info('[agent:electron] dist/electron/main.js が無いため build:electron を実行します');
    const result = spawnSync('npm', ['run', 'build:electron'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true
    });
    if (result.status !== 0) {
        console.error('[agent:electron] build:electron に失敗しました');
        process.exit(result.status ?? 1);
    }
}

/**
 * Electron を CDP 付きで起動する
 *
 * @returns {Promise<void>}
 */
async function main() {
    const port = resolvePort();

    if (await isCdpReady(port)) {
        console.info(`[agent:electron] 既に CDP が http://127.0.0.1:${port} で応答中です（再利用）`);
        console.info(`[agent:electron] Playwright MCP: --cdp-endpoint=http://127.0.0.1:${port}`);
        // フォアグラウンドで待機（エージェントがプロセス生存を確認できるように）
        setInterval(() => {}, 60_000);
        return;
    }

    ensureElectronBuild();

    if (process.platform === 'win32') {
        spawnSync('cmd.exe', ['/d', '/s', '/c', 'chcp 65001 >nul'], { stdio: 'ignore' });
    }

    const electronPath = require('electron');
    const childEnv = { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    const electronArgs = ['.', `--remote-debugging-port=${port}`];
    console.info(`[agent:electron] 起動: ${electronPath} ${electronArgs.join(' ')}`);
    console.info(`[agent:electron] CDP: http://127.0.0.1:${port}`);
    console.info('[agent:electron] MCP 接続後、browser_snapshot / browser_click で操作できます');

    const child = spawn(electronPath, electronArgs, {
        cwd: ROOT,
        stdio: 'inherit',
        env: childEnv,
        windowsHide: false
    });

    child.on('error', (error) => {
        console.error('[agent:electron] 起動失敗:', error.message);
        process.exit(1);
    });

    child.on('exit', (code, signal) => {
        if (signal != null) {
            console.error(`[agent:electron] signal=${signal}`);
            process.exit(1);
        }
        process.exit(code ?? 0);
    });

    // CDP 準備待ち（最大 30 秒）
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
        if (await isCdpReady(port)) {
            console.info(`[agent:electron] CDP ready: http://127.0.0.1:${port}/json/version`);
            return;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    console.warn('[agent:electron] CDP 準備タイムアウト（アプリは起動継続中の可能性あり）');
}

main().catch((error) => {
    console.error('[agent:electron] 予期しないエラー:', error);
    process.exit(1);
});
