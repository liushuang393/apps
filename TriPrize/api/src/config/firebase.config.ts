import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import logger from '../utils/logger.util';

dotenv.config();

let firebaseApp: admin.app.App | null = null;

export function initializeFirebase(): admin.app.App | null {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Check if Firebase credentials are configured
    if (!process.env.FIREBASE_PROJECT_ID ||
        !process.env.FIREBASE_PRIVATE_KEY ||
        !process.env.FIREBASE_CLIENT_EMAIL) {
      logger.warn('Firebase credentials not configured - running in test mode without Firebase');
      return null;
    }

    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });

    logger.info('✓ Firebase Admin SDK initialized');
    return firebaseApp;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = error && typeof error === 'object' && 'code' in error 
      ? (error as { code: string }).code 
      : undefined;
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error('Firebase initialization failed - running in test mode', {
      error: errorMessage,
      errorCode,
      stack: errorStack,
      hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
      hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
      hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
      privateKeyLength: process.env.FIREBASE_PRIVATE_KEY?.length || 0,
    });
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
      hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
      hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
      hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
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
