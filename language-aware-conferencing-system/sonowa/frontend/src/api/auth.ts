/**
 * 認証 API（ログイン・登録・プロフィール・パスワード）
 *
 * 公開名は client.ts 経由で再エクスポートされる。
 */
import type { User, SupportedLanguage } from '../types';
import { apiFetch } from './http';

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

/** 認証API応答型（snake_case） */
interface AuthApiResponse {
  access_token: string;
  user: UserApiResponse;
}

/** 会議参加履歴（camelCase） */
export interface ParticipationHistory {
  roomId: string;
  roomName: string;
  isPrivate: boolean;
  joinedAt: string;
  updatedAt: string;
}

/** 会議参加履歴 API 応答（snake_case） */
interface ParticipationHistoryApiResponse {
  room_id: string;
  room_name: string;
  is_private: boolean;
  joined_at: string;
  updated_at: string;
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

  /** 自己プロフィール更新（トークン再発行） */
  updateMe: async (data: {
    displayName?: string;
    nativeLanguage?: string;
  }): Promise<{ access_token: string; user: User }> => {
    const res = await apiFetch<AuthApiResponse>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({
        display_name: data.displayName,
        native_language: data.nativeLanguage,
      }),
    });
    return {
      access_token: res.access_token,
      user: convertUser(res.user),
    };
  },

  /** 自分の会議参加履歴 */
  getHistory: async (): Promise<ParticipationHistory[]> => {
    const res = await apiFetch<ParticipationHistoryApiResponse[]>('/auth/history');
    return res.map((row) => ({
      roomId: row.room_id,
      roomName: row.room_name,
      isPrivate: row.is_private,
      joinedAt: row.joined_at,
      updatedAt: row.updated_at,
    }));
  },

  /** パスワードリセットリクエスト */
  requestPasswordReset: async (email: string): Promise<{ message: string; reset_token?: string }> => {
    return apiFetch('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  /** ログイン中の本人によるパスワード変更（現在のパスワードが必要）。他端末は失効し、新トークンが返る */
  changePassword: async (
    currentPassword: string,
    newPassword: string,
  ): Promise<{ access_token: string; user: User }> => {
    const res = await apiFetch<AuthApiResponse>('/auth/me/password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    return {
      access_token: res.access_token,
      user: convertUser(res.user),
    };
  },

  /** パスワードリセット確認 */
  confirmPasswordReset: async (token: string, newPassword: string): Promise<{ message: string }> => {
    return apiFetch('/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword }),
    });
  },
};
