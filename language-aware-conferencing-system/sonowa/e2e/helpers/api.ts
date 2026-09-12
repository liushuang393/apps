/**
 * Sonowa E2E API helper（Bearer JWT）
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

/** GET /api/auth/me */
export async function getMe(token: string): Promise<
  ApiResult<{
    id: string;
    email: string;
    display_name: string;
    native_language: string;
    role: string;
  }>
> {
  return apiFetch("/api/auth/me", { token });
}

/** PATCH /api/auth/me */
export async function patchMe(
  token: string,
  body: { display_name?: string; native_language?: string },
): Promise<ApiResult<{ access_token?: string; user?: { display_name?: string } }>> {
  return apiFetch("/api/auth/me", {
    method: "PATCH",
    token,
    body,
  });
}

/** GET /api/auth/history */
export async function getHistory(token: string): Promise<
  ApiResult<Array<{ room_id: string; room_name: string }>>
> {
  return apiFetch("/api/auth/history", { token });
}

/** GET /api/admin/users（admin のみ） */
export async function listAdminUsers(token: string): Promise<
  ApiResult<Array<{ id: string; email: string; role: string; native_language?: string }>>
> {
  return apiFetch("/api/admin/users", { token });
}

/** GET /api/admin/settings/languages */
export async function getLanguageSettings(token: string): Promise<ApiResult<unknown>> {
  return apiFetch("/api/admin/settings/languages", { token });
}

/** GET /api/admin/experiments */
export async function listExperiments(token: string): Promise<ApiResult<unknown>> {
  return apiFetch("/api/admin/experiments", { token });
}

/** GET /api/glossaries/terms（admin のみ） */
export async function listGlossaryTerms(token: string): Promise<
  ApiResult<Array<{ id: string; source_term: string; target_term?: string | null }>>
> {
  return apiFetch("/api/glossaries/terms", { token });
}

/** POST /api/glossaries/terms（admin のみ） */
export async function createGlossaryTerm(
  token: string,
  body: {
    source_language: string;
    target_language: string;
    source_term: string;
    target_term?: string | null;
    term_type?: string;
    do_not_translate?: boolean;
  },
): Promise<ApiResult<{ id: string; source_term: string }>> {
  return apiFetch("/api/glossaries/terms", {
    method: "POST",
    token,
    body: {
      term_type: "general",
      ...body,
    },
  });
}

/** DELETE /api/glossaries/terms/{id}（admin のみ） */
export async function deleteGlossaryTerm(
  token: string,
  termId: string,
): Promise<ApiResult<unknown>> {
  return apiFetch(`/api/glossaries/terms/${encodeURIComponent(termId)}`, {
    method: "DELETE",
    token,
  });
}

/** GET /api/rooms/{id}/minutes */
export async function getMinutes(
  token: string,
  roomId: string,
  lang = "ja",
): Promise<ApiResult<unknown>> {
  return apiFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/minutes?lang=${encodeURIComponent(lang)}`,
    { token },
  );
}

/** POST /api/admin/sessions/{id}/rerun（admin のみ） */
export async function rerunSession(
  token: string,
  sessionId: string,
): Promise<ApiResult<unknown>> {
  return apiFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/rerun`, {
    method: "POST",
    token,
  });
}
