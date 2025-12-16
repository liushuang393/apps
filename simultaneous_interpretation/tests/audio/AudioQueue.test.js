/**
 * AudioQueue 单元测试
 *
 * @author VoiceTranslate Pro Team
 * @version 2.1.0
 */

describe('AudioSegment', () => {
    let AudioSegment;

    beforeAll(() => {
        // 动态加载模块
        const module = require('../../voicetranslate-audio-queue.js');
        AudioSegment = module.AudioSegment;
    });

    describe('constructor', () => {
        it('should create a segment with unique ID', () => {
            const audioData = new ArrayBuffer(1000);
            const segment = new AudioSegment(audioData, {
                duration: 5000,
                language: 'en'
            });

            expect(segment.id).toMatch(/^seg_\d+_[a-z0-9]+$/);
            expect(segment.audio).toBe(audioData);
            expect(segment.metadata.duration).toBe(5000);
            expect(segment.metadata.language).toBe('en');
        });

        it('should initialize with default values', () => {
            const segment = new AudioSegment(new ArrayBuffer(100), {});

            expect(segment.metadata.duration).toBe(0);
            expect(segment.metadata.language).toBe(null);
            expect(segment.processingStatus.path1_text).toBe(0);
            expect(segment.processingStatus.path2_voice).toBe(0);
        });

        it('should set timestamp automatically', () => {
            const before = Date.now();
            const segment = new AudioSegment(new ArrayBuffer(100), {});
            const after = Date.now();

            expect(segment.metadata.timestamp).toBeGreaterThanOrEqual(before);
            expect(segment.metadata.timestamp).toBeLessThanOrEqual(after);
        });
    });

    describe('markPathComplete', () => {
        let segment;

        beforeEach(() => {
            segment = new AudioSegment(new ArrayBuffer(100), {
                duration: 3000
            });
        });

        it('should mark path1 as complete', () => {
            segment.markPathComplete('path1', { transcript: 'Hello' });

            expect(segment.processingStatus.path1_text).toBe(1);
            expect(segment.results.path1).toEqual({ transcript: 'Hello' });
        });

        it('should mark path2 as complete', () => {
            segment.markPathComplete('path2', { audio: 'data', text: 'こんにちは' });

            expect(segment.processingStatus.path2_voice).toBe(1);
            expect(segment.results.path2).toEqual({ audio: 'data', text: 'こんにちは' });
        });

        it('should throw error for invalid path name', () => {
            expect(() => {
                segment.markPathComplete('path3', {});
            }).toThrow('無効なパス名: path3');
        });

        it('should allow null result', () => {
            segment.markPathComplete('path1', null);

            expect(segment.processingStatus.path1_text).toBe(1);
            expect(segment.results.path1).toBe(null);
        });
    });

    describe('isFullyProcessed', () => {
        let segment;

        beforeEach(() => {
            segment = new AudioSegment(new ArrayBuffer(100), {});
        });

        it('should return false when no paths are complete', () => {
            expect(segment.isFullyProcessed()).toBe(false);
        });

        it('should return false when only path1 is complete', () => {
            segment.markPathComplete('path1', {});
            expect(segment.isFullyProcessed()).toBe(false);
        });

        it('should return false when only path2 is complete', () => {
            segment.markPathComplete('path2', {});
            expect(segment.isFullyProcessed()).toBe(false);
        });

        it('should return true when both paths are complete', () => {
            segment.markPathComplete('path1', {});
            segment.markPathComplete('path2', {});
            expect(segment.isFullyProcessed()).toBe(true);
        });
    });

    describe('getProgress', () => {
        let segment;

        beforeEach(() => {
            segment = new AudioSegment(new ArrayBuffer(100), {});
        });

        it('should return 0 when no paths are complete', () => {
            expect(segment.getProgress()).toBe(0);
        });

        it('should return 0.5 when one path is complete', () => {
            segment.markPathComplete('path1', {});
            expect(segment.getProgress()).toBe(0.5);
        });

        it('should return 1 when both paths are complete', () => {
            segment.markPathComplete('path1', {});
            segment.markPathComplete('path2', {});
            expect(segment.getProgress()).toBe(1);
        });
    });

    describe('getDuration', () => {
        it('should return metadata duration', () => {
            const segment = new AudioSegment(new ArrayBuffer(100), {
                duration: 5000
            });
            expect(segment.getDuration()).toBe(5000);
        });
    });

    describe('getAge', () => {
        it('should calculate age correctly', (done) => {
            const segment = new AudioSegment(new ArrayBuffer(100), {});

            setTimeout(() => {
                const age = segment.getAge();
                expect(age).toBeGreaterThanOrEqual(100);
                expect(age).toBeLessThan(200);
                done();
            }, 100);
        });
    });

    describe('getSummary', () => {
        it('should return complete summary', () => {
            const segment = new AudioSegment(new ArrayBuffer(100), {
                duration: 3000,
                language: 'ja'
            });

            segment.markPathComplete('path1', {});

            const summary = segment.getSummary();

            expect(summary.id).toBe(segment.id);
            expect(summary.duration).toBe(3000);
            expect(summary.language).toBe('ja');
            expect(summary.progress).toBe(0.5);
            expect(summary.path1Status).toBe(1);
            expect(summary.path2Status).toBe(0);
            expect(summary.fullyProcessed).toBe(false);
        });
    });
});

