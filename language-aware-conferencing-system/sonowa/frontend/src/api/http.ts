/**
 * API 共通 HTTP 層（ApiError / apiFetch）
 *
 * 注意: apiErrorText 以外の api モジュールに依存しない（循環 import 防止）。
 */
import { useAuthStore } from '../store/authStore';
import { translateApiDetail } from './apiErrorText';

// APIベースURL
// 常に相対パス /api を使用し、Vite proxy経由でバックエンドにアクセス
// これにより、localhost/LAN IP どちらからアクセスしても同一originとなり、
// localStorageの認証トークンが共有される（業界ベストプラクティス）
const API_BASE = '/api';

/**
 * APIエラー
 * status: HTTPステータスコード（401/403/404等）
 * message: バックエンドの detail を UI 言語へ翻訳したメッセージ（未知の文言は原文）
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 共通fetchラッパー */
export async function apiFetch<T>(
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
    throw new ApiError(res.status, translateApiDetail(data.detail));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}
