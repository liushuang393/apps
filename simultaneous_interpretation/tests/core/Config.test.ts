/**
 * Config.ts のテスト
 */

import { 
    CONFIG, 
    getAudioPreset, 
    setAudioPreset, 
    setDebugMode,
    type AudioPresetName 
} from '../../src/core/Config';

describe('Config', () => {
    describe('CONFIG object', () => {
        it('should have default DEBUG_MODE as false', () => {
            expect(CONFIG.DEBUG_MODE).toBe(false);
        });

        it('should have correct API configuration', () => {
            expect(CONFIG.API.REALTIME_URL).toBe('wss://api.openai.com/v1/realtime');
            expect(CONFIG.API.REALTIME_MODEL).toBe('gpt-realtime-2025-08-28');
            expect(CONFIG.API.CHAT_MODEL).toBe('gpt-5-2025-08-07'); // 修正: 現在の設定値に合わせる
            expect(CONFIG.API.TIMEOUT).toBe(30000);
        });

        it('should have BALANCED as default audio preset', () => {
            expect(CONFIG.AUDIO_PRESET).toBe('BALANCED');
        });

        it('should have all audio presets defined', () => {
            expect(CONFIG.AUDIO_PRESETS.BALANCED).toBeDefined();
            expect(CONFIG.AUDIO_PRESETS.AGGRESSIVE).toBeDefined();
            expect(CONFIG.AUDIO_PRESETS.LOW_LATENCY).toBeDefined();
            expect(CONFIG.AUDIO_PRESETS.SERVER_VAD).toBeDefined();
        });

        it('should have correct audio configuration', () => {
            expect(CONFIG.AUDIO.SAMPLE_RATE).toBe(24000);
            expect(CONFIG.AUDIO.CHUNK_SIZE).toBe(4800);
            expect(CONFIG.AUDIO.FORMAT).toBe('pcm16');
        });

        it('should have VAD configuration for both MICROPHONE and SYSTEM', () => {
            expect(CONFIG.VAD.MICROPHONE).toBeDefined();
            expect(CONFIG.VAD.SYSTEM).toBeDefined();
            expect(CONFIG.VAD.MICROPHONE.LOW).toBeDefined();
            expect(CONFIG.VAD.MICROPHONE.MEDIUM).toBeDefined();
            expect(CONFIG.VAD.MICROPHONE.HIGH).toBeDefined();
        });
    });

    describe('getAudioPreset', () => {
        it('should return BALANCED preset by default', () => {
            const preset = getAudioPreset();
            expect(preset).toEqual(CONFIG.AUDIO_PRESETS.BALANCED);
        });

        it('should return current preset', () => {
            CONFIG.AUDIO_PRESET = 'AGGRESSIVE';
            const preset = getAudioPreset();
            expect(preset).toEqual(CONFIG.AUDIO_PRESETS.AGGRESSIVE);
            // Reset
            CONFIG.AUDIO_PRESET = 'BALANCED';
        });
    });

    describe('setAudioPreset', () => {
        beforeEach(() => {
            CONFIG.AUDIO_PRESET = 'BALANCED';
        });

        it('should change audio preset', () => {
            const preset = setAudioPreset('LOW_LATENCY');
            expect(CONFIG.AUDIO_PRESET).toBe('LOW_LATENCY');
            expect(preset).toEqual(CONFIG.AUDIO_PRESETS.LOW_LATENCY);
        });

        it('should return BALANCED for invalid preset name', () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            const preset = setAudioPreset('INVALID' as AudioPresetName);
            expect(CONFIG.AUDIO_PRESET).toBe('BALANCED');
            expect(preset).toEqual(CONFIG.AUDIO_PRESETS.BALANCED);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('setDebugMode', () => {
        beforeEach(() => {
            CONFIG.DEBUG_MODE = false;
        });

        it('should enable debug mode', () => {
            const consoleSpy = jest.spyOn(console, 'info').mockImplementation();
            setDebugMode(true);
            expect(CONFIG.DEBUG_MODE).toBe(true);
            expect(consoleSpy).toHaveBeenCalledWith('[Config] デバッグモード: 有効');
            consoleSpy.mockRestore();
        });

        it('should disable debug mode', () => {
            const consoleSpy = jest.spyOn(console, 'info').mockImplementation();
            CONFIG.DEBUG_MODE = true;
            setDebugMode(false);
            expect(CONFIG.DEBUG_MODE).toBe(false);
            expect(consoleSpy).toHaveBeenCalledWith('[Config] デバッグモード: 無効');
            consoleSpy.mockRestore();
        });
    });

    describe('Audio Presets', () => {
        it('BALANCED preset should have correct values', () => {
            const preset = CONFIG.AUDIO_PRESETS.BALANCED;
            expect(preset.BUFFER_SIZE).toBe(6000);
            expect(preset.MIN_SPEECH_MS).toBe(500);
            expect(preset.VAD_DEBOUNCE).toBe(400);
        });

        it('AGGRESSIVE preset should have correct values', () => {
            const preset = CONFIG.AUDIO_PRESETS.AGGRESSIVE;
            expect(preset.BUFFER_SIZE).toBe(8000);
            expect(preset.MIN_SPEECH_MS).toBe(800);
            expect(preset.VAD_DEBOUNCE).toBe(500);
        });

        it('LOW_LATENCY preset should have correct values', () => {
            const preset = CONFIG.AUDIO_PRESETS.LOW_LATENCY;
            expect(preset.BUFFER_SIZE).toBe(4800);
            expect(preset.MIN_SPEECH_MS).toBe(400);
            expect(preset.VAD_DEBOUNCE).toBe(250);
        });

        it('SERVER_VAD preset should have correct values', () => {
            const preset = CONFIG.AUDIO_PRESETS.SERVER_VAD;
            expect(preset.BUFFER_SIZE).toBe(4800);
            expect(preset.MIN_SPEECH_MS).toBe(0);
            expect(preset.VAD_DEBOUNCE).toBe(0);
        });
    });

    describe('VAD Configuration', () => {
        it('MICROPHONE mode should have correct thresholds', () => {
            expect(CONFIG.VAD.MICROPHONE.LOW.threshold).toBe(0.008);
            expect(CONFIG.VAD.MICROPHONE.MEDIUM.threshold).toBe(0.004);
            expect(CONFIG.VAD.MICROPHONE.HIGH.threshold).toBe(0.002);
        });

        it('SYSTEM mode should have correct thresholds', () => {
            expect(CONFIG.VAD.SYSTEM.LOW.threshold).toBe(0.015);
            expect(CONFIG.VAD.SYSTEM.MEDIUM.threshold).toBe(0.010);
            expect(CONFIG.VAD.SYSTEM.HIGH.threshold).toBe(0.006);
        });

        it('MICROPHONE mode should have correct debounce times', () => {
            expect(CONFIG.VAD.MICROPHONE.LOW.debounce).toBe(400);
            expect(CONFIG.VAD.MICROPHONE.MEDIUM.debounce).toBe(250);
            expect(CONFIG.VAD.MICROPHONE.HIGH.debounce).toBe(150);
        });

        it('SYSTEM mode should have correct debounce times', () => {
            expect(CONFIG.VAD.SYSTEM.LOW.debounce).toBe(500);
            expect(CONFIG.VAD.SYSTEM.MEDIUM.debounce).toBe(350);
            expect(CONFIG.VAD.SYSTEM.HIGH.debounce).toBe(250);
        });
    });
});

