#!/usr/bin/env node
/**
 * Electron CDP 実機 UI プローブ（Playwright MCP が CDP 未接続時のフォールバック）
 *
 * @description
 * http://127.0.0.1:9222 の Electron に WebSocket CDP で接続し、
 * マイク / システム音声 / 設定トグルを操作して証拠 JSON を出力する。
 *
 * 使い方:
 *   node scripts/agent/electron-ui-e2e-probe.js
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const WebSocket = require('ws');

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9222;
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'tmp', 'agent-ui-e2e');
const SPEECH_WAIT_MS = 45000;
const SYSTEM_AUDIO_WAIT_MS = 50000;

/**
 * HTTP GET JSON
 *
 * @param {string} url - 取得 URL
 * @returns {Promise<unknown>}
 */
function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        http
            .get(url, (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (error) {
                        reject(error);
                    }
                });
            })
            .on('error', reject);
    });
}

/**
 * CDP セッション
 */
class CdpSession {
    /**
     * @param {string} wsUrl - page WebSocket URL
     */
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        /** @type {import('ws')|null} */
        this.ws = null;
        this.nextId = 1;
        /** @type {Map<number, {resolve: Function, reject: Function}>} */
        this.pending = new Map();
        /** @type {string[]} */
        this.consoleLogs = [];
    }

    /**
     * 接続を開く
     *
     * @returns {Promise<void>}
     */
    async open() {
        this.ws = new WebSocket(this.wsUrl);
        await new Promise((resolve, reject) => {
            this.ws.once('open', resolve);
            this.ws.once('error', reject);
        });
        this.ws.on('message', (data) => {
            const msg = JSON.parse(String(data));
            if (msg.id != null && this.pending.has(msg.id)) {
                const entry = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error != null) {
                    entry.reject(new Error(JSON.stringify(msg.error)));
                } else {
                    entry.resolve(msg.result);
                }
                return;
            }
            if (msg.method === 'Runtime.consoleAPICalled') {
                const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '');
                const line = `[${msg.params.type}] ${args.join(' ')}`;
                this.consoleLogs.push(line);
                if (this.consoleLogs.length > 400) {
                    this.consoleLogs.shift();
                }
            }
            if (msg.method === 'Runtime.exceptionThrown') {
                const text = msg.params.exceptionDetails?.text || 'exception';
                this.consoleLogs.push(`[exception] ${text}`);
            }
        });
        await this.send('Runtime.enable');
        await this.send('Console.enable').catch(() => undefined);
        await this.send('Page.enable').catch(() => undefined);
        await this.send('DOM.enable').catch(() => undefined);
    }

    /**
     * CDP コマンド送信
     *
     * @param {string} method - メソッド名
     * @param {Record<string, unknown>} [params] - パラメータ
     * @returns {Promise<unknown>}
     */
    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    /**
     * ページ内 JS を実行して値を返す
     *
     * @param {string} expression - 式
     * @returns {Promise<unknown>}
     */
    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (result.exceptionDetails != null) {
            throw new Error(
                result.exceptionDetails.text ||
                    result.exceptionDetails.exception?.description ||
                    'evaluate failed'
            );
        }
        return result.result?.value;
    }

    /**
     * 要素クリック（CSS セレクタ）
     *
     * @param {string} selector - CSS セレクタ
     * @returns {Promise<boolean>}
     */
    async click(selector) {
        return Boolean(
            await this.evaluate(`(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return false;
                el.scrollIntoView({ block: 'center' });
                el.click();
                return true;
            })()`)
        );
    }

    /**
     * select の値を変更して change を発火
     *
     * @param {string} selector - CSS セレクタ
     * @param {string} value - 値
     * @returns {Promise<boolean>}
     */
    async selectValue(selector, value) {
        return Boolean(
            await this.evaluate(`(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return false;
                el.value = ${JSON.stringify(value)};
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            })()`)
        );
    }

    /**
     * トグルスイッチをクリック
     *
     * @param {string} selector - CSS セレクタ
     * @returns {Promise<boolean>}
     */
    async toggle(selector) {
        return this.click(selector);
    }

    /**
     * 接続を閉じる
     *
     * @returns {void}
     */
    close() {
        if (this.ws != null) {
            this.ws.close();
            this.ws = null;
        }
    }
}

