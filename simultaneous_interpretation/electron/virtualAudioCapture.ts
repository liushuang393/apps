/**
 * VirtualAudioCapture - Electron 仮想オーディオデバイスキャプチャ
 *
 * 目的:
 *   Electron 環境で仮想オーディオデバイス（VB-CABLE, BlackHole）からの音声キャプチャを実装
 *
 * 機能:
 *   - プラットフォーム固有のデバイス列挙
 *   - 仮想デバイスの検出と選択
 *   - 音声キャプチャストリームの管理
 *   - デバイスホットプラグ処理
 */

import { desktopCapturer } from 'electron';

/**
 * 仮想デバイス情報
 */
export interface VirtualDeviceInfo {
    /** デバイス ID */
    id: string;
    /** デバイス名 */
    name: string;
    /** デバイスタイプ */
    type: 'vb-cable' | 'blackhole' | 'other';
    /** プラットフォーム */
    platform: 'windows' | 'macos';
}

/**
 * VirtualAudioCapture クラス
 */
export class VirtualAudioCapture {
    private platform: 'windows' | 'macos' | 'unknown';
    private selectedDevice: VirtualDeviceInfo | null = null;
    private mediaStream: MediaStream | null = null;

    /**
     * コンストラクタ
     */
    constructor() {
        this.platform = this.detectPlatform();
        console.log('[VirtualAudioCapture] 初期化 - プラットフォーム:', this.platform);
    }

    /**
     * プラットフォームを検出
     */
    private detectPlatform(): 'windows' | 'macos' | 'unknown' {
        const platform = process.platform;
        if (platform === 'win32') {
            return 'windows';
        } else if (platform === 'darwin') {
            return 'macos';
        }
        return 'unknown';
    }

    /**
     * 仮想デバイスを検出
     *
     * @returns 検出された仮想デバイスのリスト
     */
    async detectVirtualDevices(): Promise<VirtualDeviceInfo[]> {
        console.log('[VirtualAudioCapture] 仮想デバイスを検出中...');

        try {
            // desktopCapturer で音声ソースを取得
            const sources = await desktopCapturer.getSources({
                types: ['window', 'screen'],
                fetchWindowIcons: false
            });

            const virtualDevices: VirtualDeviceInfo[] = [];

            for (const source of sources) {
                const deviceInfo = this.identifyVirtualDevice(source.name, source.id);
                if (deviceInfo) {
                    virtualDevices.push(deviceInfo);
                }
            }

            console.log('[VirtualAudioCapture] 検出完了:', virtualDevices.length, '個');
            return virtualDevices;
        } catch (error) {
            console.error('[VirtualAudioCapture] デバイス検出エラー:', error);
            throw error;
        }
    }

    /**
     * 仮想デバイスを識別
     *
     * @param name - デバイス名
     * @param id - デバイス ID
     * @returns 仮想デバイス情報（仮想デバイスでない場合は null）
     */
    private identifyVirtualDevice(name: string, id: string): VirtualDeviceInfo | null {
        // Windows: VB-CABLE
        if (this.platform === 'windows') {
            if (name.includes('CABLE') || name.includes('VB-Audio')) {
                return {
                    id,
                    name,
                    type: 'vb-cable',
                    platform: 'windows'
                };
            }
        }

        // macOS: BlackHole
        if (this.platform === 'macos') {
            if (name.includes('BlackHole')) {
                return {
                    id,
                    name,
                    type: 'blackhole',
                    platform: 'macos'
                };
            }
        }

        return null;
    }

    /**
     * 推奨仮想デバイスを取得
     *
     * @param devices - デバイスリスト
     * @returns 推奨デバイス
     */
    getRecommendedDevice(devices: VirtualDeviceInfo[]): VirtualDeviceInfo | null {
        if (devices.length === 0) {
            return null;
        }

        // プラットフォーム固有の推奨デバイスを選択
        if (this.platform === 'windows') {
            // Windows: "CABLE Output" を優先
            const cableOutput = devices.find((d) => d.name.includes('CABLE Output'));
            if (cableOutput) {
                return cableOutput;
            }

            // それ以外の VB-CABLE デバイス
            const vbCable = devices.find((d) => d.type === 'vb-cable');
            if (vbCable) {
                return vbCable;
            }
        }

        if (this.platform === 'macos') {
            // macOS: "BlackHole 2ch" を優先
            const blackHole2ch = devices.find((d) => d.name.includes('BlackHole 2ch'));
            if (blackHole2ch) {
                return blackHole2ch;
            }

            // それ以外の BlackHole デバイス
            const blackHole = devices.find((d) => d.type === 'blackhole');
            if (blackHole) {
                return blackHole;
            }
        }

        // デフォルト: 最初のデバイス
        return devices[0] || null;
    }

