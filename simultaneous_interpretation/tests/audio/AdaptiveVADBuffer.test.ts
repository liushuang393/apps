/**
 * AdaptiveVADBuffer ユニットテスト
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 */

import { AdaptiveVADBuffer } from '../../src/audio/AdaptiveVADBuffer';
import {
    LANGUAGE_VAD_CONFIG,
    SCENARIO_PRESETS,
    ADAPTIVE_VAD_CONSTRAINTS
} from '../../src/config/VADPresets';

describe('AdaptiveVADBuffer', () => {
    describe('constructor', () => {
        it('should initialize with default scenario', () => {
            const buffer = new AdaptiveVADBuffer('ja');
            const settings = buffer.getSettings();

            expect(settings.language).toBe('ja');
            expect(settings.scenario).toBe('conversation');
        });

        it('should initialize with custom scenario', () => {
            const buffer = new AdaptiveVADBuffer('en', 'meeting');
            const settings = buffer.getSettings();

            expect(settings.language).toBe('en');
            expect(settings.scenario).toBe('meeting');
        });
    });

    describe('calculateOptimalParams', () => {
        it('should calculate params without history', () => {
            const buffer = new AdaptiveVADBuffer('ja', 'conversation');
            const params = buffer.calculateOptimalParams();

            const baseConfig = LANGUAGE_VAD_CONFIG['ja']!;
            const preset = SCENARIO_PRESETS['conversation']!;

            expect(params.minDuration).toBe(Math.round(baseConfig.minSpeechDuration * preset.minMult));
            expect(params.silenceDelay).toBe(
                Math.round(baseConfig.silenceConfirmDelay * preset.silenceMult)
            );
            expect(params.adaptiveApplied).toBe(false);
        });

        it('should apply scenario multipliers for meeting', () => {
            const buffer = new AdaptiveVADBuffer('en', 'meeting');
            const params = buffer.calculateOptimalParams();

            const baseConfig = LANGUAGE_VAD_CONFIG['en']!;
            const preset = SCENARIO_PRESETS['meeting']!;

            expect(params.minDuration).toBe(Math.round(baseConfig.minSpeechDuration * preset.minMult));
            expect(params.scenario).toBe('meeting');
        });

        it('should apply adaptive adjustment with sufficient history', () => {
            const buffer = new AdaptiveVADBuffer('zh', 'conversation');

            // 履歴を追加（5件以上）
            for (let i = 0; i < 6; i++) {
                buffer.recordSpeech(1500 + i * 100, 400 + i * 50);
            }

            const params = buffer.calculateOptimalParams();

            expect(params.adaptiveApplied).toBe(true);
            expect(params.language).toBe('zh');
        });

        it('should respect guard rails', () => {
            const buffer = new AdaptiveVADBuffer('vi', 'quickChat');

            // 極端な値を記録
            for (let i = 0; i < 6; i++) {
                buffer.recordSpeech(5000, 2000); // 非常に長い
            }

            const params = buffer.calculateOptimalParams();
            const baseConfig = LANGUAGE_VAD_CONFIG['vi']!;

            // 最大値を超えないことを確認
            expect(params.minDuration).toBeLessThanOrEqual(
                baseConfig.minSpeechDuration * ADAPTIVE_VAD_CONSTRAINTS.MAX_MULTIPLIER
            );
        });
    });

    describe('recordSpeech', () => {
        it('should record speech data', () => {
            const buffer = new AdaptiveVADBuffer('ja');

            buffer.recordSpeech(1000, 500);
            const history = buffer.getHistory();

            expect(history.durations).toContain(1000);
            expect(history.silences).toContain(500);
        });

        it('should reject negative values', () => {
            const buffer = new AdaptiveVADBuffer('en');
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

            buffer.recordSpeech(-100, 500);
            buffer.recordSpeech(1000, -50);

            expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
            expect(buffer.getHistory().durations).toHaveLength(0);

            consoleWarnSpy.mockRestore();
        });

        it('should maintain max history limit', () => {
            const buffer = new AdaptiveVADBuffer('zh');

            // 最大件数 + 2 を記録
            for (let i = 0; i < ADAPTIVE_VAD_CONSTRAINTS.MAX_HISTORY_COUNT + 2; i++) {
                buffer.recordSpeech(1000 + i, 500 + i);
            }

            const history = buffer.getHistory();
            expect(history.durations).toHaveLength(ADAPTIVE_VAD_CONSTRAINTS.MAX_HISTORY_COUNT);
        });
    });

    describe('setLanguage', () => {
        it('should change language and reset history', () => {
            const buffer = new AdaptiveVADBuffer('ja');

            buffer.recordSpeech(1000, 500);
            buffer.recordSpeech(1500, 600);

            buffer.setLanguage('en');

            const settings = buffer.getSettings();
            const history = buffer.getHistory();

            expect(settings.language).toBe('en');
            expect(history.durations).toHaveLength(0);
        });

        it('should not reset history if language is same', () => {
            const buffer = new AdaptiveVADBuffer('zh');

            buffer.recordSpeech(1000, 500);
            buffer.setLanguage('zh');

            const history = buffer.getHistory();
            expect(history.durations).toHaveLength(1);
        });
    });

    describe('setScenario', () => {
        it('should change scenario', () => {
            const buffer = new AdaptiveVADBuffer('vi', 'conversation');

            buffer.setScenario('meeting');

            const settings = buffer.getSettings();
            expect(settings.scenario).toBe('meeting');
        });
    });

    describe('resetHistory', () => {
        it('should clear all history', () => {
            const buffer = new AdaptiveVADBuffer('ja');

            buffer.recordSpeech(1000, 500);
            buffer.recordSpeech(1500, 600);

            buffer.resetHistory();

            const history = buffer.getHistory();
            expect(history.durations).toHaveLength(0);
            expect(history.silences).toHaveLength(0);
        });
    });
});


