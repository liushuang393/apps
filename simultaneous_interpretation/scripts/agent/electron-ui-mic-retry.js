#!/usr/bin/env node
/**
 * マイク再試験 + TTS 状態確認（短時間）
 *
 * @description
 * Electron CDP に接続し、プレースホルダ以外の認識結果と
 * playbackQueue / isPlayingAudio を証拠収集する。
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const WebSocket = require('ws');

const OUT = path.join(__dirname, '..', '..', 'tmp', 'agent-ui-e2e', '05-mic-retry.json');
const WAIT_MS = 60000;

/**
 * @param {string} url
 * @returns {Promise<unknown>}
 */
function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        http
            .get(url, (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (c) => {
                    body += c;
                });
                res.on('end', () => resolve(JSON.parse(body)));
            })
            .on('error', reject);
    });
}

class CdpSession {
    /**
     * @param {string} wsUrl
     */
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.nextId = 1;
        this.pending = new Map();
        this.consoleLogs = [];
    }

    async open() {
        this.ws = new WebSocket(this.wsUrl);
        await new Promise((resolve, reject) => {
            this.ws.once('open', resolve);
            this.ws.once('error', reject);
        });
        this.ws.on('message', (data) => {
            const msg = JSON.parse(String(data));
            if (msg.id != null && this.pending.has(msg.id)) {
                const p = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
                else p.resolve(msg.result);
                return;
            }
            if (msg.method === 'Runtime.consoleAPICalled') {
                const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '');
                this.consoleLogs.push(`[${msg.params.type}] ${args.join(' ')}`);
            }
        });
        await this.send('Runtime.enable');
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text || 'evaluate failed');
        }
        return result.result?.value;
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

/**
 * @param {number} ms
 */
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * プレースホルダを除いたトランスクリプト本文
 *
 * @param {string} text
 * @returns {string}
 */
function realTranscript(text) {
    const t = String(text || '')
        .replace(/録音を開始すると[^\n]*/g, '')
        .replace(/翻訳結果がここに表示されます/g, '')
        .replace(/[🎤🌐]/g, '')
        .trim();
    return t;
}

