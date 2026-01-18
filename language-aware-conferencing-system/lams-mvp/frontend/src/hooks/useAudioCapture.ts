/**
 * 音声キャプチャフック
 * マイク入力の取得、音量検出、波形データ出力、WebSocket送信
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

/** 発話検出の閾値 */
const SPEAKING_THRESHOLD = 15;
/** 発話終了の遅延（ms） */
const SPEAKING_END_DELAY = 500;
/**
 * 音声送信間隔（ms）
 * 500ms = 16kHzで8000サンプル = 約16KB
 * ASRで認識可能な最小音声長を確保
 */
const AUDIO_SEND_INTERVAL_MS = 500;
/** サンプルレート */
const SAMPLE_RATE = 16000;
/** 最小送信サンプル数（認識精度のため） */
const MIN_SAMPLES_TO_SEND = 4000;

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
  const audioSendIntervalRef = useRef<number | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const wasSpeakingRef = useRef(false);

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
   * 音声バッファを送信
   * 最小サンプル数を満たさない場合は送信しない（ASR認識精度のため）
   */
  const sendAudioBuffer = useCallback((forceFlush = false) => {
    if (!wsRef?.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    if (audioBufferRef.current.length === 0) {
      return;
    }

    // バッファを結合
    const totalLength = audioBufferRef.current.reduce((acc, arr) => acc + arr.length, 0);

    // 最小サンプル数チェック（強制フラッシュ時は無視）
    if (!forceFlush && totalLength < MIN_SAMPLES_TO_SEND) {
      return;
    }

    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of audioBufferRef.current) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    audioBufferRef.current = [];

    // WAV形式にエンコードして送信
    const wavBuffer = encodeWavPcm(combined);
    wsRef.current.send(wavBuffer);
  }, [wsRef, encodeWavPcm]);

  /** マイクストリーム開始 */
  const startCapture = useCallback(async () => {
    if (!deviceId) {
      setError('マイクが選択されていません');
      return;
    }

    try {
      setError(null);

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
        // バッファにコピーを追加
        audioBufferRef.current.push(new Float32Array(inputData));
      };

      source.connect(processor);
      // 注意: destinationに接続しないとonaudioprocessが呼ばれない
      // GainNodeで音量0に設定して回声を防ぐ
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      setIsMicOn(true);

      // 発話開始通知を送信
      if (wsRef?.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'speaking_start' }));
      }

      // 定期的に音声データを送信
      audioSendIntervalRef.current = window.setInterval(() => {
        sendAudioBuffer();
      }, AUDIO_SEND_INTERVAL_MS);

      // 音量・波形データの継続更新
      const updateAudioData = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // 波形データ更新
        setWaveformData(new Uint8Array(dataArray));

        // 音量計算（平均値）
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalizedVolume = Math.min(100, Math.round((average / 255) * 100 * 2));
        setVolumeLevel(normalizedVolume);

        // 発話検出
        const nowSpeaking = normalizedVolume > SPEAKING_THRESHOLD;
        if (nowSpeaking) {
          setIsSpeaking(true);
          wasSpeakingRef.current = true;
          if (speakingTimeoutRef.current) {
            clearTimeout(speakingTimeoutRef.current);
            speakingTimeoutRef.current = null;
          }
        } else if (wasSpeakingRef.current && !speakingTimeoutRef.current) {
          speakingTimeoutRef.current = window.setTimeout(() => {
            setIsSpeaking(false);
            wasSpeakingRef.current = false;
            speakingTimeoutRef.current = null;
          }, SPEAKING_END_DELAY);
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
  }, [deviceId, wsRef, sendAudioBuffer]);

  /** マイクストリーム停止 */
  const stopCapture = useCallback(() => {
    // 残りのバッファを強制送信（最小サンプル数チェックをスキップ）
    sendAudioBuffer(true);

    // 発話終了通知を送信
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'speaking_end' }));
    }

    // 定期送信を停止
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

    setIsMicOn(false);
    setVolumeLevel(0);
    setWaveformData(new Uint8Array(64));
    setIsSpeaking(false);
  }, [wsRef, sendAudioBuffer]);

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

