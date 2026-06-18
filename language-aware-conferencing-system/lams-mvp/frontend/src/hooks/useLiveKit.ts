/**
 * LiveKit 接続フック（Phase 3 C1: 単一トランスポート）
 * useWebSocket の置換。Room 接続・participant attributes による設定同期・
 * data channel 字幕受信・翻訳音声トラック再生を管理する。
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import { roomApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useRoomStore, type ConnectionStatus } from '../store/roomStore';
import type {
  AudioMode,
  ParticipantPreference,
  RoomPolicy,
  SubtitleData,
  SupportedLanguage,
} from '../types';

/** participant attributes キー（backend agent と一致させる） */
const ATTR_NATIVE = 'native_language';
const ATTR_AUDIO_MODE = 'audio_mode';
const ATTR_TARGET = 'target_language';
const ATTR_SUBTITLE = 'subtitle_enabled';
/** data channel トピック（backend sink と一致させる） */
const TOPIC_SUBTITLE = 'subtitle';
/** 翻訳音声トラック名接頭辞（backend publisher と一致させる） */
const TRACK_NAME_PREFIX = 'translation-';
/** サーバ参加者（Agent）の identity 接頭辞（参加者一覧から除外する） */
const AGENT_IDENTITY = 'lams-agent';
/** デフォルト言語（attributes 未供給時） */
const DEFAULT_LANG: SupportedLanguage = 'ja';

/** 自分の設定（attributes 送信と音声ルーティングの判定に使う） */
interface MyPref {
  native: SupportedLanguage;
  audioMode: AudioMode;
  targetLanguage: SupportedLanguage;
  subtitleEnabled: boolean;
}

/**
 * 購読中の音声トラックと再生要素。
 * isTranslation=true は Agent の翻訳音声（lang 別）、false は他参加者の原声。
 */
interface AudioEntry {
  el: HTMLMediaElement;
  isTranslation: boolean;
  lang?: string;
}

/** Agent 参加者かどうか */
function isAgent(identity: string): boolean {
  return identity.startsWith(AGENT_IDENTITY);
}

/** participant attributes から受聴者設定を組み立てる */
function prefFromAttributes(
  identity: string,
  name: string | undefined,
  attrs: Readonly<Record<string, string>>
): ParticipantPreference {
  const native = (attrs[ATTR_NATIVE] || DEFAULT_LANG) as SupportedLanguage;
  return {
    userId: identity,
    displayName: name || identity,
    nativeLanguage: native,
    audioMode: attrs[ATTR_AUDIO_MODE] === 'translated' ? 'translated' : 'original',
    subtitleEnabled: attrs[ATTR_SUBTITLE] !== 'false',
    targetLanguage: (attrs[ATTR_TARGET] || native) as SupportedLanguage,
  };
}

/** data channel の字幕メッセージ（snake_case）を SubtitleData へ変換 */
function toSubtitle(msg: Record<string, unknown>): SubtitleData {
  return {
    id: msg.id as string | undefined,
    seq: msg.seq as number | undefined,
    speakerId: msg.speaker_id as string,
    originalText: msg.original_text as string,
    sourceLanguage: msg.source_language as SupportedLanguage,
    isTranslated: Boolean(msg.is_translated),
  };
}

/** MyPref を attributes レコードへ変換（全キーを常に送る＝merge 曖昧性回避） */
function buildAttributes(p: MyPref): Record<string, string> {
  return {
    [ATTR_NATIVE]: p.native,
    [ATTR_AUDIO_MODE]: p.audioMode,
    [ATTR_TARGET]: p.targetLanguage,
    [ATTR_SUBTITLE]: String(p.subtitleEnabled),
  };
}

/** LiveKit ConnectionState を UI の ConnectionStatus へ写像する */
function toStatus(state: ConnectionState): ConnectionStatus {
  switch (state) {
    case ConnectionState.Connecting:
      return 'connecting';
    case ConnectionState.Connected:
      return 'connected';
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'reconnecting';
    default:
      return 'disconnected';
  }
}

