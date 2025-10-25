/**
 * AudioManager.ts
 *
 * 目的: 音声入力・出力の管理
 *
 * 機能:
 *   - 音声入力管理（マイク、システム音声）
 *   - AudioContext 管理
 *   - 音声再生管理
 *   - VAD 統合
 *   - 音声データ処理
 *
 * 注意:
 *   - ブラウザ環境とElectron環境の両方に対応
 *   - AudioWorklet を優先使用、フォールバックで ScriptProcessorNode
 */

import { CONFIG, getAudioPreset } from './Config';
import { VoiceActivityDetector } from './VAD';
import * as Utils from './Utils';
import type { ElectronAPI } from '../types/electron';

type DisplayMediaDevices = MediaDevices & {
    getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
};

type ElectronSystemAudioAPI = {
    getSystemAudioStream: (sourceId?: string) => Promise<MediaStream>;
};

const isElectronSystemAudioAPI = (
    api: ElectronAPI | undefined
): api is ElectronAPI & ElectronSystemAudioAPI => {
    return typeof (api as ElectronSystemAudioAPI | undefined)?.getSystemAudioStream === 'function';
};

/**
 * 音声ソースタイプ
 */
export type AudioSourceType = 'microphone' | 'system';

/**
 * 音声制約設定
 */
export interface AudioConstraints {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
}

/**
 * 音声データコールバック
 */
export type AudioDataCallback = (audioData: Float32Array) => void;

/**
 * AudioManager クラス
 *
 * 目的: 音声入力・出力を管理
 */
export class AudioManager {
    // AudioContext
    private audioContext: AudioContext | null = null;
    private outputAudioContext: AudioContext | null = null;

    // MediaStream
    private mediaStream: MediaStream | null = null;

    // Audio Nodes
    private audioSource: MediaStreamAudioSourceNode | null = null;
    private inputGainNode: GainNode | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private processor: ScriptProcessorNode | null = null;

    // VAD
    private vad: VoiceActivityDetector | null = null;

    // 音声再生キュー
    private audioQueue: string[] = [];
    private playbackQueue: string[] = [];
    private isPlayingFromQueue: boolean = false;

    // 設定
    private outputVolume: number = 2.0;
    private inputAudioOutputEnabled: boolean = true;
    private isPlayingAudio: boolean = false;

    // コールバック
    private audioDataCallback: AudioDataCallback | null = null;

    private getAudioContextConstructor(): typeof AudioContext {
        if (typeof window === 'undefined') {
            throw new Error('AudioContext is not available in this environment');
        }

        const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
        if (!AudioContextCtor) {
            throw new Error('AudioContext is not supported by this browser');
        }

        return AudioContextCtor;
    }

    /**
     * VAD を設定
     */
    setVAD(vad: VoiceActivityDetector): void {
        this.vad = vad;
    }

    /**
     * 音声データコールバックを設定
     */
    setAudioDataCallback(callback: AudioDataCallback): void {
        this.audioDataCallback = callback;
    }

    /**
     * 出力音量を設定
     */
    setOutputVolume(volume: number): void {
        this.outputVolume = volume;
    }

    /**
     * 入力音声出力を設定
     */
    setInputAudioOutputEnabled(enabled: boolean): void {
        this.inputAudioOutputEnabled = enabled;

        // 録音中の場合、ゲインを更新
        if (this.inputGainNode) {
            this.inputGainNode.gain.value = enabled ? 1.0 : 0.0;
            console.info('[AudioManager] 入力音声出力:', enabled ? 'ON' : 'OFF');
        }
    }

