/**
 * 会議室 API（一覧・作成・参加トークン・会議記録・議事録）
 *
 * 公開名は client.ts 経由で再エクスポートされる。
 */
import type { Room, SupportedLanguage, AudioMode, MeetingMode } from '../types';
import { apiFetch } from './http';

/** バックエンドのRoom応答型（snake_case） */
interface RoomApiResponse {
  id: string;
  name: string;
  description: string | null;
  creator_id: string;
  allowed_languages: string[];
  default_audio_mode: string;
  allow_mode_switch: boolean;
  is_private: boolean;
  is_active: boolean;
  participant_count: number;
  default_mode?: string;
  enable_openai_s2s?: boolean;
  language_routes?: Record<string, unknown>;
}

/** snake_case → camelCase 変換 */
function convertRoom(r: RoomApiResponse): Room {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    creatorId: r.creator_id,
    allowedLanguages: r.allowed_languages as SupportedLanguage[],
    defaultAudioMode: r.default_audio_mode as AudioMode,
    allowModeSwitch: r.allow_mode_switch,
    isPrivate: r.is_private,
    isActive: r.is_active,
    participantCount: r.participant_count,
    defaultMode: (r.default_mode as MeetingMode) || 'hybrid',
    enableOpenaiS2s: r.enable_openai_s2s ?? true,
  };
}

/** 字幕（会議記録用） */
export interface SubtitleRecord {
  id: string;
  speakerId: string;
  speakerName: string;
  originalText: string;
  originalLanguage: string;
  translations: Record<string, string>;
  timestamp: string;
}

/** 会議記録レスポンス */
export interface TranscriptData {
  roomId: string;
  roomName: string;
  selectedSessionId: string | null;
  sessions: SessionSummary[];
  subtitles: SubtitleRecord[];
  total: number;
}

export interface SessionSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  mode: string;
}

/** バックエンドの字幕レスポンス（snake_case） */
interface SubtitleApiResponse {
  id: string;
  speaker_id: string;
  speaker_name: string;
  original_text: string;
  original_language: string;
  translations: Record<string, string>;
  timestamp: string;
}

/** バックエンドの会議記録レスポンス（snake_case） */
interface TranscriptApiResponse {
  room_id: string;
  room_name: string;
  selected_session_id: string | null;
  sessions: Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    is_active: boolean;
    mode: string;
  }>;
  subtitles: SubtitleApiResponse[];
  total: number;
}

/** 字幕 snake_case → camelCase 変換 */
function convertSubtitle(s: SubtitleApiResponse): SubtitleRecord {
  return {
    id: s.id,
    speakerId: s.speaker_id,
    speakerName: s.speaker_name,
    originalText: s.original_text,
    originalLanguage: s.original_language,
    translations: s.translations,
    timestamp: s.timestamp,
  };
}

/** LiveKit 参加トークン（camelCase） */
export interface JoinToken {
  serverUrl: string;
  token: string;
  roomId: string;
  identity: string;
}

/** バックエンドの LiveKit トークン応答型（snake_case） */
interface JoinTokenApiResponse {
  server_url: string;
  token: string;
  room_id: string;
  identity: string;
}

/** 会議室API */
export const roomApi = {
  /** 一覧取得 */
  list: async (): Promise<{ rooms: Room[]; total: number }> => {
    const res = await apiFetch<{ rooms: RoomApiResponse[]; total: number }>('/rooms');
    return {
      rooms: res.rooms.map(convertRoom),
      total: res.total,
    };
  },

  /** 詳細取得 */
  get: async (roomId: string): Promise<Room> => {
    const res = await apiFetch<RoomApiResponse>(`/rooms/${roomId}`);
    return convertRoom(res);
  },

  /** 作成 */
  create: async (data: {
    name: string;
    description?: string;
    allowedLanguages?: string[];
    defaultAudioMode?: string;
    allowModeSwitch?: boolean;
    isPrivate?: boolean;
    defaultMode?: MeetingMode;
    enableOpenaiS2s?: boolean;
  }): Promise<Room> => {
    const res = await apiFetch<RoomApiResponse>('/rooms', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        allowed_languages: data.allowedLanguages,
        default_audio_mode: data.defaultAudioMode,
        allow_mode_switch: data.allowModeSwitch,
        is_private: data.isPrivate,
        default_mode: data.defaultMode,
        enable_openai_s2s: data.enableOpenaiS2s,
      }),
    });
    return convertRoom(res);
  },

  /** LiveKit 参加トークン発行（POST /rooms/{id}/token） */
  getJoinToken: async (roomId: string): Promise<JoinToken> => {
    const res = await apiFetch<JoinTokenApiResponse>(`/rooms/${roomId}/token`, {
      method: 'POST',
    });
    return {
      serverUrl: res.server_url,
      token: res.token,
      roomId: res.room_id,
      identity: res.identity,
    };
  },

  /** 会議記録取得 */
  getTranscript: async (
    roomId: string,
    lang?: string,
    sessionId?: string
  ): Promise<TranscriptData> => {
    const params = new URLSearchParams();
    if (lang) params.set('lang', lang);
    if (sessionId) params.set('session_id', sessionId);
    const queryParams = params.toString() ? `?${params.toString()}` : '';
    const res = await apiFetch<TranscriptApiResponse>(`/rooms/${roomId}/transcript${queryParams}`);
    return {
      roomId: res.room_id,
      roomName: res.room_name,
      selectedSessionId: res.selected_session_id,
      sessions: res.sessions.map((session) => ({
        id: session.id,
        startedAt: session.started_at,
        endedAt: session.ended_at,
        isActive: session.is_active,
        mode: session.mode,
      })),
      subtitles: res.subtitles.map(convertSubtitle),
      total: res.total,
    };
  },

  /** 議事録（要約・決定・ToDo）をオンデマンド生成 */
  getMinutes: async (
    roomId: string,
    lang?: string,
    sessionId?: string
  ): Promise<MinutesData> => {
    const params = new URLSearchParams();
    if (lang) params.set('lang', lang);
    if (sessionId) params.set('session_id', sessionId);
    const queryParams = params.toString() ? `?${params.toString()}` : '';
    const res = await apiFetch<MinutesApiResponse>(
      `/rooms/${roomId}/minutes${queryParams}`
    );
    return {
      roomId: res.room_id,
      roomName: res.room_name,
      sessionId: res.session_id,
      outputLanguage: res.output_language,
      summary: res.summary,
      decisions: res.decisions,
      actionItems: res.action_items,
      provider: res.provider,
      segmentCount: res.segment_count,
    };
  },
};

/** 議事録（camelCase） */
export interface MinutesData {
  roomId: string;
  roomName: string;
  sessionId: string | null;
  outputLanguage: string;
  summary: string;
  decisions: string[];
  actionItems: string[];
  provider: string;
  segmentCount: number;
}

/** 議事録 API 応答（snake_case） */
interface MinutesApiResponse {
  room_id: string;
  room_name: string;
  session_id: string | null;
  output_language: string;
  summary: string;
  decisions: string[];
  action_items: string[];
  provider: string;
  segment_count: number;
}
