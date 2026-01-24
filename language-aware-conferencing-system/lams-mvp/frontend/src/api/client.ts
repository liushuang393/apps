/**
 * APIクライアント
 */
import { useAuthStore } from '../store/authStore';
import type { Room, User, SupportedLanguage, AudioMode } from '../types';

// APIベースURL
// 常に相対パス /api を使用し、Vite proxy経由でバックエンドにアクセス
// これにより、localhost/LAN IP どちらからアクセスしても同一originとなり、
// localStorageの認証トークンが共有される（業界ベストプラクティス）
const API_BASE = '/api';

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
  };
}

/** バックエンドのUser応答型（snake_case） */
interface UserApiResponse {
  id: string;
  email: string;
  display_name: string;
  native_language: string;
  role: string;
  is_active: boolean;
}

/** User snake_case → camelCase 変換 */
function convertUser(u: UserApiResponse): User {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    nativeLanguage: u.native_language as SupportedLanguage,
    role: (u.role || 'user') as User['role'],
    isActive: u.is_active ?? true,
  };
}

/** APIエラー */
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 共通fetchラッパー */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.detail || 'APIエラー');
  }

  return res.json();
}

/** 認証API応答型（snake_case） */
interface AuthApiResponse {
  access_token: string;
  user: UserApiResponse;
}

/** 認証API */
export const authApi = {
  /** ログイン */
  login: async (email: string, password: string): Promise<{ access_token: string; user: User }> => {
    const res = await apiFetch<AuthApiResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return {
      access_token: res.access_token,
      user: convertUser(res.user),
    };
  },

  /** 登録 */
  register: async (
    email: string,
    password: string,
    displayName: string,
    nativeLanguage: string
  ): Promise<{ access_token: string; user: User }> => {
    const res = await apiFetch<AuthApiResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        display_name: displayName,
        native_language: nativeLanguage,
      }),
    });
    return {
      access_token: res.access_token,
      user: convertUser(res.user),
    };
  },

  /** 現在のユーザー取得 */
  me: async (): Promise<User> => {
    const res = await apiFetch<UserApiResponse>('/auth/me');
    return convertUser(res);
  },

  /** パスワードリセットリクエスト */
  requestPasswordReset: async (email: string): Promise<{ message: string; reset_token?: string }> => {
    return apiFetch('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  /** パスワードリセット確認 */
  confirmPasswordReset: async (token: string, newPassword: string): Promise<{ message: string }> => {
    return apiFetch('/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword }),
    });
  },
};

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
  subtitles: SubtitleRecord[];
  total: number;
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
      }),
    });
    return convertRoom(res);
  },

  /** 会議記録取得 */
  getTranscript: async (roomId: string, lang?: string): Promise<TranscriptData> => {
    const queryParams = lang ? `?lang=${encodeURIComponent(lang)}` : '';
    const res = await apiFetch<TranscriptApiResponse>(`/rooms/${roomId}/transcript${queryParams}`);
    return {
      roomId: res.room_id,
      roomName: res.room_name,
      subtitles: res.subtitles.map(convertSubtitle),
      total: res.total,
    };
  },
};

/** 管理者用ユーザー情報 */
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  nativeLanguage: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

/** システム統計 */
export interface SystemStats {
  totalUsers: number;
  activeUsers: number;
  totalRooms: number;
  activeRooms: number;
  totalSubtitles: number;
}

/** バックエンドのAdminUser応答型（snake_case） */
interface AdminUserApiResponse {
  id: string;
  email: string;
  display_name: string;
  native_language: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

/** バックエンドのシステム統計応答型（snake_case） */
interface SystemStatsApiResponse {
  total_users: number;
  active_users: number;
  total_rooms: number;
  active_rooms: number;
  total_subtitles: number;
}

/** AdminUser snake_case → camelCase 変換 */
function convertAdminUser(u: AdminUserApiResponse): AdminUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    nativeLanguage: u.native_language,
    role: u.role,
    isActive: u.is_active,
    createdAt: u.created_at,
  };
}

/** 管理者API */
export const adminApi = {
  /** ユーザー一覧取得 */
  listUsers: async (): Promise<AdminUser[]> => {
    const res = await apiFetch<AdminUserApiResponse[]>('/admin/users');
    return res.map(convertAdminUser);
  },

  /** ユーザー詳細取得 */
  getUser: async (userId: string): Promise<AdminUser> => {
    const res = await apiFetch<AdminUserApiResponse>(`/admin/users/${userId}`);
    return convertAdminUser(res);
  },

  /** ユーザー更新 */
  updateUser: async (userId: string, data: {
    displayName?: string;
    nativeLanguage?: string;
    role?: string;
    isActive?: boolean;
  }): Promise<AdminUser> => {
    const res = await apiFetch<AdminUserApiResponse>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        display_name: data.displayName,
        native_language: data.nativeLanguage,
        role: data.role,
        is_active: data.isActive,
      }),
    });
    return convertAdminUser(res);
  },

  /** システム統計取得 */
  getStats: async (): Promise<SystemStats> => {
    const res = await apiFetch<SystemStatsApiResponse>('/admin/stats');
    return {
      totalUsers: res.total_users,
      activeUsers: res.active_users,
      totalRooms: res.total_rooms,
      activeRooms: res.active_rooms,
      totalSubtitles: res.total_subtitles,
    };
  },
};
