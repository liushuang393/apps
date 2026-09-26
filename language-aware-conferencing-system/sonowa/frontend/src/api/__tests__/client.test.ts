/**
 * api/client の特性テスト（分割前の挙動を固定する）
 *
 * 目的: client.ts をドメイン別に分割しても URL / method / body /
 *       snake_case → camelCase 変換 / エラー処理が変わらないことを保証する。
 * 注意: 分割後もこのファイルは無変更で通ること。import は '../client'（バレル）のみ。
 *       fetch は vi.stubGlobal でモックし、実ネットワークには出ない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../store/authStore';
import {
  ApiError,
  adminApi,
  authApi,
  glossaryApi,
  meetingsApi,
  roomApi,
} from '../client';

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const TEST_TOKEN = 'test-token';

type FetchMock = ReturnType<typeof vi.fn>;

let fetchMock: FetchMock;

/** JSON 応答を返す fetch モックを設定する */
function respondJson(body: unknown, status: number = HTTP_OK): void {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

/** 直近 fetch 呼び出しの URL と RequestInit を取り出す */
function lastCall(): { url: string; init: RequestInit; body: unknown } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  return { url, init, body };
}

const userRaw = {
  id: 'u1',
  email: 'a@example.com',
  display_name: 'Alice',
  native_language: 'ja',
  role: 'admin',
  is_active: false,
};
const userConverted = {
  id: 'u1',
  email: 'a@example.com',
  displayName: 'Alice',
  nativeLanguage: 'ja',
  role: 'admin',
  isActive: false,
};

const roomRaw = {
  id: 'r1',
  name: 'Room',
  description: null,
  creator_id: 'u1',
  allowed_languages: ['ja', 'en'],
  default_audio_mode: 'original',
  allow_mode_switch: true,
  is_private: false,
  is_active: true,
  participant_count: 3,
};

const glossaryRaw = {
  id: 'g1',
  source_language: 'ja',
  target_language: 'en',
  source_term: '会議',
  target_term: 'meeting',
  term_type: 'general',
  priority: 100,
  do_not_translate: false,
  enabled: true,
};

