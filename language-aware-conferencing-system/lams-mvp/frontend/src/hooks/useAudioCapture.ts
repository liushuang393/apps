/**
 * 音声キャプチャフック（Phase 3 C1: LiveKit publish 化）
 * マイク入力の取得、音量検出、波形データ出力、LiveKit への mic track publish。
 *
 * 発話単位の切り出し（VAD/セグメント化）はサーバ側 Agent が担うため、本フックは
 * 連続した mic track を publish するのみ。VAD 判定は UI 表示（isSpeaking）用に維持する。
 *
 * ★パフォーマンス最適化★
 * - 状態更新を節流（throttle）して不要な再レンダリングを防止
 * - useRefで内部状態を管理し、必要な時のみstateを更新
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { LocalAudioTrack, Track, type Room } from 'livekit-client';

interface UseAudioCaptureOptions {
  /** マイクデバイスID */
  deviceId: string | null;
  /** 有効フラグ */
  enabled: boolean;
  /** LiveKit Room 参照（mic track publish 用） */
  roomRef?: React.MutableRefObject<Room | null>;
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
  roomRef,
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
  /** LiveKit に publish 中の mic track（unpublish 用） */
  const micTrackRef = useRef<LocalAudioTrack | null>(null);
  const wasSpeakingRef = useRef(false);
  /** 現在の音量レベルを保持（VAD判定用） */
  const currentVolumeLevelRef = useRef(0);
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
      return SPEAKING_END_DELAY_MIN;
    }
    return SPEAKING_END_DELAY_DEFAULT;
  }, []);

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

      // マイク入力をAnalyserに接続（波形/音量/VADはUI表示用）
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // 捕捉した mic track を LiveKit Room へ publish（発話切り出しはサーバ側 Agent）
      const room = roomRef?.current;
      const [mediaTrack] = stream.getAudioTracks();
      if (room && mediaTrack) {
        // userProvidedTrack=true: SDK による track の自動再取得を抑止（本フックが管理）
        const micTrack = new LocalAudioTrack(mediaTrack, undefined, true);
        await room.localParticipant.publishTrack(micTrack, {
          source: Track.Source.Microphone,
        });
        micTrackRef.current = micTrack;
      }

      setIsMicOn(true);

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
          // 発話終了検出（★適応型遅延）UI の isSpeaking を落とす
          const adaptiveDelay = calculateAdaptiveDelay();
          speakingTimeoutRef.current = globalThis.setTimeout(() => {
            internalIsSpeakingRef.current = false;
            setIsSpeaking(false);
            wasSpeakingRef.current = false;
            speakingTimeoutRef.current = null;
            volumeHistoryRef.current = []; // 履歴リセット
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
  }, [deviceId, roomRef, calculateAdaptiveDelay]);

  /** マイクストリーム停止 */
  const stopCapture = useCallback(() => {
    // LiveKit へ publish 中の mic track を unpublish（track も停止）
    if (micTrackRef.current) {
      const room = roomRef?.current;
      if (room) {
        void room.localParticipant.unpublishTrack(micTrackRef.current, true);
      } else {
        micTrackRef.current.stop();
      }
      micTrackRef.current = null;
    }

    // タイマーをクリア
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
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
    wasSpeakingRef.current = false;

    setIsMicOn(false);
    setVolumeLevel(0);
    setWaveformData(new Uint8Array(64));
    setIsSpeaking(false);
  }, [roomRef]);

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

