/**
 * キャプチャプロファイル決定表のテスト。
 *
 * 決定表そのものが仕様: (isElectron, audioSourceType, fallbackStage, outputIsolated,
 * realtimeSession) の全組合せが期待行に解決されること、および半二重ゲート
 * shouldSkipCapture がプロファイルのみで判定される（D1回帰）ことを検証する。
 * realtimeSession 未指定の既存ケースは非通訳セッション（チャット等）の仕様を兼ねる。
 */

const {
    CAPTURE_PROFILE_IDS,
    deriveCaptureProfileId,
    buildCaptureProfile,
    shouldSkipCapture,
    captureEntryFor
} = require('../../voicetranslate-capture-profile.js');

describe('deriveCaptureProfileId / buildCaptureProfile（決定表）', () => {
    it.each([
        // [isElectron, audioSourceType, fallbackStage, outputIsolated, 期待profileId, duplex, vadPreset, ttsPolicy, silenceFallbackNext]
        [
            true,
            'microphone',
            null,
            true,
            'electron-mic',
            'mic-protected',
            'MICROPHONE',
            'play',
            null
        ],
        [
            true,
            'system',
            'virtual-card',
            true,
            'electron-virtual-card',
            'full',
            'MICROPHONE',
            'play',
            'loopback'
        ],
        [
            true,
            'system',
            'virtual-card',
            false,
            'electron-virtual-card',
            'full',
            'MICROPHONE',
            'suppress',
            'loopback'
        ],
        [
            true,
            'system',
            'loopback',
            true,
            'electron-loopback',
            'full',
            'SYSTEM',
            'suppress',
            'microphone'
        ],
        [
            true,
            'system',
            'microphone',
            true,
            'electron-mic-fallback',
            'mic-protected',
            'MICROPHONE',
            'play',
            null
        ],
        [
            false,
            'microphone',
            null,
            false,
            'browser-mic',
            'mic-protected',
            'MICROPHONE',
            'play',
            null
        ],
        [false, 'system', null, false, 'browser-tab', 'full', 'SYSTEM', 'play', null]
    ])(
        'isElectron=%s source=%s stage=%s isolated=%s → %s',
        (
            isElectron,
            audioSourceType,
            fallbackStage,
            outputIsolated,
            id,
            duplex,
            vadPreset,
            ttsPolicy,
            next
        ) => {
            const profile = buildCaptureProfile({
                isElectron,
                audioSourceType,
                fallbackStage,
                outputIsolated
            });
            expect(profile.profileId).toBe(id);
            expect(profile.duplex).toBe(duplex);
            expect(profile.vadPreset).toBe(vadPreset);
            expect(profile.ttsPolicy).toBe(ttsPolicy);
            expect(profile.silenceFallbackNext).toBe(next);
            expect(Object.isFrozen(profile)).toBe(true);
        }
    );

    it.each([
        // [説明, isElectron, audioSourceType, fallbackStage, outputIsolated, 期待duplex]
        ['electron-mic は通訳セッションで全二重', true, 'microphone', null, false, 'full'],
        ['browser-mic は通訳セッションで全二重', false, 'microphone', null, false, 'full'],
        [
            'mic-fallback は通訳セッションで全二重（PCマイク監視の文落ち防止）',
            true,
            'system',
            'microphone',
            true,
            'full'
        ],
        [
            'mic-fallback は出力未隔離でも通訳セッションなら全二重',
            true,
            'system',
            'microphone',
            false,
            'full'
        ]
    ])('%s', (_desc, isElectron, audioSourceType, fallbackStage, outputIsolated, duplex) => {
        const profile = buildCaptureProfile({
            isElectron,
            audioSourceType,
            fallbackStage,
            outputIsolated,
            realtimeSession: true
        });
        expect(profile.duplex).toBe(duplex);
    });

    it('通訳セッションのマイクは TTS 再生中も送信する（半二重禁止・文落ち回帰ガード）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: true
        });
        expect(
            shouldSkipCapture(profile, {
                isPlayingAudio: true,
                outputEndTime: null,
                bufferWindowMs: 400,
                now: 1_000_000
            })
        ).toBe(false);
    });

    it('段未確定（開始直後）の Electron system は仮想カード行として扱う', () => {
        expect(
            deriveCaptureProfileId({
                isElectron: true,
                audioSourceType: 'system',
                fallbackStage: null
            })
        ).toBe(CAPTURE_PROFILE_IDS.ELECTRON_VIRTUAL_CARD);
    });

    it('仮想カードは stream-preview と preferContinuousCapture=true', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'virtual-card',
            outputIsolated: true
        });
        expect(profile.captionPolicy).toBe('stream-preview');
        expect(profile.preferContinuousCapture).toBe(true);
        expect(profile.vadPreset).toBe('MICROPHONE');
    });

    it('仮想カードは物理出力へ隔離済みなら TTS を再生する', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'virtual-card',
            outputIsolated: true
        });
        expect(profile.ttsPolicy).toBe('play');
    });

    it('仮想カードは物理出力が無ければ回灌防止のため TTS を抑止する', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'virtual-card',
            outputIsolated: false
        });
        expect(profile.ttsPolicy).toBe('suppress');
    });

    it('仮想カードのデジタル音声にはマイク用 noiseReduction を適用しない', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'virtual-card',
            outputIsolated: true
        });
        expect(profile.noiseReduction).toBeNull();
    });

    it('マイクは noiseReduction=null・ttsPolicy=play（他経路を変えない）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: true
        });
        expect(profile.noiseReduction).toBeNull();
        expect(profile.ttsPolicy).toBe('play');
    });

    it('マイクは stream-preview のまま（他経路を変えない）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: true
        });
        expect(profile.captionPolicy).toBe('stream-preview');
        expect(profile.preferContinuousCapture).toBe(false);
    });

    it('マイクモードは段を無視してマイク行に解決する（フォールバック対象外）', () => {
        expect(
            deriveCaptureProfileId({
                isElectron: true,
                audioSourceType: 'microphone',
                fallbackStage: 'loopback'
            })
        ).toBe(CAPTURE_PROFILE_IDS.ELECTRON_MIC);
    });

    it('不正な列挙値は throw する', () => {
        expect(() =>
            deriveCaptureProfileId({
                isElectron: true,
                audioSourceType: 'tab',
                fallbackStage: null
            })
        ).toThrow(/audioSourceType/);
        expect(() =>
            deriveCaptureProfileId({
                isElectron: true,
                audioSourceType: 'system',
                fallbackStage: 'speaker'
            })
        ).toThrow(/fallbackStage/);
    });
});