const meetingRaw = {
  id: 'm1',
  room_id: 'r1',
  mode: 'a',
  is_active: true,
  enable_openai_s2s: false,
  language_routes: null,
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  useAuthStore.setState({ token: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiError', () => {
  it('status / message / name を保持し Error を継承する', () => {
    const err = new ApiError(HTTP_NOT_FOUND, 'not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(HTTP_NOT_FOUND);
    expect(err.message).toBe('not found');
    expect(err.name).toBe('ApiError');
  });
});

describe('apiFetch（authApi.me 経由）', () => {
  it('トークンがあれば Authorization ヘッダを付与し /api を前置する', async () => {
    useAuthStore.setState({ token: TEST_TOKEN });
    respondJson(userRaw);
    await authApi.me();
    const { url, init } = lastCall();
    expect(url).toBe('/api/auth/me');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_TOKEN}`,
    });
  });

  it('トークンが無ければ Authorization ヘッダを付けない', async () => {
    respondJson(userRaw);
    await authApi.me();
    expect(lastCall().init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('エラー時は detail 文字列を message にした ApiError を投げる', async () => {
    respondJson({ detail: 'ユーザーが見つかりません' }, HTTP_NOT_FOUND);
    const err = await authApi.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(HTTP_NOT_FOUND);
    expect((err as ApiError).message).toBe('ユーザーが見つかりません');
  });

  it('detail が文字列でなければ既定メッセージ', async () => {
    respondJson({ detail: [{ msg: 'x' }] }, HTTP_SERVER_ERROR);
    await expect(authApi.me()).rejects.toMatchObject({ status: HTTP_SERVER_ERROR, message: 'APIエラー' });
  });

  it('エラー本文が JSON でなくても既定メッセージ', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: HTTP_SERVER_ERROR }));
    await expect(authApi.me()).rejects.toMatchObject({ status: HTTP_SERVER_ERROR, message: 'APIエラー' });
  });

  it('204 は本文を読まず undefined で成功する', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: HTTP_NO_CONTENT }));
    await expect(glossaryApi.delete('g1')).resolves.toBeUndefined();
    const { url, init } = lastCall();
    expect(url).toBe('/api/glossaries/terms/g1');
    expect(init.method).toBe('DELETE');
  });
});

describe('authApi', () => {
  it('login: POST body と User 変換', async () => {
    respondJson({ access_token: 'tok', user: userRaw });
    const res = await authApi.login('a@example.com', 'pw');
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ email: 'a@example.com', password: 'pw' });
    expect(res).toEqual({ access_token: 'tok', user: userConverted });
  });

  it('me: role / is_active 欠落時の既定値', async () => {
    respondJson({ ...userRaw, role: '', is_active: undefined });
    const res = await authApi.me();
    expect(res.role).toBe('user');
    expect(res.isActive).toBe(true);
  });

  it('register: snake_case body', async () => {
    respondJson({ access_token: 'tok', user: userRaw });
    await authApi.register('a@example.com', 'pw', 'Alice', 'ja');
    expect(lastCall().body).toEqual({
      email: 'a@example.com',
      password: 'pw',
      display_name: 'Alice',
      native_language: 'ja',
    });
  });

  it('updateMe: PATCH /auth/me', async () => {
    respondJson({ access_token: 'tok', user: userRaw });
    await authApi.updateMe({ displayName: 'B' });
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/auth/me');
    expect(init.method).toBe('PATCH');
    expect(body).toEqual({ display_name: 'B' });
  });

  it('getHistory: 参加履歴の変換', async () => {
    respondJson([
      { room_id: 'r1', room_name: 'R', is_private: true, joined_at: 'j', updated_at: 'u' },
    ]);
    const res = await authApi.getHistory();
    expect(lastCall().url).toBe('/api/auth/history');
    expect(res).toEqual([
      { roomId: 'r1', roomName: 'R', isPrivate: true, joinedAt: 'j', updatedAt: 'u' },
    ]);
  });

  it('changePassword / パスワードリセット系の URL と body', async () => {
    respondJson({ access_token: 'tok', user: userRaw });
    await authApi.changePassword('old', 'new');
    expect(lastCall().url).toBe('/api/auth/me/password');
    expect(lastCall().body).toEqual({ current_password: 'old', new_password: 'new' });

    respondJson({ message: 'ok', reset_token: 't' });
    await expect(authApi.requestPasswordReset('a@example.com')).resolves.toEqual({ message: 'ok', reset_token: 't' });
    expect(lastCall().url).toBe('/api/auth/password-reset/request');
    expect(lastCall().body).toEqual({ email: 'a@example.com' });

    respondJson({ message: 'ok' });
    await authApi.confirmPasswordReset('t', 'new');
    expect(lastCall().url).toBe('/api/auth/password-reset/confirm');
    expect(lastCall().body).toEqual({ token: 't', new_password: 'new' });
  });
});

describe('roomApi', () => {
  it('get: Room 変換と既定値（defaultMode=hybrid, enableOpenaiS2s=true）', async () => {
    respondJson(roomRaw);
    const res = await roomApi.get('r1');
    expect(lastCall().url).toBe('/api/rooms/r1');
    expect(res).toEqual({
      id: 'r1',
      name: 'Room',
      description: null,
      creatorId: 'u1',
      allowedLanguages: ['ja', 'en'],
      defaultAudioMode: 'original',
      allowModeSwitch: true,
      isPrivate: false,
      isActive: true,
      participantCount: 3,
      defaultMode: 'hybrid',
      enableOpenaiS2s: true,
    });
  });

  it('list: rooms と total', async () => {
    respondJson({ rooms: [{ ...roomRaw, default_mode: 'a', enable_openai_s2s: false }], total: 1 });
    const res = await roomApi.list();
    expect(lastCall().url).toBe('/api/rooms');
    expect(res.total).toBe(1);
    expect(res.rooms[0].defaultMode).toBe('a');
    expect(res.rooms[0].enableOpenaiS2s).toBe(false);
  });

  it('create: POST snake_case body', async () => {
    respondJson(roomRaw);
    await roomApi.create({ name: 'Room', allowedLanguages: ['ja'], isPrivate: true, defaultMode: 'b' });
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/rooms');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ name: 'Room', allowed_languages: ['ja'], is_private: true, default_mode: 'b' });
  });

  it('getJoinToken: POST と変換', async () => {
    respondJson({ server_url: 'ws://lk', token: 't', room_id: 'r1', identity: 'u1' });
    const res = await roomApi.getJoinToken('r1');
    expect(lastCall().url).toBe('/api/rooms/r1/token');
    expect(lastCall().init.method).toBe('POST');
    expect(res).toEqual({ serverUrl: 'ws://lk', token: 't', roomId: 'r1', identity: 'u1' });
  });

  it('getTranscript: クエリと字幕/セッション変換', async () => {
    respondJson({
      room_id: 'r1',
      room_name: 'R',
      selected_session_id: 's1',
      sessions: [{ id: 's1', started_at: 'a', ended_at: null, is_active: true, mode: 'a' }],
      subtitles: [
        {
          id: 'sub1',
          speaker_id: 'u1',
          speaker_name: 'Alice',
          original_text: 'こんにちは',
          original_language: 'ja',
          translations: { en: 'hello' },
          timestamp: 't',
        },
      ],
      total: 1,
    });
    const res = await roomApi.getTranscript('r1', 'en', 's1');
    expect(lastCall().url).toBe('/api/rooms/r1/transcript?lang=en&session_id=s1');
    expect(res).toEqual({
      roomId: 'r1',
      roomName: 'R',
      selectedSessionId: 's1',
      sessions: [{ id: 's1', startedAt: 'a', endedAt: null, isActive: true, mode: 'a' }],
      subtitles: [
        {
          id: 'sub1',
          speakerId: 'u1',
          speakerName: 'Alice',
          originalText: 'こんにちは',
          originalLanguage: 'ja',
          translations: { en: 'hello' },
          timestamp: 't',
        },
      ],
      total: 1,
    });
  });

  it('getMinutes: クエリ無しと変換', async () => {
    respondJson({
      room_id: 'r1',
      room_name: 'R',
      session_id: null,
      output_language: 'ja',
      summary: 's',
      decisions: ['d'],
      action_items: ['a'],
      provider: 'p',
      segment_count: 2,
    });
    const res = await roomApi.getMinutes('r1');
    expect(lastCall().url).toBe('/api/rooms/r1/minutes');
    expect(res).toEqual({
      roomId: 'r1',
      roomName: 'R',
      sessionId: null,
      outputLanguage: 'ja',
      summary: 's',
      decisions: ['d'],
      actionItems: ['a'],
      provider: 'p',
      segmentCount: 2,
    });
  });
});

describe('adminApi', () => {
  it('listUsers: AdminUser 変換', async () => {
    respondJson([{ ...userRaw, created_at: 'c' }]);
    const res = await adminApi.listUsers();
    expect(lastCall().url).toBe('/api/admin/users');
    expect(res).toEqual([{ ...userConverted, createdAt: 'c' }]);
  });

  it('updateUser: PATCH snake_case body', async () => {
    respondJson({ ...userRaw, created_at: 'c' });
    await adminApi.updateUser('u1', { role: 'user', isActive: true });
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/admin/users/u1');
    expect(init.method).toBe('PATCH');
    expect(body).toEqual({ role: 'user', is_active: true });
  });

  it('issuePasswordReset: POST と変換', async () => {
    respondJson({ reset_token: 't', expires_in_minutes: 30 });
    const res = await adminApi.issuePasswordReset('u1');
    expect(lastCall().url).toBe('/api/admin/users/u1/password-reset');
    expect(lastCall().init.method).toBe('POST');
    expect(res).toEqual({ resetToken: 't', expiresInMinutes: 30 });
  });

  it('getStats: 統計変換', async () => {
    respondJson({ total_users: 1, active_users: 2, total_rooms: 3, active_rooms: 4, total_subtitles: 5 });
    const res = await adminApi.getStats();
    expect(lastCall().url).toBe('/api/admin/stats');
    expect(res).toEqual({ totalUsers: 1, activeUsers: 2, totalRooms: 3, activeRooms: 4, totalSubtitles: 5 });
  });

  it('updateLanguageSettings: PUT と変換', async () => {
    const langs = [{ code: 'ja', name: '日本語', tier: 1 }];
    respondJson({ enabled_languages: ['ja'], all_available_languages: langs });
    const res = await adminApi.updateLanguageSettings(['ja']);
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/admin/settings/languages');
    expect(init.method).toBe('PUT');
    expect(body).toEqual({ enabled_languages: ['ja'] });
    expect(res).toEqual({ enabledLanguages: ['ja'], allAvailableLanguages: langs });
  });

  it('updateAiPipelineSettings: PUT snake_case body と応答変換', async () => {
    const fields = {
      ai_provider: 'gpt_realtime',
      asr_provider: 'a',
      mt_provider: 'm',
      tts_provider: 't',
      default_mode: 'hybrid',
      enable_partial_subtitles: 1,
      llm_correction_enabled: 0,
    };
    respondJson({
      effective: fields,
      env_defaults: fields,
      options: { ai_provider: ['x'], asr_provider: [], mt_provider: [], tts_provider: [], default_mode: [] },
      revision: 7,
      warnings: ['w'],
    });
    const res = await adminApi.updateAiPipelineSettings({ aiProvider: 'deepgram', llmCorrectionEnabled: true });
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/admin/settings/ai-pipeline');
    expect(init.method).toBe('PUT');
    expect(body).toEqual({ ai_provider: 'deepgram', llm_correction_enabled: true });
    expect(res.effective).toEqual({
      aiProvider: 'gpt_realtime',
      asrProvider: 'a',
      mtProvider: 'm',
      ttsProvider: 't',
      defaultMode: 'hybrid',
      enablePartialSubtitles: true,
      llmCorrectionEnabled: false,
    });
    expect(res.options.aiProvider).toEqual(['x']);
    expect(res.revision).toBe(7);
    expect(res.warnings).toEqual(['w']);
  });

  it('listExperiments / getExperimentSummary', async () => {
    respondJson([
      { key: 'k', stage: 'mt', unit: 'room', enabled: true, variants: [{ name: 'A', model_id: 'm', weight: 1 }] },
    ]);
    const list = await adminApi.listExperiments();
    expect(lastCall().url).toBe('/api/admin/experiments');
    expect(list[0].variants).toEqual([{ name: 'A', modelId: 'm', weight: 1 }]);

    const summary = { A: { latency: { count: 1, mean: 2, min: 1, max: 3 } } };
    respondJson({ experiment_key: 'k/x', summary });
    await expect(adminApi.getExperimentSummary('k/x')).resolves.toEqual(summary);
    expect(lastCall().url).toBe('/api/admin/experiments/k%2Fx/summary');
  });

  it('rerunSession: POST と変換', async () => {
    respondJson({ session_id: 's1', total: 4, done: 2, skipped: 1, failed: 1 });
    const res = await adminApi.rerunSession('s1');
    expect(lastCall().url).toBe('/api/admin/sessions/s1/rerun');
    expect(lastCall().init.method).toBe('POST');
    expect(res).toEqual({ sessionId: 's1', total: 4, done: 2, skipped: 1, failed: 1 });
  });
});

describe('glossaryApi', () => {
  it('list: フィルタのクエリ化と変換', async () => {
    respondJson([glossaryRaw]);
    const res = await glossaryApi.list({ sourceLanguage: 'ja', enabled: false });
    expect(lastCall().url).toBe('/api/glossaries/terms?source_language=ja&enabled=false');
    expect(res).toEqual([
      {
        id: 'g1',
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        sourceTerm: '会議',
        targetTerm: 'meeting',
        termType: 'general',
        priority: 100,
        doNotTranslate: false,
        enabled: true,
      },
    ]);
  });

  it('create: 既定値を埋めた POST body', async () => {
    respondJson(glossaryRaw);
    await glossaryApi.create({ sourceLanguage: 'ja', targetLanguage: 'en', sourceTerm: '会議' });
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/glossaries/terms');
    expect(init.method).toBe('POST');
    expect(body).toEqual({
      source_language: 'ja',
      target_language: 'en',
      source_term: '会議',
      term_type: 'general',
      priority: 100,
      do_not_translate: false,
      enabled: true,
    });
  });

  it('update: PATCH（未指定は送らない）', async () => {
    respondJson(glossaryRaw);
    await glossaryApi.update('g1', { priority: 5 });
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/glossaries/terms/g1');
    expect(init.method).toBe('PATCH');
    expect(body).toEqual({ priority: 5 });
  });
});

describe('meetingsApi', () => {
  it('getActive: null はそのまま null', async () => {
    respondJson(null);
    await expect(meetingsApi.getActive('r1')).resolves.toBeNull();
    expect(lastCall().url).toBe('/api/meetings/active/r1');
  });

  it('getActive: 変換と language_routes 既定値', async () => {
    respondJson(meetingRaw);
    await expect(meetingsApi.getActive('r1')).resolves.toEqual({
      id: 'm1',
      roomId: 'r1',
      mode: 'a',
      isActive: true,
      enableOpenaiS2s: false,
      languageRoutes: {},
    });
  });

  it('start: POST body', async () => {
    respondJson(meetingRaw);
    await meetingsApi.start('r1', { mode: 'b' });
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/meetings');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ room_id: 'r1', mode: 'b' });
  });

  it('updateMode: PATCH body', async () => {
    respondJson(meetingRaw);
    await meetingsApi.updateMode('m1', { enableOpenaiS2s: true });
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/meetings/m1/mode');
    expect(init.method).toBe('PATCH');
    expect(body).toEqual({ enable_openai_s2s: true });
  });
});
