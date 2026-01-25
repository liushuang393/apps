/**
 * 音声キャプチャフック
 * マイク入力の取得、音量検出、波形データ出力、WebSocket送信
 *
 * ★パフォーマンス最適化★
 * - 状態更新を節流（throttle）して不要な再レンダリングを防止
 * - useRefで内部状態を管理し、必要な時のみstateを更新
 */
import { useState, useEffect, useRef, useCallback } from 'react';

interface UseAudioCaptureOptions {
  /** マイクデバイスID */
  deviceId: string | null;
  /** 有効フラグ */
  enabled: boolean;
  /** WebSocket参照（音声送信用） */
  wsRef?: React.MutableRefObject<WebSocket | null>;
}

interface UseAudioCaptureReturn {
  /** マイクがONかどうか */
  isMicOn: boolean;
  /** マイクON/OFF切り替え */
  toggleMic: () => void;
  /** 現在の音量レベル (0-100) */
  volumeLevel: number;
  /** 波形データ (0-255の配列) */
  waveformData: Uint8Array;
  /** 発話中かどうか */
  isSpeaking: boolean;
  /** MediaStreamへの参照 */
  streamRef: React.MutableRefObject<MediaStream | null>;
  /** エラー */
  error: string | null;
}

/** 発話検出の閾値（音量レベル）- 高めに設定してノイズを除去 */
const SPEAKING_THRESHOLD = 25;
/**
 * 発話終了の遅延（ms）- 適応型VADのデフォルト値
 * 発話終了検出後、この時間待ってから完全な音声セグメントを送信
 * 短い間の途切れで分割されないように
 * ★改善: 800ms → 400ms に短縮
 */
const SPEAKING_END_DELAY_DEFAULT = 400;
/** 最小遅延（ms）- 音量が急激に下降した場合 */
const SPEAKING_END_DELAY_MIN = 200;
/** 音量急降下の閾値（この値以上の下降で早期終了） */
const VOLUME_DROP_THRESHOLD = 15;
/** 音量履歴サイズ（適応型遅延計算用） */
const VOLUME_HISTORY_SIZE = 5;
/** サンプルレート */
const SAMPLE_RATE = 16000;
/**
 * 最小送信サンプル数（認識精度のため 200ms分）
 * ★改善: 500ms(8000) → 200ms(3200) に短縮、短い発話もサポート
 */
const MIN_SAMPLES_TO_SEND = 3200;
/** 最大バッファサンプル数（30秒 × 16kHz = 480000サンプル）- メモリ保護用 */
const MAX_BUFFER_SAMPLES = 480000;

/**
 * ★パフォーマンス最適化: 状態更新の節流間隔（ms）★
 * 音量・波形データの更新頻度を制限して不要な再レンダリングを防止
 */
const STATE_UPDATE_THROTTLE_MS = 100;

/**
 * 音声キャプチャフック
 */