    /**
     * デバイスを選択
     *
     * @param device - デバイス情報
     */
    selectDevice(device: VirtualDeviceInfo): void {
        console.log('[VirtualAudioCapture] デバイス選択:', device.name);
        this.selectedDevice = device;
    }

    /**
     * キャプチャを開始
     *
     * @returns MediaStream
     */
    async startCapture(): Promise<MediaStream> {
        if (!this.selectedDevice) {
            throw new Error('デバイスが選択されていません');
        }

        console.log('[VirtualAudioCapture] キャプチャ開始:', this.selectedDevice.name);

        try {
            // getUserMedia で音声をキャプチャ
            const constraints = {
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: this.selectedDevice.id
                    }
                } as any,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: this.selectedDevice.id
                    }
                } as any
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            // 音声トラックのみを保持
            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();

            // ビデオトラックを停止
            videoTracks.forEach((track: MediaStreamTrack) => {
                console.log('[VirtualAudioCapture] ビデオトラック停止:', track.label);
                track.stop();
            });

            if (audioTracks.length === 0) {
                console.warn(
                    '[VirtualAudioCapture] 音声トラックがありません（会議が開始されていない可能性）'
                );
            } else {
                console.log('[VirtualAudioCapture] 音声トラック取得:', audioTracks.length, '個');
            }

            this.mediaStream = stream;
            return stream;
        } catch (error) {
            console.error('[VirtualAudioCapture] キャプチャ開始エラー:', error);
            throw error;
        }
    }

    /**
     * キャプチャを停止
     */
    stopCapture(): void {
        console.log('[VirtualAudioCapture] キャプチャ停止');

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track: MediaStreamTrack) => {
                console.log('[VirtualAudioCapture] トラック停止:', track.label);
                track.stop();
            });
            this.mediaStream = null;
        }
    }

    /**
     * 選択されたデバイスを取得
     */
    getSelectedDevice(): VirtualDeviceInfo | null {
        return this.selectedDevice;
    }

    /**
     * MediaStream を取得
     */
    getMediaStream(): MediaStream | null {
        return this.mediaStream;
    }

    /**
     * インストールガイドを取得
     *
     * @returns インストールガイド
     */
    getInstallationGuide(): string {
        if (this.platform === 'windows') {
            return `
VB-CABLE のインストール手順:

1. VB-CABLE をダウンロード
   https://vb-audio.com/Cable/

2. ダウンロードした ZIP ファイルを解凍

3. VBCABLE_Setup_x64.exe を右クリック → 管理者として実行

4. インストール完了後、システムを再起動（推奨）

5. Teams の設定:
   - Teams を開く
   - 設定 → デバイス
   - スピーカー = "CABLE Input (VB-Audio Virtual Cable)" を選択

6. 本アプリで "CABLE Output" を選択
            `.trim();
        }

        if (this.platform === 'macos') {
            return `
BlackHole のインストール手順:

1. Homebrew でインストール（推奨）:
   brew install blackhole-2ch

   または、公式サイトからダウンロード:
   https://existential.audio/blackhole/

2. インストール完了後、システムを再起動（必要な場合）

3. Teams の設定:
   - Teams を開く
   - 設定 → デバイス
   - スピーカー = "BlackHole 2ch" を選択

4. 本アプリで "BlackHole" を選択

5. モニターが必要な場合:
   - Audio MIDI Setup を開く
   - "+" → "マルチ出力デバイスを作成"
   - "BlackHole 2ch" と "内蔵出力" を選択
   - "内蔵出力" をマスターデバイスに設定
   - "ドリフト補正" を有効化
            `.trim();
        }

        return 'このプラットフォームはサポートされていません';
    }

    /**
     * クリーンアップ
     */
    dispose(): void {
        console.log('[VirtualAudioCapture] クリーンアップ');
        this.stopCapture();
        this.selectedDevice = null;
    }
}
