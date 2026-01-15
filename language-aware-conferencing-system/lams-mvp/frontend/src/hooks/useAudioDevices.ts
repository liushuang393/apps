/**
 * 音声デバイス管理フック
 * マイク・スピーカーの一覧取得とデバイス選択
 * 耳机/USBデバイス優先の自動選択機能付き
 */
import { useState, useEffect, useCallback } from 'react';

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  /** 推奨デバイスフラグ（耳机/USB等） */
  isPreferred: boolean;
}

interface UseAudioDevicesReturn {
  /** マイク一覧 */
  microphones: AudioDevice[];
  /** スピーカー一覧 */
  speakers: AudioDevice[];
  /** 選択中のマイクID */
  selectedMicId: string | null;
  /** 選択中のスピーカーID */
  selectedSpeakerId: string | null;
  /** マイク選択 */
  selectMicrophone: (deviceId: string) => void;
  /** スピーカー選択 */
  selectSpeaker: (deviceId: string) => void;
  /** デバイス一覧を再取得 */
  refreshDevices: () => Promise<void>;
  /** エラー */
  error: string | null;
  /** 読み込み中 */
  loading: boolean;
}

/** ローカルストレージキー */
const STORAGE_KEY_MIC = 'lams-selected-mic';
const STORAGE_KEY_SPEAKER = 'lams-selected-speaker';

/** 優先デバイスキーワード（耳机、USB、ヘッドセット等） */
const PREFERRED_KEYWORDS = [
  'headset', 'headphone', 'earphone', 'usb', 'bluetooth',
  'ヘッドセット', 'ヘッドホン', 'イヤホン', '耳机',
  'airpods', 'jabra', 'plantronics', 'logitech', 'pnp',
];

/** デフォルト/通信デバイスキーワード */
const DEFAULT_KEYWORDS = ['default', '既定', 'デフォルト', '通信'];

/** デバイスが優先デバイスかどうか判定 */
function isPreferredDevice(label: string): boolean {
  const lowerLabel = label.toLowerCase();
  return PREFERRED_KEYWORDS.some((kw) => lowerLabel.includes(kw.toLowerCase()));
}

/** デバイスがデフォルト/通信用かどうか判定 */
function isDefaultDevice(label: string): boolean {
  const lowerLabel = label.toLowerCase();
  return DEFAULT_KEYWORDS.some((kw) => lowerLabel.includes(kw.toLowerCase()));
}

/**
 * MediaDevices API を安全に取得
 *
 * 注意:
 * - `navigator.mediaDevices` は仕様上は存在するが、ブラウザ/実行コンテキストにより
 *   `undefined` になり得る（例: 非セキュアコンテキストでの IP アクセス等）。
 * - その場合、音声デバイス取得・監視は利用不可のため、呼び出し側でクラッシュしないようにする。
 */
function getMediaDevicesSafe(): MediaDevices | null {
  const nav = navigator as Navigator & { mediaDevices?: MediaDevices };
  return nav.mediaDevices ?? null;
}

/**
 * 最適なデバイスを自動選択
 * 優先順位: 1.耳机/USB 2.通常デバイス 3.デフォルト
 */
function selectBestDevice(devices: AudioDevice[]): string | null {
  if (devices.length === 0) return null;

  // 優先デバイス（耳机/USB等）を探す
  const preferred = devices.find((d) => d.isPreferred && !isDefaultDevice(d.label));
  if (preferred) return preferred.deviceId;

  // デフォルト以外のデバイスを探す
  const nonDefault = devices.find((d) => !isDefaultDevice(d.label));
  if (nonDefault) return nonDefault.deviceId;

  // 最後にデフォルトを使用
  return devices[0].deviceId;
}

/**
 * 音声デバイス管理フック
 */
export function useAudioDevices(): UseAudioDevicesReturn {
  const [microphones, setMicrophones] = useState<AudioDevice[]>([]);
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string | null>(
    localStorage.getItem(STORAGE_KEY_MIC)
  );
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string | null>(
    localStorage.getItem(STORAGE_KEY_SPEAKER)
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** デバイス一覧取得 */
  const refreshDevices = useCallback(async () => {
    setLoading(true);
    setError(null);

    const mediaDevices = getMediaDevicesSafe();
    if (!mediaDevices?.getUserMedia || !mediaDevices.enumerateDevices) {
      // getUserMedia は https/localhost 等のセキュアコンテキストが必須。
      setError('音声デバイス機能は HTTPS または localhost でのみ利用できます（IPアクセスは非対応の場合があります）。');
      setLoading(false);
      return;
    }

    try {
      // まずマイクアクセス許可を取得（ラベル取得に必要）
      const stream = await mediaDevices.getUserMedia({ audio: true });
      // 許可取得後すぐに停止
      stream.getTracks().forEach((track) => track.stop());

      // デバイス一覧取得
      const devices = await mediaDevices.enumerateDevices();

      const mics: AudioDevice[] = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `マイク ${d.deviceId.slice(0, 8)}`,
          kind: 'audioinput' as const,
          isPreferred: isPreferredDevice(d.label || ''),
        }));

      const spks: AudioDevice[] = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `スピーカー ${d.deviceId.slice(0, 8)}`,
          kind: 'audiooutput' as const,
          isPreferred: isPreferredDevice(d.label || ''),
        }));

      setMicrophones(mics);
      setSpeakers(spks);

      // 保存されたデバイスが存在しなければ最適なデバイスを自動選択
      if (mics.length > 0) {
        const savedMic = localStorage.getItem(STORAGE_KEY_MIC);
        if (!savedMic || !mics.find((m) => m.deviceId === savedMic)) {
          const bestMic = selectBestDevice(mics);
          if (bestMic) {
            setSelectedMicId(bestMic);
            localStorage.setItem(STORAGE_KEY_MIC, bestMic);
          }
        }
      }

      if (spks.length > 0) {
        const savedSpk = localStorage.getItem(STORAGE_KEY_SPEAKER);
        if (!savedSpk || !spks.find((s) => s.deviceId === savedSpk)) {
          const bestSpk = selectBestDevice(spks);
          if (bestSpk) {
            setSelectedSpeakerId(bestSpk);
            localStorage.setItem(STORAGE_KEY_SPEAKER, bestSpk);
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
      } else {
        setError('デバイス一覧の取得に失敗しました。');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /** マイク選択 */
  const selectMicrophone = useCallback((deviceId: string) => {
    setSelectedMicId(deviceId);
    localStorage.setItem(STORAGE_KEY_MIC, deviceId);
  }, []);

  /** スピーカー選択 */
  const selectSpeaker = useCallback((deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    localStorage.setItem(STORAGE_KEY_SPEAKER, deviceId);
  }, []);

  // 初期化時とデバイス変更時にリフレッシュ
  useEffect(() => {
    refreshDevices();

    // デバイス接続/切断の監視
    const handleDeviceChange = () => {
      refreshDevices();
    };
    const mediaDevices = getMediaDevicesSafe();
    if (mediaDevices?.addEventListener && mediaDevices?.removeEventListener) {
      mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => {
        mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      };
    }
  }, [refreshDevices]);

  return {
    microphones,
    speakers,
    selectedMicId,
    selectedSpeakerId,
    selectMicrophone,
    selectSpeaker,
    refreshDevices,
    error,
    loading,
  };
}

