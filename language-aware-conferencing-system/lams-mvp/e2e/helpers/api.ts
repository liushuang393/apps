/**
 * LAMS E2E API helper（Bearer JWT）
 *
 * 目的: rooms / transcript / ai-pipeline の薄い fetch ラッパー。
 * 注意: トークン・パスワード等の秘密はログに出さない。
 */
import { API_BASE_URL } from "./navigation";

function apiBase(): string {
  return (process.env.E2E_API_BASE_URL ?? API_BASE_URL).replace(/\/$/, "");
}

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
  rawText: string;
}

async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const res = await fetch(`${apiBase()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const rawText = await res.text();
  let data: T | null = null;
  try {
    data = rawText ? (JSON.parse(rawText) as T) : null;
  } catch {
    data = null;
  }

  return {
    status: res.status,
    ok: res.ok,
    data,
    rawText,
  };
}

/** GET /health（認証不要） */
export async function getHealth(): Promise<ApiResult<{ status?: string }>> {
  return apiFetch("/health");
}

/** GET /api/rooms */
export async function listRooms(token: string): Promise<
  ApiResult<{ rooms: Array<{ id: string; name: string }>; total: number }>
> {
  return apiFetch("/api/rooms", { token });
}

/** POST /api/rooms */
export async function createRoom(
  token: string,
  body: {
    name: string;
    description?: string;
    allowed_languages?: string[];
    default_audio_mode?: string;
    allow_mode_switch?: boolean;
    is_private?: boolean;
    default_mode?: string;
  },
): Promise<ApiResult<{ id: string; name: string }>> {
  return apiFetch("/api/rooms", {
    method: "POST",
    token,
    body: {
      allowed_languages: ["ja", "en"],
      default_audio_mode: "original",
      allow_mode_switch: true,
      is_private: false,
      default_mode: "hybrid",
      ...body,
    },
  });
}

/** GET /api/rooms/{id}/transcript */
export async function getTranscript(
  token: string,
  roomId: string,
): Promise<ApiResult<unknown>> {
  return apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/transcript`, {
    token,
  });
}

/** GET /api/admin/settings/ai-pipeline（認証ユーザー可） */
export async function getAiPipelineSettings(
  token: string,
): Promise<ApiResult<unknown>> {
  return apiFetch("/api/admin/settings/ai-pipeline", { token });
}

/** PUT /api/admin/settings/ai-pipeline（admin のみ） */
export async function putAiPipelineSettings(
  token: string,
  body: Record<string, unknown>,
): Promise<ApiResult<unknown>> {
  return apiFetch("/api/admin/settings/ai-pipeline", {
    method: "PUT",
    token,
    body,
  });
}
