/**
 * AudioValidator ユニットテスト
 */

import { AudioValidator } from '../../src/audio/AudioValidator';

describe('AudioValidator', () => {
    let validator: AudioValidator;

    beforeEach(() => {
        validator = new AudioValidator();
    });

    describe('validate', () => {
        it('should pass for valid audio data', () => {
            // 有効な音声データ（200ms @ 24kHz, RMS=0.1）
            const audioData = new Float32Array(4800);
            for (let i = 0; i < audioData.length; i++) {
                audioData[i] = Math.sin(i * 0.1) * 0.1;
            }

            const result = validator.validate(audioData);
            expect(result.valid).toBe(true);
        });

        it('should fail for short audio data', () => {
            const audioData = new Float32Array(1000); // 短すぎる
            const result = validator.validate(audioData);

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('短すぎます');
        });

        it('should fail for silent audio data', () => {
            const audioData = new Float32Array(4800).fill(0); // すべてゼロ
            const result = validator.validate(audioData);

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('RMSエネルギーが低すぎます');
        });

        it('should fail for high zero ratio', () => {
            const audioData = new Float32Array(4800);
            // 96%がゼロ
            for (let i = 0; i < 4600; i++) {
                audioData[i] = 0;
            }
            for (let i = 4600; i < 4800; i++) {
                audioData[i] = 0.1;
            }

            const result = validator.validate(audioData);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('ゼロサンプル比率が高すぎます');
        });
    });

    describe('calculateRMS', () => {
        it('should calculate RMS correctly', () => {
            const audioData = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            const rms = validator.calculateRMS(audioData);

            const expected = Math.sqrt((0.01 + 0.04 + 0.09 + 0.16) / 4);
            expect(rms).toBeCloseTo(expected, 5);
        });

        it('should return 0 for zero array', () => {
            const audioData = new Float32Array(100).fill(0);
            const rms = validator.calculateRMS(audioData);

            expect(rms).toBe(0);
        });
    });

    describe('calculateZeroRatio', () => {
        it('should calculate zero ratio correctly', () => {
            const audioData = new Float32Array(100);
            for (let i = 0; i < 50; i++) {
                audioData[i] = 0;
            }
            for (let i = 50; i < 100; i++) {
                audioData[i] = 0.1;
            }

            const ratio = validator.calculateZeroRatio(audioData);
            expect(ratio).toBeCloseTo(0.5, 2);
        });
    });

    describe('calculateQualityMetrics', () => {
        it('should calculate all metrics', () => {
            const audioData = new Float32Array(4800);
            for (let i = 0; i < audioData.length; i++) {
                audioData[i] = Math.sin(i * 0.1) * 0.1;
            }

            const metrics = validator.calculateQualityMetrics(audioData);

            expect(metrics.rms).toBeGreaterThan(0);
            expect(metrics.peakAmplitude).toBeGreaterThan(0);
            expect(metrics.zeroCrossingRate).toBeGreaterThan(0);
            expect(metrics.estimatedSNR).toBeDefined();
            expect(metrics.speechLikelihood).toBeDefined();
        });
    });

    describe('updateConfig', () => {
        it('should update configuration', () => {
            validator.updateConfig({ minRMSEnergy: 0.005 });
            const config = validator.getConfig();

            expect(config.minRMSEnergy).toBe(0.005);
        });
    });
});


