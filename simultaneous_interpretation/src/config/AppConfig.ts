/**
 * Application-wide configuration.
 *
 * Environment variables override these reference defaults. Electron reads the
 * same names and passes the resolved values to the renderer.
 */

export type AudioPresetName = 'BALANCED' | 'AGGRESSIVE' | 'LOW_LATENCY' | 'SERVER_VAD';

export interface AudioPresetConfig {
    BUFFER_SIZE: number;
    MIN_SPEECH_MS: number;
    VAD_DEBOUNCE: number;
    DESCRIPTION: string;
}

export interface VADSensitivityConfig {
    threshold: number;
    debounce: number;
}

export interface VADModeConfig {
    LOW: VADSensitivityConfig;
    MEDIUM: VADSensitivityConfig;
    HIGH: VADSensitivityConfig;
}

export class AppConfig {
    static DEBUG_MODE = false;

    static API = {
        REALTIME_URL: 'wss://api.openai.com/v1/realtime/translations',
        REALTIME_MODEL: 'gpt-realtime-translate',
        CHAT_MODEL: 'gpt-5-2025-08-07',
        TRANSCRIBE_MODEL: 'gpt-realtime-whisper',
        TIMEOUT: 30000
    };

    static AUDIO_PRESET: AudioPresetName = 'BALANCED';

    static AUDIO_PRESETS: Record<AudioPresetName, AudioPresetConfig> = {
        BALANCED: {
            BUFFER_SIZE: 6000,
            MIN_SPEECH_MS: 500,
            VAD_DEBOUNCE: 400,
            DESCRIPTION: 'Balanced quality and latency'
        },
        AGGRESSIVE: {
            BUFFER_SIZE: 8000,
            MIN_SPEECH_MS: 800,
            VAD_DEBOUNCE: 500,
            DESCRIPTION: 'Higher accuracy with more latency'
        },
        LOW_LATENCY: {
            BUFFER_SIZE: 4800,
            MIN_SPEECH_MS: 400,
            VAD_DEBOUNCE: 250,
            DESCRIPTION: 'Lower latency with lighter VAD filtering'
        },
        SERVER_VAD: {
            BUFFER_SIZE: 4800,
            MIN_SPEECH_MS: 0,
            VAD_DEBOUNCE: 0,
            DESCRIPTION: 'OpenAI server VAD'
        }
    };

    static AUDIO = {
        SAMPLE_RATE: 24000,
        CHUNK_SIZE: 4800,
        FORMAT: 'pcm16' as const
    };

    static VAD = {
        MICROPHONE: {
            LOW: { threshold: 0.008, debounce: 400 },
            MEDIUM: { threshold: 0.004, debounce: 250 },
            HIGH: { threshold: 0.002, debounce: 150 }
        } as VADModeConfig,
        SYSTEM: {
            LOW: { threshold: 0.015, debounce: 500 },
            MEDIUM: { threshold: 0.01, debounce: 350 },
            HIGH: { threshold: 0.006, debounce: 250 }
        } as VADModeConfig
    };

    static getAudioPreset(): AudioPresetConfig {
        return this.AUDIO_PRESETS[this.AUDIO_PRESET] || this.AUDIO_PRESETS.BALANCED;
    }

    static loadFromEnv(): void {
        if (typeof process === 'undefined' || !process.env) {
            return;
        }

        const errors: string[] = [];

        if (process.env['OPENAI_REALTIME_MODEL']) {
            this.API.REALTIME_MODEL = process.env['OPENAI_REALTIME_MODEL'];
        } else {
            errors.push('OPENAI_REALTIME_MODEL is not set');
        }

        if (process.env['OPENAI_CHAT_MODEL']) {
            this.API.CHAT_MODEL = process.env['OPENAI_CHAT_MODEL'];
        } else {
            errors.push('OPENAI_CHAT_MODEL is not set');
        }

        this.API.TRANSCRIBE_MODEL =
            process.env['OPENAI_TRANSCRIBE_MODEL'] ||
            process.env['OPENAI_TRANSCRIPTION_MODEL'] ||
            this.API.TRANSCRIBE_MODEL;

        if (process.env['OPENAI_REALTIME_URL']) {
            this.API.REALTIME_URL = process.env['OPENAI_REALTIME_URL'];
        }

        if (process.env['DEBUG_MODE']) {
            this.DEBUG_MODE = process.env['DEBUG_MODE'] === 'true';
        }

        if (errors.length > 0) {
            throw new Error(
                `Configuration error: required environment variables are missing\n` +
                    `${errors.join('\n')}\n\n` +
                    `Add these to your .env file:\n` +
                    `OPENAI_REALTIME_MODEL=gpt-realtime-translate\n` +
                    `OPENAI_CHAT_MODEL=gpt-5-2025-08-07\n` +
                    `OPENAI_TRANSCRIBE_MODEL=gpt-realtime-whisper`
            );
        }
    }

    static validate(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (typeof window === 'undefined' && !process.env['OPENAI_API_KEY']) {
            errors.push('OPENAI_API_KEY is not set');
        }

        if (!this.API.REALTIME_MODEL) {
            errors.push('REALTIME_MODEL is not set');
        }

        if (!this.API.CHAT_MODEL) {
            errors.push('CHAT_MODEL is not set');
        }

        if (!this.API.TRANSCRIBE_MODEL) {
            errors.push('TRANSCRIBE_MODEL is not set');
        }

        if (this.AUDIO.SAMPLE_RATE !== 24000) {
            errors.push('SAMPLE_RATE must be 24000 for Realtime API');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    static reset(): void {
        this.DEBUG_MODE = false;
        this.AUDIO_PRESET = 'BALANCED';
        this.API.REALTIME_URL = 'wss://api.openai.com/v1/realtime/translations';
        this.API.REALTIME_MODEL = 'gpt-realtime-translate';
        this.API.CHAT_MODEL = 'gpt-5-2025-08-07';
        this.API.TRANSCRIBE_MODEL = 'gpt-realtime-whisper';
    }
}

AppConfig.loadFromEnv();