/** LiveKit 接続フック */
export function useLiveKit(roomId: string | null) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const {
    setRoomState,
    addParticipant,
    removeParticipant,
    setActiveSpeaker,
    addSubtitle,
    setConnectionStatus,
    reset,
  } = useRoomStore();

  const roomRef = useRef<Room | null>(null);
  const myPrefRef = useRef<MyPref | null>(null);
  /** trackSid -> 購読中音声エントリ（原声 / 翻訳音声） */
  const audioEntriesRef = useRef<Map<string, AudioEntry>>(new Map());

  /**
   * 購読中トラックの再生可否を現在設定に合わせて更新する。
   * translated: 目標言語の翻訳音声のみ再生／original: 他参加者の原声のみ再生。
   */
  const applyAudioRouting = useCallback(() => {
    const pref = myPrefRef.current;
    audioEntriesRef.current.forEach((entry) => {
      entry.el.muted = entry.isTranslation
        ? !(pref?.audioMode === 'translated' && entry.lang === pref.targetLanguage)
        : pref?.audioMode !== 'original';
    });
  }, []);

  /** 設定変更を attributes に反映する（agent が受信し主線駆動を更新） */
  const sendPreferenceChange = useCallback(
    (pref: { audioMode?: string; subtitleEnabled?: boolean; targetLanguage?: string }) => {
      const current = myPrefRef.current;
      const room = roomRef.current;
      if (!current || !room) return;
      if (pref.audioMode !== undefined) current.audioMode = pref.audioMode as AudioMode;
      if (pref.subtitleEnabled !== undefined) current.subtitleEnabled = pref.subtitleEnabled;
      if (pref.targetLanguage !== undefined) {
        current.targetLanguage = pref.targetLanguage as SupportedLanguage;
      }
      void room.localParticipant.setAttributes(buildAttributes(current));
      applyAudioRouting();
    },
    [applyAudioRouting]
  );

  /** 切断（手動退室） */
  const disconnect = useCallback(() => {
    audioEntriesRef.current.forEach((entry) => {
      entry.el.pause();
      entry.el.remove();
    });
    audioEntriesRef.current.clear();
    void roomRef.current?.disconnect();
    roomRef.current = null;
    reset();
  }, [reset]);

  // roomId / token / user 変更時に接続する（単一接続を維持）。
  useEffect(() => {
    if (!roomId || !token || !user) return;
    let cancelled = false;
    const room = new Room();
    roomRef.current = room;
    // cleanup 時点での ref 変化を避けるため、effect 内でローカルに束縛する
    const audioEntries = audioEntriesRef.current;
    setConnectionStatus('connecting');

    room
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        setConnectionStatus(toStatus(state));
      })
      .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
        if (!isAgent(p.identity)) {
          addParticipant(prefFromAttributes(p.identity, p.name, p.attributes));
        }
      })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        removeParticipant(p.identity);
      })
      .on(RoomEvent.ParticipantAttributesChanged, (_changed, p: Participant) => {
        if (!isAgent(p.identity) && p.identity !== user.id) {
          addParticipant(prefFromAttributes(p.identity, p.name, p.attributes));
        }
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const active = speakers.find((s) => !isAgent(s.identity));
        setActiveSpeaker(active ? active.identity : null);
      })
      .on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
          if (track.kind !== Track.Kind.Audio) return;
          const isTranslation =
            isAgent(p.identity) && pub.trackName.startsWith(TRACK_NAME_PREFIX);
          const lang = isTranslation
            ? pub.trackName.slice(TRACK_NAME_PREFIX.length)
            : undefined;
          audioEntriesRef.current.set(pub.trackSid, {
            el: track.attach(),
            isTranslation,
            lang,
          });
          applyAudioRouting();
        }
      )
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
        const entry = audioEntriesRef.current.get(pub.trackSid);
        if (!entry) return;
        track.detach();
        entry.el.remove();
        audioEntriesRef.current.delete(pub.trackSid);
      })
      .on(RoomEvent.DataReceived, (payload, _p, _kind, topic) => {
        if (topic !== TOPIC_SUBTITLE) return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
          addSubtitle(toSubtitle(msg));
        } catch {
          // 不正な payload は無視する
        }
      });

    void (async () => {
      try {
        const [join, info] = await Promise.all([
          roomApi.getJoinToken(roomId),
          roomApi.get(roomId),
        ]);
        if (cancelled) return;
        const policy: RoomPolicy = {
          allowedLanguages: info.allowedLanguages,
          defaultAudioMode: info.defaultAudioMode,
          allowModeSwitch: info.allowModeSwitch,
        };
        const myPref: ParticipantPreference = {
          userId: user.id,
          displayName: user.displayName,
          nativeLanguage: user.nativeLanguage,
          audioMode: policy.defaultAudioMode,
          subtitleEnabled: true,
          targetLanguage: user.nativeLanguage,
        };
        myPrefRef.current = {
          native: user.nativeLanguage,
          audioMode: myPref.audioMode,
          targetLanguage: myPref.targetLanguage,
          subtitleEnabled: true,
        };

        await room.connect(join.serverUrl, join.token);
        if (cancelled) {
          void room.disconnect();
          return;
        }
        await room.localParticipant.setAttributes(buildAttributes(myPrefRef.current));

        const participants: ParticipantPreference[] = [myPref];
        room.remoteParticipants.forEach((p) => {
          if (!isAgent(p.identity)) {
            participants.push(prefFromAttributes(p.identity, p.name, p.attributes));
          }
        });
        setRoomState(info.id, info.name, policy, participants, myPref);
        void room.startAudio().catch(() => undefined);
      } catch {
        if (!cancelled) setConnectionStatus('disconnected');
      }
    })();

    return () => {
      cancelled = true;
      audioEntries.forEach((entry) => {
        entry.el.pause();
        entry.el.remove();
      });
      audioEntries.clear();
      void room.disconnect();
      roomRef.current = null;
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token, user?.id]);

  return { sendPreferenceChange, disconnect, roomRef };
}
