/**
 * Firebase Admin SDK Configuration
 *
 * 公式のサービスアカウントJSONファイルを使用してFirebase Admin SDKを初期化。
 * 環境変数 FIREBASE_SERVICE_ACCOUNT_KEY_PATH でJSONファイルのパスを指定。
 *
 * 設計方針：
 * - 公式JSONファイルをそのまま使用（官方変更に強い）
 * - 環境毎に異なるJSONファイルを使用可能
 * - シングルトンパターンでアプリインスタンスを管理
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import logger from '../utils/logger.util';
import { FirebaseServiceAccountConfig } from './firebase-service-account.config';

dotenv.config();

let firebaseApp: admin.app.App | null = null;

/**
 * サーバー時刻の同期チェック
 * JWT署名エラーはクロックスキューが原因で発生することが多い
 */
function checkServerTimeSync(): void {
  const serverTime = new Date();
  const serverTimeISO = serverTime.toISOString();
  const timeDiff = Math.abs(serverTime.getTime() - Date.now());

  if (timeDiff > 60000) {
    logger.warn('Server time may be out of sync', {
      timeDiff,
      serverTime: serverTimeISO,
      warning: 'JWT signature errors may occur if server time is not properly synced',
    });
  } else {
    logger.debug('Server time synchronized', { serverTime: serverTimeISO });
  }
}

/**
 * Firebase Admin SDK を初期化
 * サービスアカウントJSONファイルから認証情報を読み込む
 */
export function initializeFirebase(): admin.app.App | null {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // サービスアカウント設定が無い場合はテストモードで動作
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH) {
      logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_KEY_PATH not configured - running in test mode without Firebase'
      );
      return null;
    }

    // サーバー時刻の同期チェック
    checkServerTimeSync();

    // サービスアカウント設定を読み込み
    const serviceAccountConfig = FirebaseServiceAccountConfig.getInstance();
    const serviceAccount = serviceAccountConfig.getServiceAccount();

    // Firebase Admin SDK を初期化（公式推奨: JSONをそのまま渡す）
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      projectId: serviceAccount.project_id,
    });

    logger.info('✓ Firebase Admin SDK initialized successfully', {
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      configFile: serviceAccountConfig.getLoadedConfigPath(),
    });

    return firebaseApp;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code: string }).code
        : undefined;
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error('Firebase initialization failed', {
      error: errorMessage,
      errorCode,
      stack: errorStack,
      hasServiceAccountPath: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH,
    });

    // 本番環境ではFirebaseが必須
    if (process.env.NODE_ENV === 'production' && process.env.USE_MOCK_AUTH !== 'true') {
      logger.error('Firebase is required in production mode - exiting');
      throw new Error(
        `Firebase initialization failed: ${errorMessage}. ` +
        'Please check your Firebase service account configuration.'
      );
    }

    return null;
  }
}

export function getFirebaseApp(): admin.app.App | null {
  if (!firebaseApp) {
    return initializeFirebase();
  }
  return firebaseApp;
}

export function getAuth(): admin.auth.Auth | null {
  const app = getFirebaseApp();
  if (!app) {
    logger.warn('Firebase not initialized - auth operations will fail', {
      hasServiceAccountPath: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH,
      useMockAuth: process.env.USE_MOCK_AUTH === 'true',
    });
    return null;
  }
  return app.auth();
}

export function getMessaging(): admin.messaging.Messaging | null {
  const app = getFirebaseApp();
  if (!app) {
    logger.warn('Firebase not initialized - messaging operations will fail');
    return null;
  }
  return app.messaging();
}

export default { initializeFirebase, getFirebaseApp, getAuth, getMessaging };
