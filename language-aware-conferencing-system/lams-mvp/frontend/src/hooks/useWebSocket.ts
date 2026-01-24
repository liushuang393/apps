/**
 * WebSocket接続フック
 * 音声データの送受信、字幕表示、設定変更を管理
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useRoomStore, type ConnectionStatus } from '../store/roomStore';
import type { ParticipantPreference, RoomPolicy, SubtitleData } from '../types';

/** 音声再生用AudioContext */
let playbackAudioContext: AudioContext | null = null;

/**
 * 遅延初期化でAudioContextを取得
 * ユーザー操作後に呼び出す必要あり（ブラウザの自動再生ポリシー対策）
 */
function getPlaybackAudioContext(): AudioContext {
  if (!playbackAudioContext || playbackAudioContext.state === 'closed') {
    playbackAudioContext = new AudioContext({ sampleRate: 16000 });
  }
  if (playbackAudioContext.state === 'suspended') {
    playbackAudioContext.resume();
  }
  return playbackAudioContext;
}

/** 再接続設定 */
const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;

/** WebSocket接続フック */
export function useWebSocket(roomId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const isManualDisconnectRef = useRef(false);
  const connectionStatusRef = useRef<ConnectionStatus>('disconnected');
  const token = useAuthStore((s) => s.token);
  const {
    setRoomState,
    addParticipant,
    removeParticipant,
    setActiveSpeaker,
    updateParticipantMicStatus,
    addSubtitle,
    setConnected,
    setConnectionStatus,
    reset,
  } = useRoomStore();

  /** メッセージ処理 */
  const handleMessage = useCallback(
    (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case 'room_state': {
          // バックエンドはsnake_case、フロントエンドはcamelCase
          const rawPolicy = msg.policy as Record<string, unknown>;
          const policy: RoomPolicy = {
            allowedLanguages: rawPolicy.allowed_languages as RoomPolicy['allowedLanguages'],
            defaultAudioMode: rawPolicy.default_audio_mode as RoomPolicy['defaultAudioMode'],
            allowModeSwitch: rawPolicy.allow_mode_switch as boolean,
          };
          const participants = (msg.participants as Array<Record<string, unknown>>).map(
            (p) => ({
              userId: p.user_id as string,
              displayName: p.display_name as string,
              nativeLanguage: p.native_language,
              audioMode: p.audio_mode,
              subtitleEnabled: true,
              targetLanguage: p.native_language,
            } as ParticipantPreference)
          );
          const myPref = msg.your_preference as Record<string, unknown>;
          setRoomState(
            msg.room_id as string,
            msg.room_name as string,
            policy,
            participants,
            {
              userId: myPref.user_id as string,
              displayName: myPref.display_name as string,
              nativeLanguage: myPref.native_language,
              audioMode: myPref.audio_mode,
              subtitleEnabled: myPref.subtitle_enabled as boolean,
              targetLanguage: myPref.target_language,
            } as ParticipantPreference
          );
          break;
        }
        case 'user_joined':
          addParticipant({
            userId: msg.user_id as string,
            displayName: msg.display_name as string,
            nativeLanguage: msg.native_language,
            audioMode: 'original',
            subtitleEnabled: true,
            targetLanguage: msg.native_language,
          } as ParticipantPreference);
          break;
        case 'user_left':
          removeParticipant(msg.user_id as string);
          break;
        case 'speaking_start':
          setActiveSpeaker(msg.user_id as string);
          break;
        case 'speaking_end':
          setActiveSpeaker(null);
          break;
        case 'mic_status_changed':
          // マイク状態変更を参加者リストに反映
          updateParticipantMicStatus(msg.user_id as string, msg.is_mic_on as boolean);
          break;
        case 'subtitle':
          addSubtitle({
            id: msg.id as string | undefined,
            seq: msg.seq as number | undefined,
            speakerId: msg.speaker_id as string,
            text: msg.text as string,
            language: msg.language,
            isTranslated: msg.is_translated as boolean,
            latencyMs: msg.latency_ms as number | undefined,
          } as SubtitleData);
          break;
        case 'qos_warning':
          console.warn('[QoS]', msg.message);
          break;
        case 'error':
          console.error('[WS Error]', msg.message);
          break;
      }
    },
    [setRoomState, addParticipant, removeParticipant, setActiveSpeaker, updateParticipantMicStatus, addSubtitle]
  );

  /**
   * 受信した音声データを再生
   * WAV形式のバイナリをデコードして再生
   *
   * 原声会議機能: 音声は即座に配信されるため、デコード・再生のみ
   */
  const playAudio = useCallback(async (audioData: ArrayBuffer) => {
    const receiveTime = performance.now();

    // 最小データサイズチェック（WAVヘッダー44バイト + 少なくともサンプルデータ）
    if (audioData.byteLength < 100) {
      return;
    }

    try {
      const audioCtx = getPlaybackAudioContext();
      // WAVデータをデコード（slice(0)でコピーを作成）
      const audioBuffer = await audioCtx.decodeAudioData(audioData.slice(0));
      // BufferSourceを作成して再生
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      source.start(0);

      // デバッグ: 音声処理遅延をログ出力（開発環境のみ）
      if (import.meta.env.DEV) {
        const playbackDelay = performance.now() - receiveTime;
        // 遅延が50ms以上の場合のみ警告
        if (playbackDelay > 50) {
          console.debug(`[Audio] 再生遅延: ${playbackDelay.toFixed(1)}ms`);
        }
      }
    } catch (err) {
      // デコード失敗をログ出力（デバッグ用）
      console.warn('[Audio] 音声デコード失敗:', err, 'データサイズ:', audioData.byteLength);
    }
  }, []);

  /** 接続状態を更新 */
  const updateStatus = useCallback(
    (status: ConnectionStatus) => {
      connectionStatusRef.current = status;
      setConnectionStatus(status);
      setConnected(status === 'connected');
    },
    [setConnected, setConnectionStatus]
  );

  /** 設定変更送信 */
  const sendPreferenceChange = useCallback(
    (pref: { audioMode?: string; subtitleEnabled?: boolean; targetLanguage?: string }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'preference_change',
            audio_mode: pref.audioMode,
            subtitle_enabled: pref.subtitleEnabled,
            target_language: pref.targetLanguage,
          })
        );
      }
    },
    []
  );

  /** 切断（手動） */
  const disconnect = useCallback(() => {
    isManualDisconnectRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    reconnectAttemptRef.current = 0;
    reset();
  }, [reset]);

  // roomId/token変更時のみ再接続
  useEffect(() => {
    if (!roomId || !token) return;

    // 既に接続中なら何もしない
    if (wsRef.current) return;

    isManualDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;

    const isReconnect = reconnectAttemptRef.current > 0;
    updateStatus(isReconnect ? 'reconnecting' : 'connecting');

    // WebSocket URL
    // 常に相対パス /ws を使用し、Vite proxy経由でバックエンドにアクセス
    // これにより、localhost/LAN IP どちらからアクセスしても同一originとなり、
    // localStorageの認証トークンが共有される（業界ベストプラクティス）
    const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${globalThis.location.host}/ws/room/${roomId}?token=${token}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      updateStatus('connected');
      // AudioContextを事前に初期化（自動再生ポリシー対策）
      // 接続成功時に即座に初期化することで、音声再生の遅延を最小化
      const ctx = getPlaybackAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {
          // ユーザー操作が必要な場合は後で再試行
        });
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } else if (event.data instanceof ArrayBuffer) {
        playAudio(event.data);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;

      if (!isManualDisconnectRef.current && reconnectAttemptRef.current < RECONNECT_MAX_ATTEMPTS) {
        updateStatus('reconnecting');
        const delay = Math.min(
          RECONNECT_INITIAL_DELAY_MS * Math.pow(2, reconnectAttemptRef.current),
          RECONNECT_MAX_DELAY_MS
        );
        reconnectAttemptRef.current += 1;
        reconnectTimeoutRef.current = globalThis.setTimeout(() => {
          // 再接続時は新しいWebSocket作成
          if (!isManualDisconnectRef.current && !wsRef.current) {
            // effectを再トリガーするため、状態更新ではなく直接接続
            const newWs = new WebSocket(wsUrl);
            newWs.binaryType = 'arraybuffer';
            wsRef.current = newWs;
            newWs.onopen = ws.onopen;
            newWs.onmessage = ws.onmessage;
            newWs.onclose = ws.onclose;
            newWs.onerror = ws.onerror;
          }
        }, delay);
      } else {
        updateStatus('disconnected');
      }
    };

    ws.onerror = () => {
      // エラーはoncloseで処理される
    };

    // cleanup: roomId/tokenが変わった時のみ実行される
    return () => {
      isManualDisconnectRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token]);

  return { sendPreferenceChange, disconnect, wsRef };
}
