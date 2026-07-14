#!/usr/bin/env node
/**
 * システム音声モード中の TTS / 翻訳状態プローブ
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const WebSocket = require('ws');

const OUT = path.join(__dirname, '..', '..', 'tmp', 'agent-ui-e2e', '06-system-tts.json');

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

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
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

async function main() {
    const list = await httpGetJson('http://127.0.0.1:9222/json/list');
    const page = list.find(
        (t) => t.type === 'page' && String(t.url).includes('teams-realtime-translator')
    );
    if (!page) throw new Error('page not found');
    const cdp = new CdpSession(page.webSocketDebuggerUrl);
    await cdp.open();

    try {
        await cdp.evaluate(`document.querySelector('#stopBtn')?.click()`);
        await sleep(1500);
        await cdp.evaluate(`(() => {
            const s = document.querySelector('#audioSourceType');
            if (s) {
                s.value = 'system';
                s.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        })()`);
        await sleep(500);
        await cdp.evaluate(`document.querySelector('#startBtn')?.click()`);
        await sleep(8000);

        const samples = [];
        for (let i = 0; i < 8; i++) {
            await sleep(3000);
            const snap = await cdp.evaluate(`(() => {
                const a = window.app;
                const inputEl = document.querySelector('#inputTranscript');
                const outputEl = document.querySelector('#outputTranscript');
                return {
                    in: inputEl ? inputEl.innerText : '',
                    out: outputEl ? outputEl.innerText : '',
                    isPlayingAudio: a && a.isPlayingAudio,
                    isPlayingFromQueue: a && a.isPlayingFromQueue,
                    playbackQueueLen: Array.isArray(a && a.playbackQueue) ? a.playbackQueue.length : null,
                    audioOutputMode: a && a.state ? a.state.audioOutputMode : null,
                    suppressTts: a && a.captureProfile ? a.captureProfile.suppressTts : null,
                    duplex: a && a.captureProfile ? a.captureProfile.duplexPolicy : null,
                    inputMode: a && a.captureProfile ? a.captureProfile.inputMode : null,
                    connected: a && a.state ? a.state.isConnected : null,
                    recording: a && a.state ? a.state.isRecording : null,
                    audioOutputClass: document.querySelector('#audioOutputMode')
                        ? document.querySelector('#audioOutputMode').classList.contains('active')
                        : null,
                    notification: document.querySelector('#notificationMessage')
                        ? document.querySelector('#notificationMessage').textContent
                        : null,
                };
            })()`);
            samples.push(snap);
        }

        await cdp.evaluate(`(() => {
            const c = document.querySelector('#advancedSettingsContent');
            if (c && c.classList.contains('collapsed')) {
                document.querySelector('#advancedSettingsHeader')?.click();
            }
            return true;
        })()`);
        await sleep(300);
        await cdp.evaluate(`document.querySelector('#audioOutputMode')?.click()`);
        await sleep(1500);
        const ttsOff = await cdp.evaluate(`(() => {
            const a = window.app;
            return {
                mode: a && a.state ? a.state.audioOutputMode : null,
                active: document.querySelector('#audioOutputMode')
                    ? document.querySelector('#audioOutputMode').classList.contains('active')
                    : null,
                isPlayingAudio: a && a.isPlayingAudio,
                out: document.querySelector('#outputTranscript')
                    ? document.querySelector('#outputTranscript').innerText
                    : '',
            };
        })()`);
        await cdp.evaluate(`document.querySelector('#audioOutputMode')?.click()`);
        await sleep(800);
        const ttsOn = await cdp.evaluate(`(() => {
            const a = window.app;
            return {
                mode: a && a.state ? a.state.audioOutputMode : null,
                active: document.querySelector('#audioOutputMode')
                    ? document.querySelector('#audioOutputMode').classList.contains('active')
                    : null,
            };
        })()`);

        await cdp.evaluate(`document.querySelector('#stopBtn')?.click()`);

        const last = samples[samples.length - 1] || {};
        const report = {
            samples,
            ttsOff,
            ttsOn,
            sawPlayback: samples.some(
                (s) => s.isPlayingAudio || s.isPlayingFromQueue || (s.playbackQueueLen || 0) > 0
            ),
            suppressTtsSeen: samples.some((s) => s.suppressTts === true),
            lastIn: String(last.in || '').slice(0, 400),
            lastOut: String(last.out || '').slice(0, 400),
        };
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
        process.stdout.write(
            JSON.stringify(
                {
                    sawPlayback: report.sawPlayback,
                    suppressTtsSeen: report.suppressTtsSeen,
                    ttsOffMode: ttsOff.mode,
                    ttsOnMode: ttsOn.mode,
                    lastInLen: String(last.in || '').length,
                    lastOutLen: String(last.out || '').length,
                    duplex: last.duplex,
                    inputMode: last.inputMode,
                    notification: last.notification,
                },
                null,
                2
            ) + '\n'
        );
    } finally {
        cdp.close();
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
