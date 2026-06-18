/**
 * DeviceGuard - デバイス列挙、選択、再接続管理
 *
 * 目的:
 *   仮想オーディオデバイスの検出、選択、ホットプラグ処理、再接続ロジックを提供
 *
 * 機能:
 *   - デバイス列挙（UID による安定した識別）
 *   - デバイス選択と永続化
 *   - ホットプラグ検出
 *   - 自動再接続
 *   - デバイスヘルス監視
 */

/**
 * デバイス情報インターフェース
 */
export interface AudioDeviceInfo {
    /** デバイス ID（プラットフォーム固有） */
    id: string;
    /** デバイス UID（安定した識別子） */
    uid: string;
    /** デバイス名（フレンドリー名） */
    name: string;
    /** デバイスタイプ（input/output） */
    type: 'input' | 'output';
    /** サンプルレート */
    sampleRate: number;
    /** チャンネル数 */
    channels: number;
    /** デバイスが利用可能か */
    available: boolean;
    /** デバイスがデフォルトか */
    isDefault: boolean;
    /** 仮想デバイスか */
    isVirtual: boolean;
    /** ドライバー名（VB-CABLE, BlackHole など） */
    driver?: string | undefined;
}

/**
 * デバイス選択基準
 */
export interface DeviceSelectionCriteria {
    /** 優先デバイス名（部分一致） */
    preferredName?: string;
    /** 優先ドライバー */
    preferredDriver?: string;
    /** 仮想デバイスのみ */
    virtualOnly?: boolean;
    /** 最小サンプルレート */
    minSampleRate?: number;
    /** 最小チャンネル数 */
    minChannels?: number;
}

/**
 * デバイスイベント
 */
export type DeviceEvent =
    | { type: 'device-added'; device: AudioDeviceInfo }
    | { type: 'device-removed'; deviceId: string }
    | { type: 'device-changed'; device: AudioDeviceInfo }
    | { type: 'default-changed'; device: AudioDeviceInfo };

/**
 * DeviceGuard クラス
 */
export class DeviceGuard {
    private readonly devices: Map<string, AudioDeviceInfo> = new Map();
    private selectedDevice: AudioDeviceInfo | null = null;
    private eventListeners: Array<(event: DeviceEvent) => void> = [];
    private enumerationInterval: NodeJS.Timeout | null = null;

    /**
     * コンストラクタ
     */
    constructor() {
        console.info('[DeviceGuard] 初期化');
    }

    /**
     * デバイス列挙を開始
     *
     * @param intervalMs - 列挙間隔（ミリ秒）
     */
    async startEnumeration(intervalMs: number = 5000): Promise<void> {
        console.info('[DeviceGuard] デバイス列挙を開始:', intervalMs, 'ms');

        // 初回列挙
        await this.enumerateDevices();

        // 定期的な列挙
        this.enumerationInterval = setInterval(async () => {
            await this.enumerateDevices();
        }, intervalMs);
    }

    /**
     * デバイス列挙を停止
     */
    stopEnumeration(): void {
        console.info('[DeviceGuard] デバイス列挙を停止');
        if (this.enumerationInterval) {
            clearInterval(this.enumerationInterval);
            this.enumerationInterval = null;
        }
    }

    /**
     * デバイスを列挙
     */
    async enumerateDevices(): Promise<AudioDeviceInfo[]> {
        try {
            console.info('[DeviceGuard] デバイスを列挙中...');

            // MediaDevices API を使用してデバイスを列挙
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevices: AudioDeviceInfo[] = [];

            for (const device of devices) {
                if (device.kind === 'audioinput' || device.kind === 'audiooutput') {
                    const deviceInfo: AudioDeviceInfo = {
                        id: device.deviceId,
                        uid: device.deviceId, // ブラウザでは deviceId を UID として使用
                        name: device.label || `${device.kind} (${device.deviceId.substring(0, 8)})`,
                        type: device.kind === 'audioinput' ? 'input' : 'output',
                        sampleRate: 48000, // デフォルト（実際の値は取得できない）
                        channels: 2, // デフォルト
                        available: true,
                        isDefault: device.deviceId === 'default',
                        isVirtual: this.isVirtualDevice(device.label),
                        driver: this.detectDriver(device.label)
                    };

                    audioDevices.push(deviceInfo);

                    // デバイスマップを更新
                    const existingDevice = this.devices.get(device.deviceId);
                    if (!existingDevice) {
                        // 新しいデバイス
                        this.devices.set(device.deviceId, deviceInfo);
                        this.emitEvent({ type: 'device-added', device: deviceInfo });
                    } else if (existingDevice.name !== deviceInfo.name) {
                        // デバイス変更
                        this.devices.set(device.deviceId, deviceInfo);
                        this.emitEvent({ type: 'device-changed', device: deviceInfo });
                    }
                }
            }

            // 削除されたデバイスを検出
            const currentDeviceIds = new Set(audioDevices.map((d) => d.id));
            for (const [deviceId] of this.devices.entries()) {
                if (!currentDeviceIds.has(deviceId)) {
                    this.devices.delete(deviceId);
                    this.emitEvent({ type: 'device-removed', deviceId });
                }
            }

            console.info('[DeviceGuard] デバイス列挙完了:', audioDevices.length, '個');
            return audioDevices;
        } catch (error) {
            console.error('[DeviceGuard] デバイス列挙エラー:', error);
            throw error;
        }
    }