/**
 * 指定ミリ秒待つ
 *
 * @param {number} ms - 待機時間
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * UI 状態スナップショットを取得
 *
 * @param {CdpSession} cdp - セッション
 * @returns {Promise<Record<string, unknown>>}
 */
async function captureUiState(cdp) {
    return cdp.evaluate(`(() => {
        const textOf = (sel) => {
            const el = document.querySelector(sel);
            return el ? (el.innerText || el.textContent || '').trim() : null;
        };
        const valOf = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.value : null;
        };
        const hasClass = (sel, cls) => {
            const el = document.querySelector(sel);
            return el ? el.classList.contains(cls) : null;
        };
        const disabled = (sel) => {
            const el = document.querySelector(sel);
            return el ? Boolean(el.disabled) : null;
        };
        const display = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            return window.getComputedStyle(el).display;
        };
        const app = window.app || window.voiceTranslatePro || null;
        const state = app && app.state ? {
            isConnected: app.state.isConnected,
            isRecording: app.state.isRecording,
            audioSourceType: app.state.audioSourceType,
            sourceLang: app.state.sourceLang,
            targetLang: app.state.targetLang,
            vadEnabled: app.state.vadEnabled,
            audioOutputMode: app.state.audioOutputMode,
            showInputTranscript: app.state.showInputTranscript,
            showOutputTranscript: app.state.showOutputTranscript,
        } : null;
        const captureProfile = app && app.captureProfile ? {
            platform: app.captureProfile.platform,
            inputMode: app.captureProfile.inputMode,
            duplexPolicy: app.captureProfile.duplexPolicy,
            suppressTts: app.captureProfile.suppressTts,
            vadPreset: app.captureProfile.vadPreset,
        } : null;
        const apiKeyLen = (document.querySelector('#apiKey')?.value || '').length;
        return {
            connectionText: textOf('#connectionText'),
            connectionOnline: hasClass('#connectionStatus', 'online') || hasClass('#connectionStatus', 'connected'),
            audioSourceType: valOf('#audioSourceType'),
            sourceLang: valOf('#sourceLang'),
            targetLang: valOf('#targetLang'),
            sourceLangDisplay: textOf('#sourceLangDisplay'),
            targetLangDisplay: textOf('#targetLangDisplay'),
            inputTranscript: textOf('#inputTranscript'),
            outputTranscript: textOf('#outputTranscript'),
            systemAudioGroupDisplay: display('#systemAudioSourceGroup'),
            vadEnabledActive: hasClass('#vadEnabled', 'active'),
            showInputActive: hasClass('#showInputTranscript', 'active'),
            showOutputActive: hasClass('#showOutputTranscript', 'active'),
            audioOutputActive: hasClass('#audioOutputMode', 'active'),
            vadSensitivityDisabled: disabled('#vadSensitivity'),
            vadSensitivity: valOf('#vadSensitivity'),
            startDisabled: disabled('#startBtn'),
            stopDisabled: disabled('#stopBtn'),
            deviceBadge: textOf('#deviceBadge'),
            notification: textOf('#notificationMessage'),
            apiKeyLen,
            state,
            captureProfile,
            appKeys: app ? Object.keys(app).slice(0, 40) : [],
        };
    })()`);
}

/**
 * コンソールからキーワードを抽出
 *
 * @param {string[]} logs - ログ行
 * @param {RegExp[]} patterns - パターン
 * @returns {string[]}
 */
function filterLogs(logs, patterns) {
    return logs.filter((line) => patterns.some((re) => re.test(line))).slice(-80);
}

/**
 * メイン
 *
 * @returns {Promise<void>}
 */
