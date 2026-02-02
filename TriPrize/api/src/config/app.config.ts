/**
 * Application Configuration
 *
 * 目的: アプリケーション全体の設定を一元管理
 * 注意点: 新規アプリを作成する際はここの値を変更してください
 *
 * このファイルを編集することで、フレームワークを新しいアプリに適用できます。
 */

import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Application identity configuration
 * 新規アプリを作成する際は以下の値を変更してください
 */
export const APP_CONFIG = {
  // アプリケーション名（英語）
  name: process.env.APP_NAME || 'TriPrize',

  // アプリケーション名（表示用）
  displayName: process.env.APP_DISPLAY_NAME || 'TriPrize',

  // アプリケーションの説明
  description:
    process.env.APP_DESCRIPTION || 'Triangle lottery campaign sales platform',

  // APIバージョン
  version: process.env.APP_VERSION || '1.0.0',

  // ドキュメントURL
  documentationUrl: process.env.APP_DOCS_URL || '/api/docs',
} as const;

/**
 * Server configuration
 */
export const SERVER_CONFIG = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  isTest: process.env.NODE_ENV === 'test',
} as const;

/**
 * JWT Secret 検証
 * 目的: 本番環境で弱いシークレットを使用しないことを保証
 * 注意点: シークレットは最低32文字必要
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!secret && isProduction) {
    throw new Error('JWT_SECRET環境変数は本番環境で必須です');
  }

  if (secret && secret.length < 32) {
    if (isProduction) {
      throw new Error('JWT_SECRETは32文字以上必要です（セキュリティ要件）');
    }
    console.warn('警告: JWT_SECRETが32文字未満です。本番環境では32文字以上のシークレットを使用してください');
  }

  return secret || 'development-secret-key-for-local-dev-only';
}

/**
 * Security configuration
 * 注意点: 本番環境では必ず強力なJWT_SECRETを設定すること
 */
export const SECURITY_CONFIG = {
  jwtSecret: getJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins: process.env.CORS_ORIGIN?.split(',') || ['*'],
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
} as const;

/**
 * Feature flags
 * 機能のオン/オフを制御
 */
export const FEATURE_FLAGS = {
  // 認証モード
  useMockAuth: process.env.USE_MOCK_AUTH === 'true',

  // 決済モード
  useMockPayment: process.env.USE_MOCK_PAYMENT === 'true',

  // プッシュ通知
  enablePushNotifications: process.env.ENABLE_PUSH_NOTIFICATIONS !== 'false',

  // デバッグログ
  enableDebugLogging: process.env.ENABLE_DEBUG_LOGGING === 'true',
} as const;

export default {
  APP_CONFIG,
  SERVER_CONFIG,
  SECURITY_CONFIG,
  FEATURE_FLAGS,
};