describe('shouldSkipCapture（半二重ゲート・D1回帰）', () => {
    const NOW = 1_000_000;
    const WINDOW = 400;

    it('仮想カード×TTS再生中×出力未隔離でも送信する（今日のバグの再現ケース）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'virtual-card',
            outputIsolated: false // outputDeviceId='' 相当
        });
        expect(
            shouldSkipCapture(profile, {
                isPlayingAudio: true,
                outputEndTime: null,
                bufferWindowMs: WINDOW,
                now: NOW
            })
        ).toBe(false);
    });

    it('ループバック×TTS再生中も送信する（TTSは抑止側で断つ）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'loopback',
            outputIsolated: false
        });
        expect(
            shouldSkipCapture(profile, {
                isPlayingAudio: true,
                outputEndTime: null,
                bufferWindowMs: WINDOW,
                now: NOW
            })
        ).toBe(false);
    });

    it('非通訳のマイクフォールバック中は再生中スキップ＋bufferWindow内スキップ（物理マイク保護）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'microphone',
            outputIsolated: true
        });
        // 再生中
        expect(
            shouldSkipCapture(profile, {
                isPlayingAudio: true,
                outputEndTime: null,
                bufferWindowMs: WINDOW,
                now: NOW
            })
        ).toBe(true);
        // 再生終了直後（ウィンドウ内）
        expect(
            shouldSkipCapture(profile, {
                isPlayingAudio: false,
                outputEndTime: NOW - 100,
                bufferWindowMs: WINDOW,
                now: NOW
            })
        ).toBe(true);
        // ウィンドウ経過後
        expect(
            shouldSkipCapture(profile, {
                isPlayingAudio: false,
                outputEndTime: NOW - 1000,
                bufferWindowMs: WINDOW,
                now: NOW
            })
        ).toBe(false);
        // 再生実績なし
        expect(
            shouldSkipCapture(profile, {
                isPlayingAudio: false,
                outputEndTime: null,
                bufferWindowMs: WINDOW,
                now: NOW
            })
        ).toBe(false);
    });

    it('プロファイル未構築時は保守的にマイク保護と同じ挙動', () => {
        expect(
            shouldSkipCapture(null, {
                isPlayingAudio: true,
                outputEndTime: null,
                bufferWindowMs: WINDOW,
                now: NOW
            })
        ).toBe(true);
        expect(
            shouldSkipCapture(null, {
                isPlayingAudio: false,
                outputEndTime: null,
                bufferWindowMs: WINDOW,
                now: NOW
            })
        ).toBe(false);
    });
});

describe('captureEntryFor（採集入口の決定表・routeAudioCapture のディスパッチ根拠）', () => {
    it.each([
        // [isElectron, audioSourceType, 期待エントリ]
        [true, 'microphone', 'microphone'],
        [false, 'microphone', 'microphone'],
        [true, 'system', 'monitor-fallback'],
        [false, 'system', 'monitor-display']
    ])('isElectron=%s source=%s → %s', (isElectron, audioSourceType, entry) => {
        expect(captureEntryFor({ isElectron, audioSourceType })).toBe(entry);
    });
});
