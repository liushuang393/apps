/**
 * VAD.ts のテスト
 */

import { VoiceActivityDetector } from '../../src/core/VAD';

describe('VoiceActivityDetector', () => {
    let vad: VoiceActivityDetector;

    beforeEach(() => {
        vad = new VoiceActivityDetector({
            threshold: 0.01,
            debounceTime: 300
        });
    });

    describe('constructor', () => {
        it('should initialize with default values', () => {
            const defaultVad = new VoiceActivityDetector();
            expect(defaultVad.getIsCalibrating()).toBe(true);
            expect(defaultVad.getIsSpeaking()).toBe(false);
        });

        it('should initialize with custom values', () => {
            const customVad = new VoiceActivityDetector({
                threshold: 0.05,
                debounceTime: 500
            });
            expect(customVad.getIsCalibrating()).toBe(true);
        });

        it('should accept callback functions', () => {
            const onSpeechStart = jest.fn();
            const onSpeechEnd = jest.fn();
            
            const callbackVad = new VoiceActivityDetector({
                onSpeechStart,
                onSpeechEnd
            });
            
            expect(callbackVad).toBeDefined();
        });
    });

    describe('analyze', () => {
        it('should return analysis result during calibration', () => {
            const audioData = new Float32Array(100).fill(0.01);
            const result = vad.analyze(audioData);
            
            expect(result).toHaveProperty('energy');
            expect(result).toHaveProperty('isSpeaking');
            expect(result.isSpeaking).toBe(false);
        });

        it('should complete calibration after enough samples', () => {
            const audioData = new Float32Array(100).fill(0.01);
            
            // Feed 30 samples for calibration
            for (let i = 0; i < 30; i++) {
                vad.analyze(audioData);
            }
            
            expect(vad.getIsCalibrating()).toBe(false);
        });

        it('should detect speech after calibration', () => {
            const quietData = new Float32Array(100).fill(0.001);
            const loudData = new Float32Array(100).fill(0.5);
            
            // Complete calibration with quiet data
            for (let i = 0; i < 30; i++) {
                vad.analyze(quietData);
            }
            
            // Feed loud data
            const result = vad.analyze(loudData);
            
            expect(result.isSpeaking).toBe(true);
        });

        it('should trigger onSpeechStart callback', (done) => {
            const onSpeechStart = jest.fn(() => {
                expect(onSpeechStart).toHaveBeenCalled();
                done();
            });
            
            const callbackVad = new VoiceActivityDetector({
                threshold: 0.01,
                onSpeechStart
            });
            
            const quietData = new Float32Array(100).fill(0.001);
            const loudData = new Float32Array(100).fill(0.5);
            
            // Complete calibration
            for (let i = 0; i < 30; i++) {
                callbackVad.analyze(quietData);
            }
            
            // Trigger speech
            callbackVad.analyze(loudData);
        });
    });

    describe('reset', () => {
        it('should reset VAD state', () => {
            const audioData = new Float32Array(100).fill(0.01);
            
            // Complete calibration
            for (let i = 0; i < 30; i++) {
                vad.analyze(audioData);
            }
            
            expect(vad.getIsCalibrating()).toBe(false);
            
            // Reset
            vad.reset();
            
            expect(vad.getIsCalibrating()).toBe(true);
            expect(vad.getIsSpeaking()).toBe(false);
        });
    });

    describe('getters', () => {
        it('should return correct isSpeaking state', () => {
            expect(vad.getIsSpeaking()).toBe(false);
        });

        it('should return correct isCalibrating state', () => {
            expect(vad.getIsCalibrating()).toBe(true);
        });

        it('should return adaptive threshold after calibration', () => {
            const audioData = new Float32Array(100).fill(0.01);
            
            // Complete calibration
            for (let i = 0; i < 30; i++) {
                vad.analyze(audioData);
            }
            
            const threshold = vad.getAdaptiveThreshold();
            expect(threshold).toBeGreaterThan(0);
        });

        it('should return noise floor after calibration', () => {
            const audioData = new Float32Array(100).fill(0.01);
            
            // Complete calibration
            for (let i = 0; i < 30; i++) {
                vad.analyze(audioData);
            }
            
            const noiseFloor = vad.getNoiseFloor();
            expect(noiseFloor).toBeGreaterThanOrEqual(0);
        });
    });

    describe('energy calculation', () => {
        it('should calculate correct energy for silent audio', () => {
            const silentData = new Float32Array(100).fill(0);
            const result = vad.analyze(silentData);
            expect(result.energy).toBe(0);
        });

        it('should calculate higher energy for loud audio', () => {
            const quietData = new Float32Array(100).fill(0.01);
            const loudData = new Float32Array(100).fill(0.5);
            
            const quietResult = vad.analyze(quietData);
            const loudResult = vad.analyze(loudData);
            
            expect(loudResult.energy).toBeGreaterThan(quietResult.energy);
        });
    });

    describe('debounce behavior', () => {
        it('should maintain speaking state during debounce period', () => {
            const debouncedVad = new VoiceActivityDetector({
                threshold: 0.01,
                debounceTime: 300
            });

            const silentData = new Float32Array(100).fill(0); // Completely silent
            const loudData = new Float32Array(100).fill(0.5);

            // Complete calibration with silent data
            for (let i = 0; i < 30; i++) {
                debouncedVad.analyze(silentData);
            }

            // Start speech
            debouncedVad.analyze(loudData);
            expect(debouncedVad.getIsSpeaking()).toBe(true);

            // Stop speech - analyze silent data multiple times to clear energy history
            for (let i = 0; i < 15; i++) {
                debouncedVad.analyze(silentData);
            }

            // Should still be speaking (debounce prevents immediate state change)
            expect(debouncedVad.getIsSpeaking()).toBe(true);
        });
    });
});

