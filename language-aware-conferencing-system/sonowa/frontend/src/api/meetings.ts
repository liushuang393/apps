/**
 * 会議モード API（AI 主線 a/b/hybrid の取得・切替）
 *
 * 公開名は client.ts 経由で再エクスポートされる。
 */
import type { MeetingMode, MeetingSessionInfo } from '../types';
import { apiFetch } from './http';

/** 会議モード API 応答（snake_case） */
interface MeetingApiResponse {
  id: string;
  room_id: string;
  mode: string;
  is_active: boolean;
  enable_openai_s2s: boolean;
  language_routes: Record<string, unknown>;
}

function convertMeeting(m: MeetingApiResponse): MeetingSessionInfo {
  return {
    id: m.id,
    roomId: m.room_id,
    mode: m.mode as MeetingMode,
    isActive: m.is_active,
    enableOpenaiS2s: m.enable_openai_s2s,
    languageRoutes: m.language_routes || {},
  };
}

/** 会議AI主線（a/b/hybrid）の取得・切替。受聴の original/translated とは別概念。 */
export const meetingsApi = {
  /** アクティブセッションを副作用なく取得（無ければ null） */
  getActive: async (roomId: string): Promise<MeetingSessionInfo | null> => {
    const res = await apiFetch<MeetingApiResponse | null>(`/meetings/active/${roomId}`);
    return res ? convertMeeting(res) : null;
  },

  /** セッション開始/取得（作成者またはモデレーター） */
  start: async (
    roomId: string,
    data?: { mode?: MeetingMode; enableOpenaiS2s?: boolean }
  ): Promise<MeetingSessionInfo> => {
    const res = await apiFetch<MeetingApiResponse>('/meetings', {
      method: 'POST',
      body: JSON.stringify({
        room_id: roomId,
        mode: data?.mode,
        enable_openai_s2s: data?.enableOpenaiS2s,
      }),
    });
    return convertMeeting(res);
  },

  /** 進行中セッションの主線モードを更新 */
  updateMode: async (
    sessionId: string,
    data: { mode?: MeetingMode; enableOpenaiS2s?: boolean }
  ): Promise<MeetingSessionInfo> => {
    const res = await apiFetch<MeetingApiResponse>(`/meetings/${sessionId}/mode`, {
      method: 'PATCH',
      body: JSON.stringify({
        mode: data.mode,
        enable_openai_s2s: data.enableOpenaiS2s,
      }),
    });
    return convertMeeting(res);
  },
};
