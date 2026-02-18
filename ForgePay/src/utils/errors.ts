import { Response } from 'express';

/**
 * API エラーレスポンスの標準形式
 *
 * すべてのエラーはこの形式で返す:
 * { "error": { "code": "...", "message": "...", "type": "..." } }
 */

type ErrorType = 'invalid_request_error' | 'authentication_error' | 'api_error' | 'rate_limit_error';

export interface ApiError {
  code: string;
  message: string;
  type: ErrorType;
}

/** 400 Bad Request */
export function badRequest(res: Response, message: string, code = 'invalid_request'): void {
  res.status(400).json({ error: { code, message, type: 'invalid_request_error' } });
}

/** 401 Unauthorized */
export function unauthorized(res: Response, message = '認証が必要です'): void {
  res.status(401).json({ error: { code: 'unauthorized', message, type: 'authentication_error' } });
}

/** 404 Not Found */
export function notFound(res: Response, message: string): void {
  res.status(404).json({
    error: {
      code: 'resource_not_found',
      message,
      type: 'invalid_request_error',
    },
  });
}

/** 409 Conflict */
export function conflict(res: Response, message: string): void {
  res.status(409).json({ error: { code: 'conflict', message, type: 'invalid_request_error' } });
}

/** 500 Internal Server Error */
export function internalError(res: Response, message = '内部エラーが発生しました'): void {
  res.status(500).json({ error: { code: 'internal_error', message, type: 'api_error' } });
}

/**
 * Error インスタンスから適切なレスポンスを返す
 * 既知のエラーメッセージに応じてステータスコードを切り替える
 */
export function handleServiceError(res: Response, error: unknown, context: string): void {
  if (!(error instanceof Error)) {
    internalError(res);
    return;
  }

  const msg = error.message;

  // 既知の Not Found エラー
  if (msg.endsWith(' not found')) {
    notFound(res, msg);
    return;
  }

  // 既知の Conflict エラー
  if (msg === 'Email already registered' || msg.includes('already exists')) {
    conflict(res, msg);
    return;
  }

  // その他は 500
  internalError(res, `${context}に失敗しました`);
}