async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const report = {
        startedAt: new Date().toISOString(),
        phases: {},
        errors: [],
        consoleHits: {},
    };

    const list = await httpGetJson(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
    const page = (Array.isArray(list) ? list : []).find(
        (t) => t.type === 'page' && String(t.url || '').includes('teams-realtime-translator')
    );
    if (page == null) {
        throw new Error('Electron page target not found on CDP 9222');
    }

    const cdp = new CdpSession(page.webSocketDebuggerUrl);
    await cdp.open();

    try {
        // --- baseline ---
        let ui = await captureUiState(cdp);
        report.phases.baseline = { ui, consoleSample: cdp.consoleLogs.slice(-20) };
        fs.writeFileSync(
            path.join(OUT_DIR, '01-baseline.json'),
            JSON.stringify(report.phases.baseline, null, 2),
            'utf8'
        );

        // 詳細設定パネルを開く
        await cdp.evaluate(`(() => {
            const header = document.querySelector('#advancedSettingsHeader');
            const content = document.querySelector('#advancedSettingsContent');
            if (header && content && content.classList.contains('collapsed')) {
                header.click();
            }
            const langHeader = document.querySelector('#languageSettingsHeader');
            const langContent = document.querySelector('#languageSettingsContent');
            if (langHeader && langContent && langContent.classList.contains('collapsed')) {
                langHeader.click();
            }
            return true;
        })()`);
        await sleep(500);

        // --- mic mode ---
        await cdp.selectValue('#audioSourceType', 'microphone');
        await sleep(800);
        const micSelected = await captureUiState(cdp);
        await cdp.evaluate(`(() => {
            const input = document.querySelector('#inputTranscript');
            const output = document.querySelector('#outputTranscript');
            if (input) input.innerHTML = '';
            if (output) output.innerHTML = '';
            return true;
        })()`);
        const startedMic = await cdp.click('#startBtn');
        await sleep(5000);
        const micAfterStart = await captureUiState(cdp);
        await cdp.evaluate(`(() => {
            const app = window.app || window.voiceTranslatePro;
            if (app && typeof app.showNotification === 'function') {
                app.showNotification('テスト', 'マイクに向かって日本語か英語で数秒話してください', 'info');
            } else {
                const t = document.querySelector('#notificationTitle');
                const m = document.querySelector('#notificationMessage');
                const n = document.querySelector('#notification');
                if (t) t.textContent = 'テスト';
                if (m) m.textContent = 'マイクに向かって日本語か英語で数秒話してください';
                if (n) n.classList.add('show');
            }
            return true;
        })()`);
        report.phases.mic = {
            selected: micSelected,
            startedMic,
            afterStart: micAfterStart,
            note: `Waiting ${SPEECH_WAIT_MS}ms for speech recognition samples`,
        };

        // 発話待ち（ユーザー or 環境音）。認識が増えるかポーリング
        process.stderr.write(
            '[probe] MIC: Please speak into the microphone for several seconds now...\n'
        );
        const micPoll = [];
        const micDeadline = Date.now() + SPEECH_WAIT_MS;
        while (Date.now() < micDeadline) {
            await sleep(5000);
            const snap = await captureUiState(cdp);
            micPoll.push({
                at: new Date().toISOString(),
                inputLen: (snap.inputTranscript || '').length,
                outputLen: (snap.outputTranscript || '').length,
                connectionText: snap.connectionText,
                isRecording: snap.state?.isRecording,
                isConnected: snap.state?.isConnected,
            });
            if ((snap.inputTranscript || '').length > 20 && (snap.outputTranscript || '').length > 5) {
                break;
            }
        }
        const micFinal = await captureUiState(cdp);
        report.phases.mic.poll = micPoll;
        report.phases.mic.final = micFinal;
        report.phases.mic.consoleHits = filterLogs(cdp.consoleLogs, [
            /error/i,
            /audio/i,
            /transcript/i,
            /response\./i,
            /conversation_already_has_active_response/i,
            /TTS|playback|delta/i,
            /マイク|mic|録音|recording/i,
            /Permission|denied/i,
        ]);
        fs.writeFileSync(path.join(OUT_DIR, '02-mic.json'), JSON.stringify(report.phases.mic, null, 2), 'utf8');

        await cdp.click('#stopBtn');
        await sleep(2000);

        // --- system / browser TV mode ---
        // 刺激用: 別プロセスで短いローカル HTML 音声を再生（システム音）は OS 依存のため、
        // ここではシステムソース切替＋開始後のキャプチャ状態／ログを主証拠にする。
        // 可能なら既定ブラウザで無音でないページを開く。
        try {
            const { spawn } = require('node:child_process');
            // 英語ニュース系の公開ページ（音声付きとは限らないがブラウザ起動刺激）
            spawn('cmd', ['/c', 'start', '', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'], {
                detached: true,
                stdio: 'ignore',
            }).unref();
        } catch (error) {
            report.errors.push(`browser stimulus failed: ${error.message}`);
        }

        await cdp.selectValue('#audioSourceType', 'system');
        await sleep(1000);
        const sysSelected = await captureUiState(cdp);
        const startedSys = await cdp.click('#startBtn');
        await sleep(6000);
        const sysAfterStart = await captureUiState(cdp);

        const sysPoll = [];
        const sysDeadline = Date.now() + SYSTEM_AUDIO_WAIT_MS;
        while (Date.now() < sysDeadline) {
            await sleep(5000);
            const snap = await captureUiState(cdp);
            sysPoll.push({
                at: new Date().toISOString(),
                inputLen: (snap.inputTranscript || '').length,
                outputLen: (snap.outputTranscript || '').length,
                connectionText: snap.connectionText,
                isRecording: snap.state?.isRecording,
                isConnected: snap.state?.isConnected,
                captureProfile: snap.captureProfile,
                deviceBadge: snap.deviceBadge,
            });
            if ((snap.inputTranscript || '').length > 40 && (snap.outputTranscript || '').length > 10) {
                break;
            }
        }
        const sysFinal = await captureUiState(cdp);
        report.phases.system = {
            selected: sysSelected,
            startedSys,
            afterStart: sysAfterStart,
            poll: sysPoll,
            final: sysFinal,
            consoleHits: filterLogs(cdp.consoleLogs, [
                /error/i,
                /system|loopback|desktop|virtual|capture/i,
                /conversation_already_has_active_response/i,
                /transcript|response\.|audio\.delta/i,
                /Permission|denied/i,
            ]),
        };
        fs.writeFileSync(
            path.join(OUT_DIR, '03-system.json'),
            JSON.stringify(report.phases.system, null, 2),
            'utf8'
        );

        // --- settings while system session possibly still running ---
        const settings = {};

        // 言語変更
        await cdp.selectValue('#targetLang', 'en');
        await sleep(800);
        settings.targetLangEn = await captureUiState(cdp);
        await cdp.selectValue('#targetLang', 'ja');
        await sleep(800);
        settings.targetLangJa = await captureUiState(cdp);

        // 表示トグル
        const beforeShow = await captureUiState(cdp);
        await cdp.toggle('#showInputTranscript');
        await sleep(500);
        settings.showInputToggled = await captureUiState(cdp);
        await cdp.toggle('#showInputTranscript');
        await sleep(300);
        await cdp.toggle('#showOutputTranscript');
        await sleep(500);
        settings.showOutputToggled = await captureUiState(cdp);
        await cdp.toggle('#showOutputTranscript');
        await sleep(300);

        // TTS トグル
        await cdp.toggle('#audioOutputMode');
        await sleep(800);
        settings.ttsOff = await captureUiState(cdp);
        await cdp.toggle('#audioOutputMode');
        await sleep(500);
        settings.ttsOn = await captureUiState(cdp);

        // VAD トグル → 感度有効化
        await cdp.toggle('#vadEnabled');
        await sleep(800);
        settings.vadOff = await captureUiState(cdp);
        await cdp.selectValue('#vadSensitivity', 'high');
        await sleep(500);
        settings.vadSensitivityHigh = await captureUiState(cdp);
        await cdp.toggle('#vadEnabled');
        await sleep(500);
        settings.vadOn = await captureUiState(cdp);

        // ソース切替 UI
        await cdp.selectValue('#audioSourceType', 'microphone');
        await sleep(800);
        settings.sourceMic = await captureUiState(cdp);
        await cdp.selectValue('#audioSourceType', 'system');
        await sleep(800);
        settings.sourceSystem = await captureUiState(cdp);

        report.phases.settings = {
            beforeShow,
            ...settings,
        };
        fs.writeFileSync(
            path.join(OUT_DIR, '04-settings.json'),
            JSON.stringify(report.phases.settings, null, 2),
            'utf8'
        );

        await cdp.click('#stopBtn');
        await sleep(1500);

        // 判定サマリ
        const micIn = (report.phases.mic.final?.inputTranscript || '').length;
        const micOut = (report.phases.mic.final?.outputTranscript || '').length;
        const sysIn = (report.phases.system.final?.inputTranscript || '').length;
        const sysOut = (report.phases.system.final?.outputTranscript || '').length;
        const hasActiveResponseErr = cdp.consoleLogs.some((l) =>
            /conversation_already_has_active_response/i.test(l)
        );

        report.summary = {
            apiKeyPresent: (report.phases.baseline.ui?.apiKeyLen || 0) > 0,
            mic: {
                started: Boolean(report.phases.mic.afterStart?.state?.isRecording || report.phases.mic.afterStart?.state?.isConnected),
                connected: Boolean(report.phases.mic.final?.state?.isConnected),
                inputTranscriptChars: micIn,
                outputTranscriptChars: micOut,
                asrOk: micIn > 5,
                translationOk: micOut > 2,
            },
            system: {
                started: Boolean(report.phases.system.afterStart?.state?.isRecording || report.phases.system.afterStart?.state?.isConnected),
                connected: Boolean(report.phases.system.final?.state?.isConnected),
                inputTranscriptChars: sysIn,
                outputTranscriptChars: sysOut,
                asrOk: sysIn > 5,
                translationOk: sysOut > 2,
                systemGroupVisible: report.phases.system.selected?.systemAudioGroupDisplay !== 'none',
            },
            settings: {
                targetLangChanges: settings.targetLangEn?.targetLang === 'en' && settings.targetLangJa?.targetLang === 'ja',
                showInputToggleWorks:
                    beforeShow.showInputActive !== settings.showInputToggled.showInputActive,
                showOutputToggleWorks:
                    beforeShow.showOutputActive !== settings.showOutputToggled.showOutputActive,
                ttsToggleWorks: settings.ttsOff?.audioOutputActive === false && settings.ttsOn?.audioOutputActive === true,
                vadOffEnablesSensitivity: settings.vadOff?.vadSensitivityDisabled === false,
                vadOnDisablesSensitivity: settings.vadOn?.vadSensitivityDisabled === true,
                sourceSwitchShowsSystemGroup:
                    settings.sourceSystem?.systemAudioGroupDisplay !== 'none' &&
                    settings.sourceMic?.systemAudioGroupDisplay === 'none',
            },
            conversationAlreadyHasActiveResponse: hasActiveResponseErr,
            consoleErrorCount: cdp.consoleLogs.filter((l) => /\[error\]|exception/i.test(l)).length,
        };

        report.finishedAt = new Date().toISOString();
        report.consoleTail = cdp.consoleLogs.slice(-100);
        const outPath = path.join(OUT_DIR, 'report.json');
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
        process.stdout.write(`${pathToFileURL(outPath).href}\n`);
        process.stdout.write(JSON.stringify(report.summary, null, 2) + '\n');
    } finally {
        cdp.close();
    }
}

main().catch((error) => {
    console.error('[electron-ui-e2e-probe] FAILED', error);
    process.exitCode = 1;
});
