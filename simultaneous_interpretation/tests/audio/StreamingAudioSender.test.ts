/**
 * StreamingAudioSender ユニットテスト
 */

import { StreamingAudioSender } from '../../src/audio/StreamingAudioSender';

describe('StreamingAudioSender', () => {
    let sendFn: jest.Mock;
    let sender: StreamingAudioSender;

    beforeEach(() => {
        sendFn = jest.fn();
        sender = new StreamingAudioSender(sendFn, {
            chunkSize: 2400,
            sendInterval: 100,
            maxBufferSize: 48000
        });
    });

    afterEach(() => {
        sender.reset();
    });

    describe('start and stop', () => {
        it('should start streaming', () => {
            sender.start();
            // 内部状態の確認は難しいため、統計で確認
            const stats = sender.getStats();
            expect(stats.bufferUsage).toBe(0);
        });

        it('should stop streaming', () => {
            sender.start();
            sender.stop();
            
            // stop後は送信されない
            const audioData = new Float32Array(1000);
            sender.append(audioData);
            
            expect(sendFn).not.toHaveBeenCalled();
        });
    });

    describe('append', () => {
        it('should append audio data', () => {
            sender.start();
            
            const audioData = new Float32Array(1000);
            for (let i = 0; i < audioData.length; i++) {
                audioData[i] = Math.sin(i * 0.1) * 0.1;
            }

            sender.append(audioData);

            const stats = sender.getStats();
            expect(stats.totalSamples).toBe(1000);
            expect(stats.bufferUsage).toBeGreaterThan(0);
        });

        it('should warn when not active', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            
            const audioData = new Float32Array(100);
            sender.append(audioData);

            expect(consoleWarnSpy).toHaveBeenCalled();
            consoleWarnSpy.mockRestore();
        });
    });

    describe('flush', () => {
        it('should flush all buffered data', (done) => {
            sender.start();

            const audioData = new Float32Array(1000);
            sender.append(audioData);

            sender.flush();

            // flush後、送信されることを確認
            setTimeout(() => {
                expect(sendFn).toHaveBeenCalled();
                done();
            }, 50);
        });
    });

    describe('automatic sending', () => {
        it('should send chunks automatically', (done) => {
            sender.start();

            // 大量のデータを追加
            const audioData = new Float32Array(5000);
            for (let i = 0; i < audioData.length; i++) {
                audioData[i] = Math.sin(i * 0.1) * 0.1;
            }

            sender.append(audioData);

            // 100ms待って自動送信を確認
            setTimeout(() => {
                expect(sendFn).toHaveBeenCalled();
                const stats = sender.getStats();
                expect(stats.totalChunks).toBeGreaterThan(0);
                sender.stop();
                done();
            }, 150);
        });
    });

    describe('getStats', () => {
        it('should return correct stats', () => {
            const stats = sender.getStats();

            expect(stats.totalChunks).toBe(0);
            expect(stats.totalSamples).toBe(0);
            expect(stats.droppedChunks).toBe(0);
            expect(stats.bufferUsage).toBe(0);
        });

        it('should track samples', () => {
            sender.start();

            const audioData = new Float32Array(1000);
            sender.append(audioData);

            const stats = sender.getStats();
            expect(stats.totalSamples).toBe(1000);
        });
    });

    describe('reset', () => {
        it('should reset all state', () => {
            sender.start();

            const audioData = new Float32Array(1000);
            sender.append(audioData);

            sender.reset();

            const stats = sender.getStats();
            expect(stats.totalChunks).toBe(0);
            expect(stats.totalSamples).toBe(0);
            expect(stats.bufferUsage).toBe(0);
        });
    });

    describe('buffer overflow', () => {
        it('should handle buffer overflow', () => {
            sender.start();

            // バッファサイズを超えるデータを追加
            const largeData = new Float32Array(50000); // maxBufferSize = 48000
            sender.append(largeData);

            const stats = sender.getStats();
            // オーバーフローによりdroppedChunksが増加
            expect(stats.droppedChunks).toBeGreaterThan(0);
        });
    });
});


