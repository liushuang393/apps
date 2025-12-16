/**
 * WebSocket接続フック
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useRoomStore } from '../store/roomStore';
import type { ParticipantPreference, RoomPolicy, SubtitleData } from '../types';

/** WebSocket接続フック */
export function useWebSocket(roomId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const token = useAuthStore((s) => s.token);
  const {
    setRoomState,
    addParticipant,
    removeParticipant,
    setActiveSpeaker,
    addSubtitle,
    setConnected,
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
        case 'subtitle':
          addSubtitle({
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
    [setRoomState, addParticipant, removeParticipant, setActiveSpeaker, addSubtitle]
  );

  /** 接続 */
  const connect = useCallback(() => {
    if (!roomId || !token || wsRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/room/${roomId}?token=${token}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] 接続成功');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      }
      // バイナリデータ（音声）は別途処理
    };

    ws.onclose = () => {
      console.log('[WS] 切断');
      setConnected(false);
      wsRef.current = null;
    };

    ws.onerror = (err) => {
      console.error('[WS] エラー:', err);
    };
  }, [roomId, token, setConnected, handleMessage]);

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

  /** 切断 */
  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    reset();
  }, [reset]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { sendPreferenceChange, disconnect, wsRef };
}
