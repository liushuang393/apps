#!/usr/bin/env node
/**
 * エージェント UI 自動化ハーネスのスモークチェック。
 *
 * @description
 * - HTML エントリの存在
 * - Electron / Chrome 実行ファイルの存在
 * - Playwright MCP パッケージの解決
 * を確認し、セットアップ欠落を早期に検出する。
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * チェック結果を表示する
 *
 * @param {string} label - 項目名
 * @param {boolean} ok - 成功か
 * @param {string} detail - 詳細
 * @returns {void}
 */
function report(label, ok, detail) {
    const mark = ok ? 'OK' : 'NG';
    console.info(`[${mark}] ${label}: ${detail}`);
}

/**
 * スモークを実行する
 *
 * @returns {number} 終了コード
 */
function main() {
    let failed = 0;

    const html = path.join(ROOT, 'teams-realtime-translator.html');
    const htmlOk = fs.existsSync(html);
    report('HTML entry', htmlOk, html);
    if (!htmlOk) {
        failed += 1;
    }

    const manifest = path.join(ROOT, 'manifest.json');
    const manifestOk = fs.existsSync(manifest);
    report('Extension manifest', manifestOk, manifest);
    if (!manifestOk) {
        failed += 1;
    }

    let electronOk = false;
    let electronPath = '';
    try {
        electronPath = require('electron');
        electronOk = fs.existsSync(electronPath);
    } catch {
        electronOk = false;
    }
    report('Electron binary', electronOk, electronPath || '(not found)');
    if (!electronOk) {
        failed += 1;
    }

    const chromeCandidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const chromePath = chromeCandidates.find((p) => fs.existsSync(p)) || '';
    report('Chrome/Edge', chromePath !== '', chromePath || '(not found)');
    if (chromePath === '') {
        failed += 1;
    }

    const mcp = spawnSync('npx', ['-y', '@playwright/mcp@latest', '--version'], {
        cwd: ROOT,
        encoding: 'utf8',
        shell: true
    });
    const mcpOk = mcp.status === 0;
    report('Playwright MCP', mcpOk, (mcp.stdout || mcp.stderr || '').trim().split(/\r?\n/)[0] || '');
    if (!mcpOk) {
        failed += 1;
    }

    const scripts = [
        'scripts/agent/launch-electron-cdp.js',
        'scripts/agent/launch-extension-cdp.js',
        'scripts/agent/mcp-playwright-cdp.js'
    ];
    for (const rel of scripts) {
        const full = path.join(ROOT, rel);
        const ok = fs.existsSync(full);
        report('Script', ok, rel);
        if (!ok) {
            failed += 1;
        }
    }

    if (failed > 0) {
        console.error(`[smoke] ${failed} 件失敗`);
        return 1;
    }
    console.info('[smoke] ハーネス準備 OK');
    console.info('次の手順:');
    console.info('  1) Cursor を再起動（MCP 再読込）');
    console.info('  2) npm run agent:electron  または  npm run agent:extension');
    console.info('  3) Playwright MCP で browser_snapshot / browser_click');
    return 0;
}

process.exit(main());
