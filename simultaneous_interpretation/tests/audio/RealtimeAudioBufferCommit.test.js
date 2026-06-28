const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { TextPathProcessor } = require('../../voicetranslate-path-processors.js');

function loadWebSocketMixin() {
    const source = fs.readFileSync(
        path.join(__dirname, '../../voicetranslate-websocket-mixin.js'),
        'utf8'
    );

    const sandbox = {
        console,
        Buffer,
        Date,
        module: { exports: {} },
        CONFIG: {
            AUDIO: {
                SAMPLE_RATE: 24000
            }
        },
        Utils: {
            floatTo16BitPCM(audioData) {
                return new Int16Array(audioData.length).buffer;
            },
            arrayBufferToBase64(buffer) {
                return Buffer.from(buffer).toString('base64');
            }
        },
        WebSocket: {
            OPEN: 1
        }
    };

    vm.runInNewContext(`${source}\nmodule.exports = WebSocketMixin;`, sandbox);
    return sandbox.module.exports;
}

function createApp() {
    const sentMessages = [];
    const app = {
        platform: {
            isElectron: false
        },
        state: {
            isConnected: true,
            isRecording: true,
            isPlayingAudio: false,
            audioSourceType: 'microphone',
            audioContext: {
                sampleRate: 48000
            },
            ws: {
                readyState: 1,
                send(payload) {
                    sentMessages.push(JSON.parse(payload));
                }
            }
        },
        audioSourceTracker: {
            outputEndTime: null,
            bufferWindow: 2000
        },
        // usesWebRtcTransport は pro.js 側の実体。本テストは mixin のみ読み込むためスタブ化（非WebRTC=WS経路を検証）。
        usesWebRtcTransport: () => false,
        sentMessages
    };

    Object.assign(app, loadWebSocketMixin());
    return app;
}

describe('Realtime audio buffer commit guard', () => {
    it('clears instead of committing when appended audio is below Realtime minimum', () => {
        const app = createApp();

        expect(app.sendAudioData(new Float32Array(1000))).toBe(true);
        expect(app.commitRealtimeInputAudioBuffer('unit-short')).toBe(false);

        expect(app.sentMessages.map((message) => message.type)).toEqual([
            'input_audio_buffer.append',
            'input_audio_buffer.clear'
        ]);
        expect(app.getRealtimeInputAudioBufferStats().samples).toBe(0);
    });

    it('lets Path1 resend queued segment audio after recording has stopped before committing', async () => {
        const app = createApp();
        app.state.isRecording = false;

        const processor = new TextPathProcessor(null, app);
        await processor.sendAudioToServer(new Float32Array(4800));

        expect(app.sentMessages.map((message) => message.type)).toEqual([
            'input_audio_buffer.append',
            'input_audio_buffer.commit'
        ]);
        expect(app.getRealtimeInputAudioBufferStats().samples).toBe(0);
    });
});
