/**
 * 会議室状態管理ストア
 */
import { create } from 'zustand';
import type {
  ParticipantPreference,
  RoomPolicy,
  SubtitleData,
} from '../types';

interface RoomState {
  roomId: string | null;
  roomName: string | null;
  policy: RoomPolicy | null;
  participants: Map<string, ParticipantPreference>;
  myPreference: ParticipantPreference | null;
  activeSpeaker: string | null;
  subtitles: SubtitleData[];
  isConnected: boolean;

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
  addSubtitle: (subtitle: SubtitleData) => void;
  clearSubtitles: () => void;
  setConnected: (connected: boolean) => void;
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
  isConnected: false,

  setRoomState: (roomId, roomName, policy, participants, myPreference) =>
    set({
      roomId,
      roomName,
      policy,
      participants: new Map(participants.map((p) => [p.userId, p])),
      myPreference,
      isConnected: true,
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

  addSubtitle: (subtitle) =>
    set((state) => ({
      subtitles: [...state.subtitles.slice(-9), subtitle], // 最新10件
    })),

  clearSubtitles: () => set({ subtitles: [] }),

  setConnected: (connected) => set({ isConnected: connected }),

  reset: () =>
    set({
      roomId: null,
      roomName: null,
      policy: null,
      participants: new Map(),
      myPreference: null,
      activeSpeaker: null,
      subtitles: [],
      isConnected: false,
    }),
}));