    /**
     * マイクキャプチャを開始
     */
    async startMicrophoneCapture(constraints: AudioConstraints): Promise<void> {
        console.info('[AudioManager] マイクキャプチャを開始...');

        const audioConstraints = {
            audio: {
                channelCount: 1,
                sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
                echoCancellation: constraints.echoCancellation,
                noiseSuppression: constraints.noiseSuppression,
                autoGainControl: constraints.autoGainControl
            }
        };

        console.info('[AudioManager] マイクアクセス要求中...', audioConstraints);

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
            console.info('[AudioManager] マイクアクセス取得成功');
        } catch (error: unknown) {
            console.error('[AudioManager] マイクアクセス取得失敗:', error);

            if (error instanceof DOMException && error.name === 'NotAllowedError') {
                throw new Error(
                    'マイク権限が拒否されました。ブラウザの設定からマイクへのアクセスを許可してください。'
                );
            } else if (error instanceof DOMException && error.name === 'NotFoundError') {
                throw new Error(
                    'マイクが見つかりません。マイクが接続されているか確認してください。'
                );
            } else {
                throw error instanceof Error ? error : new Error('マイクアクセスに失敗しました');
            }
        }
    }

    /**
     * システム音声キャプチャを開始（ブラウザ環境）
     */
    async startBrowserSystemAudioCapture(): Promise<void> {
        console.info('[AudioManager] ブラウザ環境でシステム音声をキャプチャ...');

        try {
            const mediaDevices = navigator.mediaDevices as DisplayMediaDevices;
            if (!mediaDevices.getDisplayMedia) {
                throw new Error('このブラウザはシステム音声キャプチャに対応していません');
            }

            const stream = await mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    channelCount: 1,
                    sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            this.mediaStream = stream;

            // 音声トラックの監視
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0) {
                const [audioTrack] = audioTracks;
                if (audioTrack) {
                    audioTrack.addEventListener('ended', () => {
                        console.error('[AudioManager] 音声トラックが停止しました');
                    });
                }
            }

            console.info('[AudioManager] システム音声キャプチャ成功');
        } catch (error) {
            console.error('[AudioManager] システム音声キャプチャ失敗:', error);
            throw new Error('システム音声のキャプチャに失敗しました');
        }
    }

    /**
     * タブ音声キャプチャを開始（Chrome拡張機能）
     */
    async startTabAudioCapture(): Promise<void> {
        console.info('[AudioManager] タブ音声キャプチャを開始...');

        try {
            // Chrome拡張機能のtabCaptureを使用
            const stream = await new Promise<MediaStream>((resolve, reject) => {
                if (typeof chrome !== 'undefined' && chrome.tabCapture) {
                    chrome.tabCapture.capture(
                        {
                            audio: true,
                            video: false
                        },
                        (stream) => {
                            if (stream) {
                                resolve(stream);
                            } else {
                                reject(new Error('タブ音声のキャプチャに失敗しました'));
                            }
                        }
                    );
                } else {
                    reject(new Error('chrome.tabCapture が利用できません'));
                }
            });

            this.mediaStream = stream;

            // 音声トラックの監視
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0 && audioTracks[0]) {
                audioTracks[0].addEventListener('ended', () => {
                    console.error('[AudioManager] 音声トラックが停止しました');
                });
            }

            console.info('[AudioManager] タブ音声キャプチャ成功');
        } catch (error) {
            console.error('[AudioManager] タブ音声キャプチャ失敗:', error);
            throw error;
        }
    }

    /**
     * Electron環境でシステム音声キャプチャを開始
     */
    async startElectronSystemAudioCapture(sourceId?: string): Promise<void> {
        console.info('[AudioManager] Electron環境でシステム音声をキャプチャ...');

        const electronAPI = window.electronAPI;
        if (!isElectronSystemAudioAPI(electronAPI)) {
            throw new Error('Electron API が利用できません');
        }

        try {
            const stream = await electronAPI.getSystemAudioStream(sourceId);

            // 音声トラックがない場合は待機
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                console.warn(
                    '[AudioManager] 音声トラックがまだありません。音声が開始されるまで待機します。'
                );

                // ストリーム全体を保存
                this.mediaStream = stream;

                // 音声トラックが追加されたときのリスナーを設定
                await new Promise<void>((resolve) => {
                    const checkInterval = setInterval(() => {
                        const tracks = stream.getAudioTracks();
                        if (tracks.length > 0) {
                            clearInterval(checkInterval);
                            console.info('[AudioManager] 音声トラックが追加されました');
                            resolve();
                        }
                    }, 100);
                });
            } else {
                this.mediaStream = stream;
                console.info('[AudioManager] Electronシステム音声キャプチャ成功');
            }
        } catch (error) {
            console.error('[AudioManager] Electronシステム音声キャプチャ失敗:', error);
            throw error;
        }
    }

    /**
     * 音声処理をセットアップ
     */
    async setupAudioProcessing(): Promise<void> {
        if (!this.mediaStream) {
            throw new Error('MediaStream が初期化されていません');
        }

        console.info('[AudioManager] 音声処理をセットアップ中...');

        // AudioContext設定
        const AudioContextCtor = this.getAudioContextConstructor();
        this.audioContext = new AudioContextCtor({
            sampleRate: CONFIG.AUDIO.SAMPLE_RATE
        });

        // AudioContextがサスペンドされている場合、再開
        if (this.audioContext.state === 'suspended') {
            console.info('[AudioManager] AudioContextがサスペンド状態です。再開します...');
            await this.audioContext.resume();
            console.info('[AudioManager] AudioContext再開完了:', this.audioContext.state);
        }

        // 音声トラックがあるか確認
        const audioTracks = this.mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn(
                '[AudioManager] 音声トラックがまだありません。音声が開始されるまで待機します。'
            );

            // 音声トラックが追加されるまで待機
            await new Promise<void>((resolve) => {
                const checkAudioTrack = () => {
                    const tracks = this.mediaStream!.getAudioTracks();
                    if (tracks.length > 0) {
                        console.info(
                            '[AudioManager] 音声トラックが検出されました。処理を開始します。'
                        );
                        resolve();
                    } else {
                        setTimeout(checkAudioTrack, 100);
                    }
                };
                checkAudioTrack();
            });
        }

        console.info('[AudioManager] 音声処理を開始...');

        // MediaStreamSource を作成
        this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);

        // VADリセット
        if (this.vad) {
            this.vad.reset();
        }

        try {
            // AudioWorklet を使用（推奨）
            await this.setupAudioWorklet();
        } catch (error) {
            console.warn(
                '[AudioManager] AudioWorklet使用失敗、ScriptProcessorNodeにフォールバック:',
                error
            );
            // フォールバック: ScriptProcessorNode を使用
            this.setupScriptProcessor();
        }
    }

    /**
     * AudioWorklet をセットアップ
     */
    private async setupAudioWorklet(): Promise<void> {
        if (!this.audioContext || !this.audioSource) {
            throw new Error('AudioContext または AudioSource が初期化されていません');
        }

        // AudioWorklet をロード
        await this.audioContext.audioWorklet.addModule('audio-processor-worklet.js');

        // AudioWorkletNode を作成
        this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor-worklet');

        // メッセージハンドラーを設定
        this.workletNode.port.onmessage = (event) => {
            if (event.data.type === 'audiodata') {
                this.processAudioData(event.data.data);
            }
        };

        // 音声チェーンを接続
        this.audioSource.connect(this.workletNode);

        // GainNodeを作成して入力音声のミュート制御
        this.inputGainNode = this.audioContext.createGain();
        this.inputGainNode.gain.value = this.inputAudioOutputEnabled ? 1.0 : 0.0;

        // 音声チェーン: workletNode → inputGainNode → destination
        this.workletNode.connect(this.inputGainNode);
        this.inputGainNode.connect(this.audioContext.destination);

        console.info(
            '[AudioManager] AudioWorklet を使用して音声処理を開始しました（入力音声出力:',
            this.inputAudioOutputEnabled ? 'ON' : 'OFF',
            ')'
        );
    }

    /**
     * ScriptProcessorNode をセットアップ（フォールバック）
     */
    private setupScriptProcessor(): void {
        if (!this.audioContext || !this.audioSource) {
            throw new Error('AudioContext または AudioSource が初期化されていません');
        }

        const preset = getAudioPreset();
        this.processor = this.audioContext.createScriptProcessor(preset.BUFFER_SIZE, 1, 1);

        // 音声データ処理
        this.processor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            this.processAudioData(inputData);
        };

        // 音声チェーンを接続
        this.audioSource.connect(this.processor);

        // GainNodeを作成して入力音声のミュート制御
        this.inputGainNode = this.audioContext.createGain();
        this.inputGainNode.gain.value = this.inputAudioOutputEnabled ? 1.0 : 0.0;

        // 音声チェーン: processor → inputGainNode → destination
        this.processor.connect(this.inputGainNode);
        this.inputGainNode.connect(this.audioContext.destination);

        console.info(
            '[AudioManager] ScriptProcessorNode を使用して音声処理を開始しました（入力音声出力:',
            this.inputAudioOutputEnabled ? 'ON' : 'OFF',
            ')'
        );
    }

    /**
     * 音声データを処理
     */
    private processAudioData(audioData: Float32Array): void {
        // VAD分析
        if (this.vad) {
            this.vad.analyze(audioData);
        }

        // コールバックを呼び出し
        if (this.audioDataCallback) {
            this.audioDataCallback(audioData);
        }
    }

    /**
     * 録音を停止
     */
    async stopRecording(): Promise<void> {
        console.info('[AudioManager] 停止処理開始');

        // MediaStream を停止
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
            this.mediaStream = null;
        }

        // MediaStreamSource のクリーンアップ
        if (this.audioSource) {
            this.audioSource.disconnect();
            this.audioSource = null;
            console.info('[AudioManager] MediaStreamSource をクリーンアップしました');
        }

        // GainNode のクリーンアップ
        if (this.inputGainNode) {
            this.inputGainNode.disconnect();
            this.inputGainNode = null;
            console.info('[AudioManager] GainNode をクリーンアップしました');
        }

        // AudioWorkletNode のクリーンアップ
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'stop' });
            this.workletNode.disconnect();
            this.workletNode = null;
            console.info('[AudioManager] AudioWorkletNode をクリーンアップしました');
        }

        // ScriptProcessorNode のクリーンアップ
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
            console.info('[AudioManager] ScriptProcessorNode をクリーンアップしました');
        }

        // AudioContext のクリーンアップ
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }

        console.info('[AudioManager] 停止処理完了');
    }

    /**
     * 音声をキューに追加
     */
    enqueueAudio(base64Audio: string): void {
        this.audioQueue.push(base64Audio);
    }

    /**
     * 音声キューを処理
     */
    processAudioQueue(): void {
        if (this.audioQueue.length === 0) {
            console.info('[AudioManager] 音声キューが空です');
            return;
        }

        // すべての音声チャンクを結合
        const combinedAudio = this.audioQueue.join('');
        this.audioQueue = [];

        // 再生キューに追加
        this.playbackQueue.push(combinedAudio);

        console.info('[AudioManager] 音声を再生キューに追加:', {
            playbackQueueLength: this.playbackQueue.length,
            isPlayingFromQueue: this.isPlayingFromQueue
        });

        // キューから再生中でない場合は再生開始
        if (!this.isPlayingFromQueue) {
            this.playNextInQueue();
        }
    }

    /**
     * キューから次の音声を再生
     */
    private playNextInQueue(): void {
        if (this.playbackQueue.length === 0) {
            console.info('[AudioManager] 再生キューが空です');
            this.isPlayingFromQueue = false;
            return;
        }

        this.isPlayingFromQueue = true;

        // キューから音声を取り出し
        const audioData = this.playbackQueue.shift()!;

        console.info('[AudioManager] キューから音声を再生:', {
            remainingInQueue: this.playbackQueue.length
        });

        // 音声を再生（await しない - 非同期で開始）
        this.playAudio(audioData).catch((error) => {
            console.error('[AudioManager] 再生エラー:', error);
            // エラーが発生しても次の音声を再生
            this.playNextInQueue();
        });
    }

    /**
     * 音声を再生
     */
    async playAudio(base64Audio: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                // ループバック防止
                if (this.isPlayingAudio) {
                    console.info('[AudioManager] 音声再生中のため、入力音声をミュート');
                }

                // 出力専用AudioContextが存在しない場合は作成
                if (!this.outputAudioContext) {
                    const AudioContextCtor = this.getAudioContextConstructor();
                    this.outputAudioContext = new AudioContextCtor({
                        sampleRate: CONFIG.AUDIO.SAMPLE_RATE
                    });
                    console.info('[AudioManager] 出力専用AudioContextを作成しました');
                }

                // AudioContextがsuspended状態の場合はresume
                if (this.outputAudioContext.state === 'suspended') {
                    await this.outputAudioContext.resume();
                    console.info('[AudioManager] AudioContextをresumeしました');
                }

                // Base64 → ArrayBuffer → Float32Array
                const arrayBuffer = Utils.base64ToArrayBuffer(base64Audio);
                const int16Array = new Int16Array(arrayBuffer);
                const float32Array = new Float32Array(int16Array.length);

                for (let i = 0; i < int16Array.length; i++) {
                    const value = int16Array[i];
                    if (value !== undefined) {
                        float32Array[i] = value / 32768.0;
                    }
                }

                // AudioBufferを作成
                const audioBuffer = this.outputAudioContext.createBuffer(
                    1, // モノラル
                    float32Array.length,
                    CONFIG.AUDIO.SAMPLE_RATE
                );
                audioBuffer.getChannelData(0).set(float32Array);

                // 音量調整用のGainNodeを作成
                const gainNode = this.outputAudioContext.createGain();
                gainNode.gain.value = this.outputVolume;

                // 再生
                const source = this.outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;

                // 音声チェーン: source → gainNode → destination
                source.connect(gainNode);
                gainNode.connect(this.outputAudioContext.destination);

                // 再生終了時にフラグをOFF
                source.onended = () => {
                    this.isPlayingAudio = false;
                    console.info('[AudioManager] 音声再生完了');

                    // 次の音声を再生
                    this.playNextInQueue();

                    resolve();
                };

                // 再生開始
                this.isPlayingAudio = true;
                source.start(0);

                console.info('[AudioManager] 音声再生開始');
            } catch (error) {
                console.error('[AudioManager] 音声再生エラー:', error);
                this.isPlayingAudio = false;
                reject(error);
            }
        });
    }

    /**
     * 音声再生キューをクリア
     */
    clearAudioQueue(): void {
        this.audioQueue = [];
        this.playbackQueue = [];
        this.isPlayingFromQueue = false;
        console.info('[AudioManager] 音声キューをクリアしました');
    }
}
