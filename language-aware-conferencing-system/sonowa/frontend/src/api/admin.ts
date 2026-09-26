/**
 * 管理者 API（ユーザー・統計・言語設定・AI パイプライン・A/B 実験・再処理）
 *
 * 公開名は client.ts 経由で再エクスポートされる。
 */
import { apiFetch } from './http';
import {
  mapPipelineSettings,
  toPipelineSettingsPutBody,
  type PipelineSettingsApiResponse,
  type PipelineSettingsFields,
  type PipelineSettingsResponse,
} from './pipelineSettings';

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
/** A/B 実験群（表示用） */
export interface ExperimentVariantInfo {
  name: string;
  modelId: string;
  weight: number;
}

/** A/B 実験（表示用） */
export interface ExperimentInfo {
  key: string;
  stage: string;
  unit: string;
  enabled: boolean;
  variants: ExperimentVariantInfo[];
}

/** 指標の集計統計（1 群 1 指標） */
export interface MetricStat {
  count: number;
  mean: number;
  min: number;
  max: number;
}

/** 実験集計: 群名 → 指標名 → 統計 */
export type ExperimentSummary = Record<string, Record<string, MetricStat>>;

/** GET /admin/experiments の生レスポンス */
interface ExperimentApiResponse {
  key: string;
  stage: string;
  unit: string;
  enabled: boolean;
  variants: Array<{ name: string; model_id: string; weight: number }>;
}

/** GET /admin/experiments/{key}/summary の生レスポンス */
interface ExperimentSummaryApiResponse {
  experiment_key: string;
  summary: ExperimentSummary;
}

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

  /** パスワード再設定リンク用トークン発行（本番はメールが無いため管理者が本人へ渡す） */
  issuePasswordReset: async (
    userId: string
  ): Promise<{ resetToken: string; expiresInMinutes: number }> => {
    const res = await apiFetch<{ reset_token: string; expires_in_minutes: number }>(
      `/admin/users/${userId}/password-reset`,
      { method: 'POST' }
    );
    return { resetToken: res.reset_token, expiresInMinutes: res.expires_in_minutes };
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

  /** 言語設定取得 */
  getLanguageSettings: async (): Promise<LanguageSettings> => {
    const res = await apiFetch<LanguageSettingsApiResponse>('/admin/settings/languages');
    return {
      enabledLanguages: res.enabled_languages,
      allAvailableLanguages: res.all_available_languages,
    };
  },

  /** 言語設定更新 */
  updateLanguageSettings: async (enabledLanguages: string[]): Promise<LanguageSettings> => {
    const res = await apiFetch<LanguageSettingsApiResponse>('/admin/settings/languages', {
      method: 'PUT',
      body: JSON.stringify({ enabled_languages: enabledLanguages }),
    });
    return {
      enabledLanguages: res.enabled_languages,
      allAvailableLanguages: res.all_available_languages,
    };
  },

  /** AI パイプライン設定取得 */
  getAiPipelineSettings: async (): Promise<PipelineSettingsResponse> => {
    const res = await apiFetch<PipelineSettingsApiResponse>('/admin/settings/ai-pipeline');
    return mapPipelineSettings(res);
  },

  /** AI パイプライン設定更新 */
  updateAiPipelineSettings: async (
    fields: Partial<PipelineSettingsFields>
  ): Promise<PipelineSettingsResponse> => {
    const res = await apiFetch<PipelineSettingsApiResponse>('/admin/settings/ai-pipeline', {
      method: 'PUT',
      body: JSON.stringify(toPipelineSettingsPutBody(fields)),
    });
    return mapPipelineSettings(res);
  },

  /** A/B 実験一覧取得（P4-C） */
  listExperiments: async (): Promise<ExperimentInfo[]> => {
    const res = await apiFetch<ExperimentApiResponse[]>('/admin/experiments');
    return res.map((e) => ({
      key: e.key,
      stage: e.stage,
      unit: e.unit,
      enabled: e.enabled,
      variants: e.variants.map((v) => ({
        name: v.name,
        modelId: v.model_id,
        weight: v.weight,
      })),
    }));
  },

  /** A/B 実験の群×指標集計取得（P4-C） */
  getExperimentSummary: async (key: string): Promise<ExperimentSummary> => {
    const res = await apiFetch<ExperimentSummaryApiResponse>(
      `/admin/experiments/${encodeURIComponent(key)}/summary`
    );
    return res.summary;
  },

  /** 離線高品質再処理（本地モデル未導入時は 503） */
  rerunSession: async (sessionId: string): Promise<RerunSummary> => {
    const res = await apiFetch<RerunSummaryApiResponse>(
      `/admin/sessions/${encodeURIComponent(sessionId)}/rerun`,
      { method: 'POST' }
    );
    return {
      sessionId: res.session_id,
      total: res.total,
      done: res.done,
      skipped: res.skipped,
      failed: res.failed,
    };
  },
};

/** 離線 rerun 集計 */
export interface RerunSummary {
  sessionId: string;
  total: number;
  done: number;
  skipped: number;
  failed: number;
}

interface RerunSummaryApiResponse {
  session_id: string;
  total: number;
  done: number;
  skipped: number;
  failed: number;
}

/** 言語オプション */
export interface LanguageOption {
  code: string;
  name: string;
  tier: number;
}

/** 言語設定 */
export interface LanguageSettings {
  enabledLanguages: string[];
  allAvailableLanguages: LanguageOption[];
}

/** バックエンドの言語設定応答型（snake_case） */
interface LanguageSettingsApiResponse {
  enabled_languages: string[];
  all_available_languages: LanguageOption[];
}
