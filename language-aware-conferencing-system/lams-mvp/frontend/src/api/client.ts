/**
 * APIクライアント
 */
import { useAuthStore } from '../store/authStore';
import type { Room, User, SupportedLanguage, AudioMode } from '../types';

// 環境変数からAPI URLを取得、未設定の場合は相対パス（proxy経由）
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

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
};
