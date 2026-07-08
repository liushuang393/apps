/**
 * トランスポート決定表のテスト。
 * transport 種類の真値表と、翻訳セッション設定の形状(noise_reduction の任意付与)を検証する。
 */

const {
    selectTransportKind,
    buildTranslationSessionConfig,
    buildTransportDescriptor
} = require('../../voicetranslate-transport-config.js');

describe('selectTransportKind（transport 決定表）', () => {
    it.each([
        // [isElectron, isTranslationSession, 期待 transport 種類]
        [true, true, 'electron-ipc'],
        [true, false, 'electron-ipc'],
        [false, true, 'browser-webrtc'],
        [false, false, 'browser-ws']
    ])('isElectron=%s translation=%s → %s', (isElectron, isTranslationSession, kind) => {
        expect(selectTransportKind({ isElectron, isTranslationSession })).toBe(kind);
    });
});

describe('buildTranslationSessionConfig（設定本体）', () => {
    it('transcription/output.language を本体に集約する（noise_reduction は既定で付けない）', () => {
        const cfg = buildTranslationSessionConfig({
            targetLang: 'en',
            transcription: { model: 'gpt-realtime-whisper' }
        });
        expect(cfg.audio.input.transcription).toEqual({ model: 'gpt-realtime-whisper' });
        // 既定(session.update 経路)は noise_reduction を送らない（厳格EPの 400 回避）
        expect(cfg.audio.input.noise_reduction).toBeUndefined();
        expect(cfg.audio.output.language).toBe('en');
        expect(Object.isFrozen(cfg)).toBe(true);
    });

    it('noiseReduction を渡したとき(WebRTC 経路)のみ noise_reduction を含める', () => {
        const cfg = buildTranslationSessionConfig({
            targetLang: 'en',
            transcription: { model: 'm' },
            noiseReduction: { type: 'near_field' }
        });
        expect(cfg.audio.input.noise_reduction).toEqual({ type: 'near_field' });
    });

    it('targetLang 未指定は ja に既定化する', () => {
        const cfg = buildTranslationSessionConfig({ transcription: { model: 'm' } });
        expect(cfg.audio.output.language).toBe('ja');
    });
});

describe('buildTransportDescriptor（能力記述子）', () => {
    it.each([
        // [isElectron, isTranslationSession, kind, audioInput, playsRemoteAudioTrack, supportsGracefulClose]
        ['electron-ipc', true, true, 'electron-ipc', 'pcm-event', false, true],
        ['browser-webrtc', false, true, 'browser-webrtc', 'media-track', true, false],
        ['browser-ws(非翻訳)', false, false, 'browser-ws', 'pcm-event', false, false]
    ])(
        '%s: audioInput/再生トラック/優雅クローズを記述子へ集約する',
        (_name, isElectron, isTranslationSession, kind, audioInput, plays, graceful) => {
            const d = buildTransportDescriptor({ isElectron, isTranslationSession });
            expect(d.kind).toBe(kind);
            expect(d.audioInput).toBe(audioInput);
            expect(d.playsRemoteAudioTrack).toBe(plays);
            expect(d.supportsGracefulClose).toBe(graceful);
            expect(Object.isFrozen(d)).toBe(true);
        }
    );
});