async function main() {
    const list = await httpGetJson('http://127.0.0.1:9222/json/list');
    const page = list.find((t) => t.type === 'page' && String(t.url).includes('teams-realtime-translator'));
    if (!page) throw new Error('page not found');
    const cdp = new CdpSession(page.webSocketDebuggerUrl);
    await cdp.open();

    try {
        await cdp.evaluate(`(() => {
            const stop = document.querySelector('#stopBtn');
            if (stop && !stop.disabled) stop.click();
            return true;
        })()`);
        await sleep(1500);

        await cdp.evaluate(`(() => {
            const sel = document.querySelector('#audioSourceType');
            if (sel) {
                sel.value = 'microphone';
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const input = document.querySelector('#inputTranscript');
            const output = document.querySelector('#outputTranscript');
            if (input) input.innerHTML = '<div class="empty-state">🎤<p>録音を開始すると、ここに音声認識結果が表示されます</p></div>';
            if (output) output.innerHTML = '<div class="empty-state">🌐<p>翻訳結果がここに表示されます</p></div>';
            return true;
        })()`);
        await sleep(500);

        await cdp.evaluate(`(() => {
            document.querySelector('#startBtn')?.click();
            return true;
        })()`);
        await sleep(4000);

        await cdp.evaluate(`(() => {
            const app = window.app;
            if (app?.showNotification) {
                app.showNotification('マイク試験', '今すぐマイクに向かって2〜3文話してください', 'info');
            }
            return true;
        })()`);
        process.stderr.write('[mic-retry] Speak into the microphone NOW (60s window)...\n');

        const polls = [];
        const deadline = Date.now() + WAIT_MS;
        let gotSpeech = false;
        while (Date.now() < deadline) {
            await sleep(4000);
            const snap = await cdp.evaluate(`(() => {
                const app = window.app;
                const input = document.querySelector('#inputTranscript')?.innerText || '';
                const output = document.querySelector('#outputTranscript')?.innerText || '';
                return {
                    input,
                    output,
                    isConnected: app?.state?.isConnected,
                    isRecording: app?.state?.isRecording,
                    audioOutputMode: app?.state?.audioOutputMode,
                    isPlayingAudio: app?.isPlayingAudio,
                    isPlayingFromQueue: app?.isPlayingFromQueue,
                    playbackQueueLen: Array.isArray(app?.playbackQueue) ? app.playbackQueue.length : null,
                    audioQueueLen: app?.audioQueue?.queue?.length ?? app?.audioQueue?.length ?? null,
                    connectionText: document.querySelector('#connectionText')?.textContent || '',
                    notification: document.querySelector('#notificationMessage')?.textContent || '',
                };
            })()`);
            const inReal = realTranscript(snap.input);
            const outReal = realTranscript(snap.output);
            polls.push({
                at: new Date().toISOString(),
                inRealLen: inReal.length,
                outRealLen: outReal.length,
                inReal: inReal.slice(0, 200),
                outReal: outReal.slice(0, 200),
                isPlayingAudio: snap.isPlayingAudio,
                isPlayingFromQueue: snap.isPlayingFromQueue,
                playbackQueueLen: snap.playbackQueueLen,
                audioQueueLen: snap.audioQueueLen,
                connectionText: snap.connectionText,
                isRecording: snap.isRecording,
            });
            if (inReal.length > 8) {
                gotSpeech = true;
                // TTS 証拠をもう少し待つ
                await sleep(8000);
                const tts = await cdp.evaluate(`(() => {
                    const app = window.app;
                    return {
                        isPlayingAudio: app?.isPlayingAudio,
                        isPlayingFromQueue: app?.isPlayingFromQueue,
                        playbackQueueLen: Array.isArray(app?.playbackQueue) ? app.playbackQueue.length : null,
                        audioOutputMode: app?.state?.audioOutputMode,
                        input: document.querySelector('#inputTranscript')?.innerText || '',
                        output: document.querySelector('#outputTranscript')?.innerText || '',
                    };
                })()`);
                polls.push({ at: new Date().toISOString(), phase: 'post-speech-tts', ...tts });
                break;
            }
        }

        // TTS OFF 差分
        await cdp.evaluate(`(() => {
            const header = document.querySelector('#advancedSettingsHeader');
            const content = document.querySelector('#advancedSettingsContent');
            if (content?.classList.contains('collapsed')) header?.click();
            return true;
        })()`);
        await sleep(300);
        const beforeTts = await cdp.evaluate(`(() => ({
            active: document.querySelector('#audioOutputMode')?.classList.contains('active'),
            mode: window.app?.state?.audioOutputMode,
        }))()`);
        await cdp.evaluate(`(() => { document.querySelector('#audioOutputMode')?.click(); return true; })()`);
        await sleep(500);
        const afterTtsOff = await cdp.evaluate(`(() => ({
            active: document.querySelector('#audioOutputMode')?.classList.contains('active'),
            mode: window.app?.state?.audioOutputMode,
        }))()`);
        await cdp.evaluate(`(() => { document.querySelector('#audioOutputMode')?.click(); return true; })()`);
        await sleep(300);
        const afterTtsOn = await cdp.evaluate(`(() => ({
            active: document.querySelector('#audioOutputMode')?.classList.contains('active'),
            mode: window.app?.state?.audioOutputMode,
        }))()`);

        await cdp.evaluate(`(() => { document.querySelector('#stopBtn')?.click(); return true; })()`);

        const finalIn = realTranscript(polls[polls.length - 1]?.inReal || polls[polls.length - 1]?.input || '');
        const report = {
            gotSpeech,
            polls,
            ttsToggle: { beforeTts, afterTtsOff, afterTtsOn },
            consoleTail: cdp.consoleLogs.slice(-50),
            verdict: {
                asrOk: gotSpeech,
                translationOk: polls.some((p) => (p.outRealLen || 0) > 4 || realTranscript(p.output || p.outReal || '').length > 4),
                ttsToggleWorks: afterTtsOff.mode === 'off' && afterTtsOn.mode === 'translation',
                sawPlayback:
                    polls.some((p) => p.isPlayingAudio || p.isPlayingFromQueue || (p.playbackQueueLen || 0) > 0),
            },
        };
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
        process.stdout.write(JSON.stringify(report.verdict, null, 2) + '\n');
        process.stdout.write('gotSpeech=' + gotSpeech + '\n');
        if (gotSpeech) {
            const last = polls.filter((p) => (p.inRealLen || 0) > 0).pop();
            process.stdout.write('sampleIN=' + JSON.stringify(last?.inReal) + '\n');
            process.stdout.write('sampleOUT=' + JSON.stringify(last?.outReal) + '\n');
        }
    } finally {
        cdp.close();
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