export function useAudioCapture({
  deviceId,
  enabled,
  wsRef,
}: UseAudioCaptureOptions): UseAudioCaptureReturn {
  const [isMicOn, setIsMicOn] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [waveformData, setWaveformData] = useState<Uint8Array>(new Uint8Array(64));
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const speakingTimeoutRef = useRef<number | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  /** 定期送信用インターバル（不要になったが互換性のため残す） */
  const audioSendIntervalRef = useRef<number | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const wasSpeakingRef = useRef(false);
  /** 現在の音量レベルを保持（送信判定用） */
  const currentVolumeLevelRef = useRef(0);
  /** 発話開始フラグ（発話中のバッファリング開始を検知） */
  const speechStartedRef = useRef(false);
  /** ★適応型VAD: 音量履歴追跡★ */
  const volumeHistoryRef = useRef<number[]>([]);

  /**
   * ★パフォーマンス最適化: 状態更新の節流用タイムスタンプ★
   * 最後に状態を更新した時刻を記録し、一定間隔以上経過した場合のみ更新
   */
  const lastStateUpdateRef = useRef(0);
  /** 内部音量レベル（state更新前の値を保持） */
  const internalVolumeLevelRef = useRef(0);
  /** 内部波形データ（state更新前の値を保持） */
  const internalWaveformRef = useRef<Uint8Array>(new Uint8Array(64));
  /** 内部発話状態（state更新前の値を保持） */
  const internalIsSpeakingRef = useRef(false);

  /**
   * ★適応型VAD: 音量下降速度に基づく遅延計算★
   * 音量が急激に下がった場合は早く終了判定を行う
   */
  const calculateAdaptiveDelay = useCallback((): number => {
    const history = volumeHistoryRef.current;
    if (history.length < 3) return SPEAKING_END_DELAY_DEFAULT;

    // 直近3サンプルで音量下降速度を計算
    const recent = history.slice(-3);
    const dropRate = recent[0] - recent[recent.length - 1];

    // 音量が急激に下降した場合は早期終了
    if (dropRate > VOLUME_DROP_THRESHOLD) {
      console.log(`[VAD] 音量急降下検出: ${dropRate.toFixed(1)}, 早期終了 ${SPEAKING_END_DELAY_MIN}ms`);
      return SPEAKING_END_DELAY_MIN;
    }
    return SPEAKING_END_DELAY_DEFAULT;
  }, []);

  /**
   * Float32Array を 16bit PCM に変換
   * WAVファイル形式でバックエンドに送信
   */
  const encodeWavPcm = useCallback((samples: Float32Array): ArrayBuffer => {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = SAMPLE_RATE * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = samples.length * (bitsPerSample / 8);
    const bufferSize = 44 + dataSize;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // WAVヘッダー
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // PCMデータ（-1.0 ~ 1.0 → -32768 ~ 32767）
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return buffer;
  }, []);

  /**
   * 完全な発話セグメントを送信
   * VADによる発話終了検出後、バッファリングされた音声全体を一括送信
   *
   * 設計思想:
   * - 200ms間隔の定期送信を廃止し、発話セグメント単位で送信
   * - 一文（発話開始→発話終了）を一つの音声として送信
   * - 後端は音声処理をせず、そのままAI APIに渡す
   */
  const sendCompleteSpeechSegment = useCallback(() => {
    if (!wsRef?.current) {
      return;
    }
    if (wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    if (audioBufferRef.current.length === 0) {
      return;
    }

    // バッファを結合
    const totalLength = audioBufferRef.current.reduce((acc, arr) => acc + arr.length, 0);

    // 最小サンプル数チェック（短すぎる音声は送信しない）
    if (totalLength < MIN_SAMPLES_TO_SEND) {
      console.log('[Audio] 発話が短すぎるためスキップ:', totalLength, 'samples');
      audioBufferRef.current = [];
      speechStartedRef.current = false;
      return;
    }

    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of audioBufferRef.current) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    audioBufferRef.current = [];
    speechStartedRef.current = false;

    // WAV形式にエンコードして送信
    const wavBuffer = encodeWavPcm(combined);
    wsRef.current.send(wavBuffer);
    console.log('[Audio] 完全な発話セグメント送信:', totalLength, 'samples, ', Math.round(totalLength / SAMPLE_RATE * 1000), 'ms');
  }, [wsRef, encodeWavPcm]);

  /**
   * バッファが最大サイズを超えた場合の強制送信
   * メモリ保護のため、長すぎる発話は分割送信
   */
  const checkAndSendIfBufferFull = useCallback(() => {
    const totalLength = audioBufferRef.current.reduce((acc, arr) => acc + arr.length, 0);
    if (totalLength >= MAX_BUFFER_SAMPLES) {
      console.log('[Audio] バッファ最大サイズに達したため送信');
      sendCompleteSpeechSegment();
    }
  }, [sendCompleteSpeechSegment]);

  /** マイクストリーム開始 */
  const startCapture = useCallback(async () => {
    console.log('[Audio Debug] startCapture called, deviceId:', deviceId);
    if (!deviceId) {
      setError('マイクが選択されていません');
      return;
    }

    try {
      setError(null);
      console.log('[Audio Debug] Starting mic capture...');

      // 既存のストリームを停止
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      // マイクアクセス取得（16kHzサンプルレート指定）
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: SAMPLE_RATE,
        },
      });

      streamRef.current = stream;

      // AudioContext作成（16kHz）
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;

      // AnalyserNode作成（波形表示用）
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // マイク入力をAnalyserに接続
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // ScriptProcessorNode（音声データ取得用、非推奨だが安定）
      // bufferSize: 4096 = 256ms at 16kHz
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // 発話中のみバッファに追加（ノイズを除外）
        if (speechStartedRef.current) {
          audioBufferRef.current.push(new Float32Array(inputData));
          // バッファ最大サイズチェック
          checkAndSendIfBufferFull();
        }
      };

      source.connect(processor);
      // 注意: destinationに接続しないとonaudioprocessが呼ばれない
      // GainNodeで音量0に設定して回声を防ぐ
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      setIsMicOn(true);
      console.log('[Audio] Mic started successfully');

      // マイクON通知を送信
      if (wsRef?.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'mic_on' }));
      }

      /**
       * ★パフォーマンス最適化: 音量・波形データの継続更新 + VAD発話検出★
       *
       * 問題: requestAnimationFrame は毎フレーム（約60fps）呼ばれる
       * → 毎フレーム setState すると不要な再レンダリングが発生
       *
       * 解決策:
       * 1. 内部状態（ref）は毎フレーム更新（VAD判定に必要）
       * 2. React state は節流（100ms間隔）で更新（UI表示用）
       * 3. 発話状態の変化は即座に反映（重要なUI変更）
       */
      const updateAudioData = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // 音量計算（平均値）- 内部状態として保持
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalizedVolume = Math.min(100, Math.round((average / 255) * 100 * 2));
        currentVolumeLevelRef.current = normalizedVolume;

        // 内部状態を更新（毎フレーム）
        internalVolumeLevelRef.current = normalizedVolume;
        internalWaveformRef.current = dataArray;

        // ★適応型VAD: 音量履歴を更新（最新N件を保持）
        volumeHistoryRef.current.push(normalizedVolume);
        if (volumeHistoryRef.current.length > VOLUME_HISTORY_SIZE) {
          volumeHistoryRef.current.shift();
        }

        /**
         * VAD（発話検出）ロジック - 内部状態で判定
         * ★改善: 適応型遅延で発話終了を検出
         */
        const nowSpeaking = normalizedVolume > SPEAKING_THRESHOLD;

        if (nowSpeaking) {
          // 発話開始検出
          if (!speechStartedRef.current) {
            speechStartedRef.current = true;
            volumeHistoryRef.current = []; // 履歴リセット
            console.log('[VAD] 発話開始検出');
          }
          // 発話状態の変化は即座に反映（重要なUI変更）
          if (!internalIsSpeakingRef.current) {
            internalIsSpeakingRef.current = true;
            setIsSpeaking(true);
          }
          wasSpeakingRef.current = true;
          // タイムアウトをクリア（発話が続いている）
          if (speakingTimeoutRef.current) {
            clearTimeout(speakingTimeoutRef.current);
            speakingTimeoutRef.current = null;
          }
        } else if (wasSpeakingRef.current && !speakingTimeoutRef.current) {
          // 発話終了検出（★適応型遅延）
          const adaptiveDelay = calculateAdaptiveDelay();
          speakingTimeoutRef.current = globalThis.setTimeout(() => {
            console.log(`[VAD] 発話終了検出 (delay=${adaptiveDelay}ms)、完全な音声セグメントを送信`);
            internalIsSpeakingRef.current = false;
            setIsSpeaking(false);
            wasSpeakingRef.current = false;
            speakingTimeoutRef.current = null;
            volumeHistoryRef.current = []; // 履歴リセット
            // ★ 発話終了時に完全な音声セグメントを送信
            sendCompleteSpeechSegment();
          }, adaptiveDelay);
        }

        // ★パフォーマンス最適化: 節流された状態更新★
        const now = performance.now();
        if (now - lastStateUpdateRef.current >= STATE_UPDATE_THROTTLE_MS) {
          lastStateUpdateRef.current = now;
          // 音量と波形データを更新（UI表示用）
          setVolumeLevel(internalVolumeLevelRef.current);
          setWaveformData(new Uint8Array(internalWaveformRef.current));
        }

        animationFrameRef.current = requestAnimationFrame(updateAudioData);
      };

      updateAudioData();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('マイクへのアクセスが拒否されました');
      } else {
        setError('マイクの起動に失敗しました');
      }
      setIsMicOn(false);
    }
  }, [deviceId, wsRef, sendCompleteSpeechSegment, checkAndSendIfBufferFull, calculateAdaptiveDelay]);

  /** マイクストリーム停止 */
  const stopCapture = useCallback(() => {
    // 残りのバッファがあれば送信（発話中にマイクOFFされた場合）
    if (speechStartedRef.current && audioBufferRef.current.length > 0) {
      sendCompleteSpeechSegment();
    }

    // マイクOFF通知を送信
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'mic_off' }));
    }

    // タイマーをクリア
    if (audioSendIntervalRef.current) {
      clearInterval(audioSendIntervalRef.current);
      audioSendIntervalRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    audioBufferRef.current = [];
    wasSpeakingRef.current = false;
    speechStartedRef.current = false;

    setIsMicOn(false);
    setVolumeLevel(0);
    setWaveformData(new Uint8Array(64));
    setIsSpeaking(false);
  }, [wsRef, sendCompleteSpeechSegment]);

  /** マイクON/OFF切り替え */
  const toggleMic = useCallback(() => {
    if (isMicOn) {
      stopCapture();
    } else {
      startCapture();
    }
  }, [isMicOn, startCapture, stopCapture]);

  // 前回のdeviceIdを保持
  const prevDeviceIdRef = useRef<string | null>(null);

  // deviceIdの変化を監視（マイクON中にデバイス切替した場合、自動で再接続）
  useEffect(() => {
    const prevDeviceId = prevDeviceIdRef.current;
    prevDeviceIdRef.current = deviceId;

    // デバイスが変更され、かつマイクがONの状態なら再接続
    if (deviceId && prevDeviceId && deviceId !== prevDeviceId && isMicOn) {
      // 新しいデバイスで再キャプチャ
      startCapture();
    }
  }, [deviceId, isMicOn, startCapture]);

  // enabled状態の変化を監視（外部からの制御用）
  useEffect(() => {
    if (enabled && deviceId && !isMicOn) {
      startCapture();
    } else if (!enabled && isMicOn) {
      stopCapture();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return {
    isMicOn,
    toggleMic,
    volumeLevel,
    waveformData,
    isSpeaking,
    streamRef,
    error,
  };
}