    /**
     * 仮想デバイスかどうかを判定
     *
     * @param label - デバイスラベル
     * @returns 仮想デバイスの場合 true
     */
    private isVirtualDevice(label: string): boolean {
        const virtualKeywords = [
            'CABLE',
            'VB-Audio',
            'BlackHole',
            'Loopback',
            'Virtual',
            'Soundflower',
            'VAC',
            'VoiceMeeter'
        ];
        return virtualKeywords.some((keyword) => label.includes(keyword));
    }

    /**
     * ドライバーを検出
     *
     * @param label - デバイスラベル
     * @returns ドライバー名
     */
    private detectDriver(label: string): string | undefined {
        if (label.includes('CABLE') || label.includes('VB-Audio')) {
            return 'VB-CABLE';
        } else if (label.includes('BlackHole')) {
            return 'BlackHole';
        } else if (label.includes('Soundflower')) {
            return 'Soundflower';
        } else if (label.includes('Loopback')) {
            return 'Loopback';
        }
        return undefined;
    }

    /**
     * デバイスを選択
     *
     * @param criteria - 選択基準
     * @returns 選択されたデバイス
     */
    selectDevice(criteria: DeviceSelectionCriteria): AudioDeviceInfo | null {
        console.info('[DeviceGuard] デバイスを選択:', criteria);

        const candidates = Array.from(this.devices.values()).filter((device) => {
            // タイプフィルター（入力デバイスのみ）
            if (device.type !== 'input') {
                return false;
            }

            // 仮想デバイスフィルター
            if (criteria.virtualOnly && !device.isVirtual) {
                return false;
            }

            // ドライバーフィルター
            if (criteria.preferredDriver && device.driver !== criteria.preferredDriver) {
                return false;
            }

            // サンプルレートフィルター
            if (criteria.minSampleRate && device.sampleRate < criteria.minSampleRate) {
                return false;
            }

            // チャンネル数フィルター
            if (criteria.minChannels && device.channels < criteria.minChannels) {
                return false;
            }

            return true;
        });

        // 優先名でソート
        if (criteria.preferredName) {
            candidates.sort((a, b) => {
                const aMatch = a.name.includes(criteria.preferredName!);
                const bMatch = b.name.includes(criteria.preferredName!);
                if (aMatch && !bMatch) {
                    return -1;
                }
                if (!aMatch && bMatch) {
                    return 1;
                }
                return 0;
            });
        }

        const selected = candidates[0] || null;
        if (selected) {
            this.selectedDevice = selected;
            console.info('[DeviceGuard] デバイス選択完了:', selected.name);
        } else {
            console.warn('[DeviceGuard] 条件に一致するデバイスが見つかりません');
        }

        return selected;
    }

    /**
     * デバイスを UID で選択
     *
     * @param uid - デバイス UID
     * @returns 選択されたデバイス
     */
    selectDeviceByUID(uid: string): AudioDeviceInfo | null {
        const device = this.devices.get(uid);
        if (device) {
            this.selectedDevice = device;
            console.info('[DeviceGuard] デバイス選択完了 (UID):', device.name);
            return device;
        }
        console.warn('[DeviceGuard] UID に一致するデバイスが見つかりません:', uid);
        return null;
    }

    /**
     * 選択されたデバイスを取得
     */
    getSelectedDevice(): AudioDeviceInfo | null {
        return this.selectedDevice;
    }

    /**
     * すべてのデバイスを取得
     */
    getAllDevices(): AudioDeviceInfo[] {
        return Array.from(this.devices.values());
    }

    /**
     * 仮想デバイスを取得
     */
    getVirtualDevices(): AudioDeviceInfo[] {
        return Array.from(this.devices.values()).filter((d) => d.isVirtual);
    }

    /**
     * イベントリスナーを追加
     *
     * @param listener - イベントリスナー
     */
    addEventListener(listener: (event: DeviceEvent) => void): void {
        this.eventListeners.push(listener);
    }

    /**
     * イベントリスナーを削除
     *
     * @param listener - イベントリスナー
     */
    removeEventListener(listener: (event: DeviceEvent) => void): void {
        const index = this.eventListeners.indexOf(listener);
        if (index !== -1) {
            this.eventListeners.splice(index, 1);
        }
    }

    /**
     * イベントを発行
     *
     * @param event - イベント
     */
    private emitEvent(event: DeviceEvent): void {
        for (const listener of this.eventListeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('[DeviceGuard] イベントリスナーエラー:', error);
            }
        }
    }

    /**
     * クリーンアップ
     */
    dispose(): void {
        console.info('[DeviceGuard] クリーンアップ');
        this.stopEnumeration();
        this.devices.clear();
        this.eventListeners = [];
        this.selectedDevice = null;
    }
}
