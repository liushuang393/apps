#!/usr/bin/env node
/**
 * Chrome を拡張機能ロード + CDP 付きで起動する。
 *
 * @description
 * プロジェクトの Chrome 拡張（manifest.json のあるルート）を
 * --load-extension で読み込み、Playwright MCP から操作可能にする。
 * 既定 CDP ポートは 9223（Electron の 9222 と衝突しない）。
 *
 * 使い方:
 *   npm run agent:extension
 *   npm run agent:extension -- --port=9223
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PORT = 9223;

/**
 * CLI / 環境変数からポートを解決する
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
    if (process.env.AGENT_EXTENSION_CDP_PORT != null && process.env.AGENT_EXTENSION_CDP_PORT !== '') {
        const parsed = Number(process.env.AGENT_EXTENSION_CDP_PORT);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return DEFAULT_PORT;
}

/**
 * Chrome / Edge の実行ファイルを探す
 *
 * @returns {string} ブラウザパス
 * @throws {Error} 見つからない場合
 */
function resolveBrowserPath() {
    if (process.env.AGENT_BROWSER_PATH != null && process.env.AGENT_BROWSER_PATH !== '') {
        return process.env.AGENT_BROWSER_PATH;
    }
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser'
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error(
        'Chrome/Edge が見つかりません。AGENT_BROWSER_PATH に実行ファイルパスを設定してください。'
    );
}

/**
 * CDP が応答するか確認する
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
 * 拡張用の一時プロファイルディレクトリを用意する
 *
 * @returns {string} user-data-dir パス
 */
function ensureProfileDir() {
    const dir = path.join(os.tmpdir(), 'voicetranslate-agent-extension-profile');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Chrome を拡張 + CDP で起動する
 *
 * @returns {Promise<void>}
 */
async function main() {
    const port = resolvePort();
    const extensionPath = ROOT;
    const manifestPath = path.join(extensionPath, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
        console.error('[agent:extension] manifest.json が見つかりません:', manifestPath);
        process.exit(1);
    }

    if (await isCdpReady(port)) {
        console.info(`[agent:extension] 既に CDP が http://127.0.0.1:${port} で応答中です（再利用）`);
        console.info(`[agent:extension] Playwright MCP: --cdp-endpoint=http://127.0.0.1:${port}`);
        setInterval(() => {}, 60_000);
        return;
    }

    const browserPath = resolveBrowserPath();
    const profileDir = ensureProfileDir();
    const startUrl = `file:///${path.join(ROOT, 'teams-realtime-translator.html').replace(/\\/g, '/')}`;

    const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
        startUrl
    ];

    console.info(`[agent:extension] ブラウザ: ${browserPath}`);
    console.info(`[agent:extension] 拡張: ${extensionPath}`);
    console.info(`[agent:extension] CDP: http://127.0.0.1:${port}`);
    console.info(`[agent:extension] 開始 URL: ${startUrl}`);

    const child = spawn(browserPath, args, {
        cwd: ROOT,
        stdio: 'inherit',
        windowsHide: false
    });

    child.on('error', (error) => {
        console.error('[agent:extension] 起動失敗:', error.message);
        process.exit(1);
    });

    child.on('exit', (code, signal) => {
        if (signal != null) {
            console.error(`[agent:extension] signal=${signal}`);
            process.exit(1);
        }
        process.exit(code ?? 0);
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
        if (await isCdpReady(port)) {
            console.info(`[agent:extension] CDP ready: http://127.0.0.1:${port}/json/version`);
            return;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    console.warn('[agent:extension] CDP 準備タイムアウト（ブラウザは起動継続中の可能性あり）');
}

main().catch((error) => {
    console.error('[agent:extension] 予期しないエラー:', error);
    process.exit(1);
});