describe('AudioQueue', () => {
    let AudioQueue;

    beforeAll(() => {
        const module = require('../../voicetranslate-audio-queue.js');
        AudioQueue = module.AudioQueue;
    });

    describe('constructor', () => {
        it('should create queue with default options', () => {
            const queue = new AudioQueue();

            expect(queue.config.maxSegmentDuration).toBe(15000);
            expect(queue.config.minSegmentDuration).toBe(1000);
            expect(queue.config.maxQueueSize).toBe(20);
            expect(queue.config.cleanupDelay).toBe(1000);
        });

        it('should create queue with custom options', () => {
            const queue = new AudioQueue({
                maxSegmentDuration: 10000,
                minSegmentDuration: 500,
                maxQueueSize: 10,
                cleanupDelay: 2000
            });

            expect(queue.config.maxSegmentDuration).toBe(10000);
            expect(queue.config.minSegmentDuration).toBe(500);
            expect(queue.config.maxQueueSize).toBe(10);
            expect(queue.config.cleanupDelay).toBe(2000);
        });

        it('should initialize stats', () => {
            const queue = new AudioQueue();

            expect(queue.stats.totalSegments).toBe(0);
            expect(queue.stats.processedSegments).toBe(0);
            expect(queue.stats.droppedSegments).toBe(0);
            expect(queue.stats.currentQueueSize).toBe(0);
        });
    });

    describe('enqueue', () => {
        let queue;

        beforeEach(() => {
            queue = new AudioQueue({
                minSegmentDuration: 1000,
                maxSegmentDuration: 15000,
                maxQueueSize: 5
            });
        });

        it('should add valid segment to queue', () => {
            const audioData = new ArrayBuffer(1000);
            const segment = queue.enqueue(audioData, {
                duration: 3000,
                language: 'en'
            });

            expect(segment).not.toBe(null);
            expect(queue.size()).toBe(1);
            expect(queue.stats.totalSegments).toBe(1);
        });

        it('should reject segment that is too short', () => {
            const segment = queue.enqueue(new ArrayBuffer(100), {
                duration: 500 // < minSegmentDuration (1000)
            });

            expect(segment).toBe(null);
            expect(queue.size()).toBe(0);
            expect(queue.stats.droppedSegments).toBe(1);
        });

        it('should warn for segment that is too long', () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            const segment = queue.enqueue(new ArrayBuffer(1000), {
                duration: 20000 // > maxSegmentDuration (15000)
            });

            expect(segment).not.toBe(null);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('音声が長すぎる'),
                expect.any(Object)
            );

            consoleSpy.mockRestore();
        });

        it('should reject when queue is full', () => {
            // Fill queue to max
            for (let i = 0; i < 5; i++) {
                queue.enqueue(new ArrayBuffer(100), { duration: 2000 });
            }

            // Try to add one more
            const segment = queue.enqueue(new ArrayBuffer(100), { duration: 2000 });

            expect(segment).toBe(null);
            expect(queue.size()).toBe(5);
            expect(queue.stats.droppedSegments).toBe(1);
        });

        it('should trigger onSegmentReady callback', (done) => {
            queue.on('segmentReady', (segment) => {
                expect(segment).not.toBe(null);
                expect(segment.id).toMatch(/^seg_/);
                done();
            });

            queue.enqueue(new ArrayBuffer(100), { duration: 2000 });
        });

        it('should trigger onQueueFull callback', () => {
            const mockCallback = jest.fn();
            queue.on('queueFull', mockCallback);

            // Fill queue to max
            for (let i = 0; i < 5; i++) {
                queue.enqueue(new ArrayBuffer(100), { duration: 2000 });
            }

            // Try to add one more
            queue.enqueue(new ArrayBuffer(100), { duration: 2000 });

            expect(mockCallback).toHaveBeenCalledWith(5);
        });
    });

    describe('getSegment', () => {
        let queue;

        beforeEach(() => {
            queue = new AudioQueue();
        });

        it('should retrieve segment by ID', () => {
            const segment = queue.enqueue(new ArrayBuffer(100), { duration: 2000 });
            const retrieved = queue.getSegment(segment.id);

            expect(retrieved).toBe(segment);
        });

        it('should return undefined for non-existent ID', () => {
            const retrieved = queue.getSegment('non-existent-id');
            expect(retrieved).toBe(undefined);
        });
    });

    describe('markPathComplete', () => {
        let queue;
        let segment;

        beforeEach(() => {
            queue = new AudioQueue();
            segment = queue.enqueue(new ArrayBuffer(100), { duration: 2000 });
        });

        it('should mark path as complete', () => {
            queue.markPathComplete(segment.id, 'path1', { transcript: 'Test' });

            const updated = queue.getSegment(segment.id);
            expect(updated.processingStatus.path1_text).toBe(1);
            expect(updated.results.path1).toEqual({ transcript: 'Test' });
        });

        it('should warn for non-existent segment', () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            queue.markPathComplete('non-existent-id', 'path1', {});

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('セグメントが見つかりません'),
                'non-existent-id'
            );

            consoleSpy.mockRestore();
        });

        it('should trigger cleanup when both paths complete', (done) => {
            jest.useFakeTimers();

            queue.markPathComplete(segment.id, 'path1', {});
            queue.markPathComplete(segment.id, 'path2', {});

            // Fast-forward cleanup delay (1000ms)
            jest.runAllTimers();

            // Check after cleanup
            expect(queue.size()).toBe(0);
            expect(queue.stats.processedSegments).toBe(1);

            jest.useRealTimers();
            done();
        });

        it('should trigger onSegmentComplete callback', () => {
            const mockCallback = jest.fn();
            queue.on('segmentComplete', mockCallback);

            queue.markPathComplete(segment.id, 'path1', {});
            queue.markPathComplete(segment.id, 'path2', {});

            expect(mockCallback).toHaveBeenCalledWith(segment);
        });
    });

    describe('cleanup', () => {
        let queue;

        beforeEach(() => {
            queue = new AudioQueue();
        });

        it('should cleanup fully processed segment', () => {
            const segment = queue.enqueue(new ArrayBuffer(100), { duration: 2000 });

            segment.markPathComplete('path1', {});
            segment.markPathComplete('path2', {});

            queue.cleanup(segment.id);

            expect(queue.size()).toBe(0);
            expect(queue.stats.processedSegments).toBe(1);
        });

        it('should not cleanup incomplete segment', () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            const segment = queue.enqueue(new ArrayBuffer(100), { duration: 2000 });

            queue.cleanup(segment.id);

            expect(queue.size()).toBe(1);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('セグメントは未完了のため削除できません'),
                expect.any(Object)
            );

            consoleSpy.mockRestore();
        });
    });

    describe('getStats', () => {
        let queue;

        beforeEach(() => {
            queue = new AudioQueue();
        });

        it('should return correct stats', () => {
            // Add 3 segments
            for (let i = 0; i < 3; i++) {
                queue.enqueue(new ArrayBuffer(100), { duration: 2000 });
            }

            // Drop 1 segment (too short)
            queue.enqueue(new ArrayBuffer(100), { duration: 500 });

            const stats = queue.getStats();

            expect(stats.totalSegments).toBe(3);
            expect(stats.droppedSegments).toBe(1);
            expect(stats.currentQueueSize).toBe(3);
            expect(stats.successRate).toBe('0.00%'); // None processed yet
        });

        it('should calculate success rate correctly', () => {
            jest.useFakeTimers();

            const segment1 = queue.enqueue(new ArrayBuffer(100), { duration: 2000 });
            const segment2 = queue.enqueue(new ArrayBuffer(100), { duration: 2000 });

            // Complete first segment
            queue.markPathComplete(segment1.id, 'path1', {});
            queue.markPathComplete(segment1.id, 'path2', {});
            jest.advanceTimersByTime(1000);

            const stats = queue.getStats();
            expect(stats.successRate).toBe('50.00%'); // 1 out of 2

            jest.useRealTimers();
        });
    });

    describe('clear', () => {
        let queue;

        beforeEach(() => {
            queue = new AudioQueue();
        });

        it('should clear all segments', () => {
            // Add some segments
            for (let i = 0; i < 3; i++) {
                queue.enqueue(new ArrayBuffer(100), { duration: 2000 });
            }

            queue.clear();

            expect(queue.size()).toBe(0);
            expect(queue.stats.currentQueueSize).toBe(0);
        });
    });

    describe('on', () => {
        let queue;

        beforeEach(() => {
            queue = new AudioQueue();
        });

        it('should set segmentReady listener', () => {
            const callback = jest.fn();
            queue.on('segmentReady', callback);
            expect(queue.listeners.onSegmentReady).toBe(callback);
        });

        it('should set segmentComplete listener', () => {
            const callback = jest.fn();
            queue.on('segmentComplete', callback);
            expect(queue.listeners.onSegmentComplete).toBe(callback);
        });

        it('should set queueFull listener', () => {
            const callback = jest.fn();
            queue.on('queueFull', callback);
            expect(queue.listeners.onQueueFull).toBe(callback);
        });

        it('should throw error for invalid event', () => {
            expect(() => {
                queue.on('invalidEvent', jest.fn());
            }).toThrow('無効なイベント名: invalidEvent');
        });
    });
});

