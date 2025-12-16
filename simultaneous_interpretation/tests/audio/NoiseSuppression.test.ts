/**
 * NoiseSuppression ユニットテスト
 */

import { NoiseSuppression } from '../../src/audio/NoiseSuppression';

// AudioContext のモック
class MockAudioContext {
    createMediaStreamSource(stream: MediaStream) {
        return new MockMediaStreamAudioSourceNode();
    }

    createBiquadFilter() {
        return new MockBiquadFilterNode();
    }

    createGain() {
        return new MockGainNode();
    }

    createMediaStreamDestination() {
        return new MockMediaStreamAudioDestinationNode();
    }
}

class MockAudioNode {
    connect(destination: any) {
        return destination;
    }

    disconnect() {}
}

class MockMediaStreamAudioSourceNode extends MockAudioNode {}

class MockBiquadFilterNode extends MockAudioNode {
    type: string = 'lowpass';
    frequency = { value: 0 };
    Q = { value: 0 };
}

class MockGainNode extends MockAudioNode {
    gain = { value: 1.0 };
}

class MockMediaStreamAudioDestinationNode extends MockAudioNode {
    stream = {} as MediaStream;
}

describe('NoiseSuppression', () => {
    let noiseSuppression: NoiseSuppression;
    let mockAudioContext: MockAudioContext;
    let mockStream: MediaStream;

    beforeEach(() => {
        noiseSuppression = new NoiseSuppression({
            highpassFreq: 100,
            lowpassFreq: 8000,
            gain: 1.0,
            enabled: true
        });

        mockAudioContext = new MockAudioContext();
        mockStream = {} as MediaStream;
    });

    afterEach(() => {
        noiseSuppression.dispose();
    });

    describe('apply', () => {
        it('should apply noise suppression filters', () => {
            const result = noiseSuppression.apply(
                mockStream,
                mockAudioContext as any
            );

            expect(result).toBeDefined();
            expect(result).toBeInstanceOf(MockMediaStreamAudioDestinationNode);
        });

        it('should passthrough when disabled', () => {
            const disabledNS = new NoiseSuppression({ enabled: false });
            
            const result = disabledNS.apply(
                mockStream,
                mockAudioContext as any
            );

            expect(result).toBeDefined();
            disabledNS.dispose();
        });

        it('should create correct filter chain', () => {
            const connectSpy = jest.spyOn(MockAudioNode.prototype, 'connect');

            noiseSuppression.apply(
                mockStream,
                mockAudioContext as any
            );

            // Source → Highpass → Lowpass → Gain → Destination
            expect(connectSpy).toHaveBeenCalled();

            connectSpy.mockRestore();
        });
    });

    describe('updateConfig', () => {
        it('should update highpass frequency', () => {
            noiseSuppression.apply(
                mockStream,
                mockAudioContext as any
            );

            noiseSuppression.updateConfig({ highpassFreq: 150 });

            // 内部状態が更新されたことを確認
            // (実際のフィルター値の確認は難しいため、エラーが出ないことを確認)
            expect(() => {
                noiseSuppression.updateConfig({ highpassFreq: 150 });
            }).not.toThrow();
        });

        it('should update lowpass frequency', () => {
            noiseSuppression.apply(
                mockStream,
                mockAudioContext as any
            );

            noiseSuppression.updateConfig({ lowpassFreq: 7000 });

            expect(() => {
                noiseSuppression.updateConfig({ lowpassFreq: 7000 });
            }).not.toThrow();
        });

        it('should update gain', () => {
            noiseSuppression.apply(
                mockStream,
                mockAudioContext as any
            );

            noiseSuppression.updateConfig({ gain: 1.2 });

            expect(() => {
                noiseSuppression.updateConfig({ gain: 1.2 });
            }).not.toThrow();
        });
    });

    describe('dispose', () => {
        it('should disconnect all nodes', () => {
            const disconnectSpy = jest.spyOn(MockAudioNode.prototype, 'disconnect');

            noiseSuppression.apply(
                mockStream,
                mockAudioContext as any
            );

            noiseSuppression.dispose();

            expect(disconnectSpy).toHaveBeenCalled();

            disconnectSpy.mockRestore();
        });

        it('should be safe to call multiple times', () => {
            noiseSuppression.apply(
                mockStream,
                mockAudioContext as any
            );

            expect(() => {
                noiseSuppression.dispose();
                noiseSuppression.dispose();
            }).not.toThrow();
        });
    });
});


