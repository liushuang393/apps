/**
 * 会議室状態管理ストア
 */
import { create } from 'zustand';
import type {
  ParticipantPreference,
  RoomPolicy,
  SubtitleData,
  InterimSubtitleData,
  QosWarningData,
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
  /** ★ストリーミング字幕（認識中、id キー・レガシー経路） */
  interimSubtitles: Map<string, InterimSubtitleData>;
  /**
   * ★暫定字幕（partial）: 話者IDごとに最新の1行を保持する。
   * backend の partial 字幕は id が空のため speaker_id をキーにし、
   * revision で上書き更新する（P2 低遅延の首字表示）。
   */
  interimBySpeaker: Record<string, SubtitleData>;
  isConnected: boolean;
  /** 詳細な接続状態 */
  connectionStatus: ConnectionStatus;
  /** 接続エラーの詳細 */
  connectionError: string | null;
  /** QoS 警告履歴（最新数件） */
  qosWarnings: QosWarningData[];

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
  setConnectionError: (message: string | null) => void;
  addQosWarning: (warning: QosWarningData) => void;
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
  interimBySpeaker: {},
  isConnected: false,
  connectionStatus: 'disconnected',
  connectionError: null,
  qosWarnings: [],

  setRoomState: (roomId, roomName, policy, participants, myPreference) =>
    set({
      roomId,
      roomName,
      policy,
      participants: new Map(participants.map((p) => [p.userId, p])),
      myPreference,
      isConnected: true,
      connectionStatus: 'connected',
      connectionError: null,
      qosWarnings: [],
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
      // ★暫定字幕（partial）: 話者ごとに1行を revision で上書き更新する。
      // id が空のため speaker_id をキーにし、確定字幕とは別状態で管理する。
      if (subtitle.isPartial === true) {
        const prev = state.interimBySpeaker[subtitle.speakerId];
        const prevRevision = prev?.revision ?? -1;
        const nextRevision = subtitle.revision ?? 0;
        // 順序逆転ガード: revision がより大きい時のみ上書き（古い partial は破棄）
        if (prev && nextRevision <= prevRevision) {
          return state;
        }
        return {
          interimBySpeaker: { ...state.interimBySpeaker, [subtitle.speakerId]: subtitle },
        };
      }

      // IDがある場合は重複チェック（改善点 D1: id は発話単位で全言語グループ共通の
      // ため、同一 id でも targetLanguage が異なれば別字幕。(id, 言語) 複合キーで
      // 判定し、言語切替時に新言語の字幕を取りこぼさない）。
      if (subtitle.id) {
        const isDuplicate = state.subtitles.some(
          (s) => s.id === subtitle.id && s.targetLanguage === subtitle.targetLanguage,
        );
        if (isDuplicate) {
          // 重複字幕は無視
          return state;
        }
      }

      // 新しい字幕を追加（最新50件を保持）
      const newSubtitles = [...state.subtitles, subtitle].slice(-50);

      // シーケンス番号がある場合はソート（順序保証）
      if (subtitle.seq !== undefined) {
        newSubtitles.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      }

      // 確定字幕が届いたら、その話者の暫定字幕行を消す（確定行へ置き換わる）
      if (state.interimBySpeaker[subtitle.speakerId]) {
        const nextInterim = { ...state.interimBySpeaker };
        delete nextInterim[subtitle.speakerId];
        return { subtitles: newSubtitles, interimBySpeaker: nextInterim };
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

  clearSubtitles: () =>
    set({ subtitles: [], interimSubtitles: new Map(), interimBySpeaker: {} }),

  setConnected: (connected) => set({ isConnected: connected }),

  setConnectionStatus: (status) =>
    set({ connectionStatus: status, isConnected: status === 'connected' }),

  setConnectionError: (message) => set({ connectionError: message }),

  addQosWarning: (warning) =>
    set((state) => ({
      qosWarnings: [...state.qosWarnings, warning].slice(-5),
    })),

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
      interimBySpeaker: {},
      isConnected: false,
      connectionStatus: 'disconnected',
      connectionError: null,
      qosWarnings: [],
    }),
}));
