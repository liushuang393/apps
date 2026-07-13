/**
 * 通訳セッションの連続送信ゲート証拠テスト。
 *
 * 公式 translation EP は turn_detection 無し・句間の無音も含む連続 append が必要。
 * マイク行が preferContinuousCapture=false のままだと UI「自動音声検出」OFF 時に
 * クライアントVADが無音フレームを落とす → 2文目以降の認識欠落の根因になる。
 */

const {
    buildCaptureProfile
} = require('../../voicetranslate-capture-profile.js');

/**
 * voicetranslate-pro.js の onaudioprocess と同じ判定式。
 *
 * @param {boolean} vadUiActive
 * @param {{preferContinuousCapture?: boolean}|null} profile
 * @returns {boolean}
 */
function resolvePreferContinuous(vadUiActive, profile) {
    return vadUiActive || profile?.preferContinuousCapture === true;
}

describe('通訳マイクの連続送信（漏認識回帰）', () => {
    it('realtime マイクは VAD UI OFF でも連続送信する', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: true
        });

        expect(profile.preferContinuousCapture).toBe(true);
        expect(resolvePreferContinuous(false, profile)).toBe(true);
    });

    it('非通訳マイクは VAD UI に依存する（従来互換）', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: false
        });

        expect(profile.preferContinuousCapture).toBe(false);
        expect(resolvePreferContinuous(false, profile)).toBe(false);
        expect(resolvePreferContinuous(true, profile)).toBe(true);
    });

    it('browser realtime マイクも連続送信する', () => {
        const profile = buildCaptureProfile({
            isElectron: false,
            audioSourceType: 'microphone',
            fallbackStage: null,
            outputIsolated: false,
            realtimeSession: true
        });

        expect(profile.preferContinuousCapture).toBe(true);
        expect(resolvePreferContinuous(false, profile)).toBe(true);
    });

    it('mic-fallback realtime も連続送信する', () => {
        const profile = buildCaptureProfile({
            isElectron: true,
            audioSourceType: 'system',
            fallbackStage: 'microphone',
            outputIsolated: false,
            realtimeSession: true
        });

        expect(profile.preferContinuousCapture).toBe(true);
        expect(resolvePreferContinuous(false, profile)).toBe(true);
    });
});
