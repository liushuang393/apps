#!/usr/bin/env node
/**
 * Playwright MCP を CDP 接続または通常ブラウザ起動で開始するラッパー。
 *
 * @description
 * AGENT_CDP_ENDPOINT が応答すればその CDP に接続し、
 * 応答しなければ通常の Playwright ブラウザを起動する。
 * Electron / 拡張セッションを落とさずに MCP を常時有効にできる。
 *
 * 環境変数:
 *   AGENT_CDP_ENDPOINT  - 例: http://127.0.0.1:9222
 *   AGENT_MCP_CAPS      - 例: vision,devtools（任意）
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * CDP エンドポイントが応答するか確認する
 *
 * @param {string} endpoint - 例 http://127.0.0.1:9222
 * @returns {Promise<boolean>} 応答すれば true
 */
function isCdpReady(endpoint) {
    return new Promise((resolve) => {
        try {
            const url = new URL('/json/version', endpoint);
            const req = http.get(url, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(500, () => {
                req.destroy();
                resolve(false);
            });
        } catch {
            resolve(false);
        }
    });
}

/**
 * Playwright MCP を起動する
 *
 * @returns {Promise<void>}
 */
async function main() {
    const endpoint = process.env.AGENT_CDP_ENDPOINT || '';
    const caps = process.env.AGENT_MCP_CAPS || 'vision,devtools';
    const extraArgs = process.argv.slice(2);

    const args = [
        '-y',
        '@playwright/mcp@latest',
        '--allow-unrestricted-file-access',
        `--caps=${caps}`,
        ...extraArgs
    ];

    if (endpoint !== '') {
        const ready = await isCdpReady(endpoint);
        if (ready) {
            args.push(`--cdp-endpoint=${endpoint}`);
            console.error(`[mcp-cdp] CDP 接続: ${endpoint}`);
        } else {
            console.error(
                `[mcp-cdp] CDP 未応答 (${endpoint}) — 通常ブラウザで起動。先に npm run agent:electron / agent:extension を実行してください。`
            );
        }
    } else {
        console.error('[mcp-cdp] AGENT_CDP_ENDPOINT 未設定 — 通常 Playwright ブラウザで起動');
    }

    const child = spawn('npx', args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: process.env
    });

    child.on('exit', (code) => {
        process.exit(code ?? 0);
    });
}

main().catch((error) => {
    console.error('[mcp-cdp] 予期しないエラー:', error);
    process.exit(1);
});
