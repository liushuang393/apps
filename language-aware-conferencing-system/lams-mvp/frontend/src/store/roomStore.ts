/**
 * 会議室状態管理ストア
 */
import { create } from 'zustand';
import type {
  ParticipantPreference,
  RoomPolicy,
  SubtitleData,
  InterimSubtitleData,
} from '../types';

/** 接続状態タイプ */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface RoomState {
  roomId: string | null;
  roomName: string | null;
  policy: RoomPolicy | null;
  participants: Map<string, ParticipantPreference>;
  myPreference: ParticipantPreference | null;
  activeSpeaker: string | null;
  subtitles: SubtitleData[];
  /** ★ストリーミング字幕（認識中） */
  interimSubtitles: Map<string, InterimSubtitleData>;
  isConnected: boolean;
  /** 詳細な接続状態 */
  connectionStatus: ConnectionStatus;

  // アクション
  setRoomState: (
    roomId: string,
    roomName: string,
    policy: RoomPolicy,
    participants: ParticipantPreference[],
    myPreference: ParticipantPreference
  ) => void;
  addParticipant: (p: ParticipantPreference) => void;
  removeParticipant: (userId: string) => void;
  updateMyPreference: (pref: Partial<ParticipantPreference>) => void;
  setActiveSpeaker: (userId: string | null) => void;
  /** 参加者のマイク状態を更新 */
  updateParticipantMicStatus: (userId: string, isMicOn: boolean) => void;
  addSubtitle: (subtitle: SubtitleData) => void;
  /** ★ストリーミング字幕を追加・更新 */
  addInterimSubtitle: (subtitle: InterimSubtitleData) => void;
  /** ★暫定字幕を削除（確定時） */
  removeInterimSubtitle: (id: string) => void;
  clearSubtitles: () => void;
  setConnected: (connected: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  roomId: null,
  roomName: null,
  policy: null,
  participants: new Map(),
  myPreference: null,
  activeSpeaker: null,
  subtitles: [],
  interimSubtitles: new Map(),
  isConnected: false,
  connectionStatus: 'disconnected',

  setRoomState: (roomId, roomName, policy, participants, myPreference) =>
    set({
      roomId,
      roomName,
      policy,
      participants: new Map(participants.map((p) => [p.userId, p])),
      myPreference,
      isConnected: true,
      connectionStatus: 'connected',
    }),

  addParticipant: (p) =>
    set((state) => {
      const newMap = new Map(state.participants);
      newMap.set(p.userId, p);
      return { participants: newMap };
    }),

  removeParticipant: (userId) =>
    set((state) => {
      const newMap = new Map(state.participants);
      newMap.delete(userId);
      return { participants: newMap };
    }),

  updateMyPreference: (pref) =>
    set((state) => ({
      myPreference: state.myPreference
        ? { ...state.myPreference, ...pref }
        : null,
    })),

  setActiveSpeaker: (userId) => set({ activeSpeaker: userId }),

  updateParticipantMicStatus: (userId, isMicOn) =>
    set((state) => {
      const participant = state.participants.get(userId);
      if (!participant) return state;

      const newMap = new Map(state.participants);
      newMap.set(userId, { ...participant, isMicOn });
      return { participants: newMap };
    }),

  addSubtitle: (subtitle) =>
    set((state) => {
      // IDがある場合は重複チェック
      if (subtitle.id) {
        const isDuplicate = state.subtitles.some((s) => s.id === subtitle.id);
        if (isDuplicate) {
          // 重複字幕は無視
          return state;
        }
      }

      // 同じ話者の連続した同一テキストを除外（バックエンドの重複チェックの補完）
      const lastSubtitle = state.subtitles[state.subtitles.length - 1];
      if (
        lastSubtitle &&
        lastSubtitle.speakerId === subtitle.speakerId &&
        lastSubtitle.originalText === subtitle.originalText
      ) {
        // 同じ話者の同じテキストは無視
        return state;
      }

      // 新しい字幕を追加（最新50件を保持）
      const newSubtitles = [...state.subtitles, subtitle].slice(-50);

      // シーケンス番号がある場合はソート（順序保証）
      if (subtitle.seq !== undefined) {
        newSubtitles.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      }

      return { subtitles: newSubtitles };
    }),

  addInterimSubtitle: (subtitle) =>
    set((state) => {
      // ★ストリーミング字幕を追加・更新
      // 同じIDの字幕があれば更新、なければ追加
      const newMap = new Map(state.interimSubtitles);
      if (subtitle.isFinal) {
        // 確定時は削除（通常のsubtitleとして追加される）
        newMap.delete(subtitle.id);
      } else {
        newMap.set(subtitle.id, subtitle);
      }
      return { interimSubtitles: newMap };
    }),

  removeInterimSubtitle: (id) =>
    set((state) => {
      const newMap = new Map(state.interimSubtitles);
      newMap.delete(id);
      return { interimSubtitles: newMap };
    }),

  clearSubtitles: () => set({ subtitles: [], interimSubtitles: new Map() }),

  setConnected: (connected) => set({ isConnected: connected }),

  setConnectionStatus: (status) =>
    set({ connectionStatus: status, isConnected: status === 'connected' }),

  reset: () =>
    set({
      roomId: null,
      roomName: null,
      policy: null,
      participants: new Map(),
      myPreference: null,
      activeSpeaker: null,
      subtitles: [],
      interimSubtitles: new Map(),
      isConnected: false,
      connectionStatus: 'disconnected',
    }),
}));
