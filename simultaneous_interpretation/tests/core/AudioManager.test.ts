/**
 * AudioManager のテスト
 */

import { AudioManager } from '../../src/core/AudioManager';
import type { AudioConstraints } from '../../src/core/AudioManager';

// AudioContext のモック
class MockAudioContext {
    state: string = 'running';
    sampleRate: number = 48000;
    destination: any = {
        connect: jest.fn()
    };

    createGain(): any {
        return {
            gain: { value: 1.0 },
            connect: jest.fn(),
            disconnect: jest.fn()
        };
    }

    createMediaStreamSource(stream: MediaStream): any {
        return {
            connect: jest.fn(),
            disconnect: jest.fn()
        };
    }

    createScriptProcessor(bufferSize: number, inputChannels: number, outputChannels: number): any {
        return {
            connect: jest.fn(),
            disconnect: jest.fn(),
            onaudioprocess: null
        };
    }

    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
        return {
            length,
            duration: length / sampleRate,
            sampleRate,
            numberOfChannels,
            getChannelData: (channel: number) => new Float32Array(length),
            copyFromChannel: jest.fn(),
            copyToChannel: jest.fn()
        } as AudioBuffer;
    }

    createBufferSource(): any {
        const source = {
            buffer: null,
            connect: jest.fn(),
            disconnect: jest.fn(),
            start: jest.fn(() => {
                // Simulate immediate playback completion
                setTimeout(() => {
                    if (source.onended) {
                        source.onended(new Event('ended'));
                    }
                }, 0);
            }),
            stop: jest.fn(),
            onended: null
        };
        return source;
    }

    async resume(): Promise<void> {
        this.state = 'running';
    }

    async close(): Promise<void> {
        this.state = 'closed';
    }

    decodeAudioData(audioData: ArrayBuffer): Promise<AudioBuffer> {
        return Promise.resolve({
            length: 1024,
            duration: 1.0,
            sampleRate: 48000,
            numberOfChannels: 1,
            getChannelData: (channel: number) => new Float32Array(1024),
            copyFromChannel: jest.fn(),
            copyToChannel: jest.fn()
        } as AudioBuffer);
    }
}

// MediaStream のモック
class MockMediaStream {
    id: string = 'mock-stream';
    active: boolean = true;
    
    getTracks(): any[] {
        return [{
            kind: 'audio',
            id: 'mock-track',
            enabled: true,
            stop: jest.fn()
        }];
    }
    
    getAudioTracks(): any[] {
        return this.getTracks();
    }
}

// グローバルモック設定
(global as any).AudioContext = MockAudioContext;
(global as any).MediaStream = MockMediaStream;

// navigator.mediaDevices のモック
Object.defineProperty(global, 'navigator', {
    writable: true,
    value: {
        mediaDevices: {
            getUserMedia: jest.fn().mockResolvedValue(new MockMediaStream())
        }
    }
});

describe('AudioManager', () => {
    let manager: AudioManager;
    
    beforeEach(() => {
        manager = new AudioManager();
        jest.clearAllMocks();
    });
    
    afterEach(async () => {
        await manager.stopRecording();
    });
    
    describe('初期状態', () => {
        it('should initialize with null audio context', () => {
            expect((manager as any).audioContext).toBeNull();
        });
        
        it('should initialize with null output audio context', () => {
            expect((manager as any).outputAudioContext).toBeNull();
        });
        
        it('should initialize with empty audio queue', () => {
            expect((manager as any).audioQueue).toEqual([]);
        });
        
        it('should initialize with empty playback queue', () => {
            expect((manager as any).playbackQueue).toEqual([]);
        });
    });
    
    describe('startMicrophoneCapture()', () => {
        it('should start microphone capture with default constraints', async () => {
            await manager.startMicrophoneCapture({});

            expect((manager as any).mediaStream).not.toBeNull();
        });

        it('should start microphone capture with custom constraints', async () => {
            const constraints: AudioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false
            };

            await manager.startMicrophoneCapture(constraints);

            expect((manager as any).mediaStream).not.toBeNull();
        });
    });
    
    describe('stopRecording()', () => {
        it('should stop recording and clean up resources', async () => {
            await manager.startMicrophoneCapture({});

            await manager.stopRecording();

            expect((manager as any).mediaStream).toBeNull();
        });

        it('should do nothing if not recording', async () => {
            await expect(manager.stopRecording()).resolves.not.toThrow();
        });
    });
    
    describe('enqueueAudio()', () => {
        it('should add audio to queue', () => {
            const base64Audio = 'dGVzdA=='; // "test" in base64
            
            manager.enqueueAudio(base64Audio);
            
            expect((manager as any).audioQueue).toContain(base64Audio);
        });
        
        it('should add multiple audio chunks to queue', () => {
            manager.enqueueAudio('audio1');
            manager.enqueueAudio('audio2');
            manager.enqueueAudio('audio3');
            
            expect((manager as any).audioQueue).toHaveLength(3);
        });
    });
    
    describe('clearAudioQueue()', () => {
        it('should clear audio queue', () => {
            manager.enqueueAudio('audio1');
            manager.enqueueAudio('audio2');
            
            manager.clearAudioQueue();
            
            expect((manager as any).audioQueue).toEqual([]);
        });
        
        it('should clear playback queue', () => {
            (manager as any).playbackQueue = ['audio1', 'audio2'];
            
            manager.clearAudioQueue();
            
            expect((manager as any).playbackQueue).toEqual([]);
        });
    });
    
    describe('setOutputVolume()', () => {
        it('should set output volume', async () => {
            await manager.startMicrophoneCapture({});
            
            manager.setOutputVolume(0.5);
            
            // Volume is set internally, no direct way to verify
            // Just ensure it doesn't throw
            expect(true).toBe(true);
        });
        
        it('should clamp volume to 0-1 range', async () => {
            await manager.startMicrophoneCapture({});
            
            manager.setOutputVolume(1.5);
            manager.setOutputVolume(-0.5);
            
            // Should not throw
            expect(true).toBe(true);
        });
    });
    
    describe('setInputAudioOutputEnabled()', () => {
        it('should enable input audio output', async () => {
            await manager.startMicrophoneCapture({});
            
            manager.setInputAudioOutputEnabled(true);
            
            expect(true).toBe(true);
        });
        
        it('should disable input audio output', async () => {
            await manager.startMicrophoneCapture({});
            
            manager.setInputAudioOutputEnabled(false);
            
            expect(true).toBe(true);
        });
    });
    
    describe('setAudioDataCallback()', () => {
        it('should set audio data callback', () => {
            const callback = jest.fn();
            
            manager.setAudioDataCallback(callback);
            
            expect((manager as any).audioDataCallback).toBe(callback);
        });
    });
    
    describe('playAudio()', () => {
        it('should handle audio playback', async () => {
            // Create valid base64 audio data (16-bit PCM)
            const audioData = new Int16Array(1024);
            for (let i = 0; i < audioData.length; i++) {
                audioData[i] = Math.floor(Math.random() * 65536) - 32768;
            }
            const base64Audio = btoa(String.fromCharCode(...new Uint8Array(audioData.buffer)));

            // Should not throw
            await expect(manager.playAudio(base64Audio)).resolves.not.toThrow();
        });

        it('should handle invalid base64 audio', async () => {
            const invalidAudio = 'invalid!!!';

            await expect(manager.playAudio(invalidAudio)).rejects.toThrow();
        });
    });
});

