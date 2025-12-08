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

    // Validate and format private key
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('FIREBASE_PRIVATE_KEY is not set');
    }

    // Replace escaped newlines with actual newlines
    privateKey = privateKey.replace(/\\n/g, '\n');

    // Validate private key format
    if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
      logger.error('Invalid private key format - must contain BEGIN/END PRIVATE KEY markers');
      throw new Error('Invalid private key format');
    }

    // Check server time synchronization (JWT signature errors often caused by clock skew)
    const serverTime = new Date();
    const serverTimeISO = serverTime.toISOString();
    const timeDiff = Math.abs(serverTime.getTime() - Date.now());
    if (timeDiff > 60000) { // More than 1 minute difference
      logger.warn('Server time may be out of sync', { 
        timeDiff,
        serverTime: serverTimeISO,
        warning: 'JWT signature errors may occur if server time is not properly synced'
      });
    } else {
      logger.info('Server time synchronized', { serverTime: serverTimeISO });
    }

    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: privateKey,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };

    // Verify service account structure
    if (!serviceAccount.projectId || !serviceAccount.privateKey || !serviceAccount.clientEmail) {
      throw new Error('Incomplete Firebase service account configuration');
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });

    logger.info('✓ Firebase Admin SDK initialized successfully', {
      projectId: serviceAccount.projectId,
      clientEmail: serviceAccount.clientEmail,
      privateKeyLength: privateKey.length,
    });
    return firebaseApp;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = error && typeof error === 'object' && 'code' in error 
      ? (error as { code: string }).code 
      : undefined;
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error('Firebase initialization failed', {
      error: errorMessage,
      errorCode,
      stack: errorStack,
      hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
      hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
      hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
      privateKeyLength: process.env.FIREBASE_PRIVATE_KEY?.length || 0,
      privateKeyPreview: process.env.FIREBASE_PRIVATE_KEY?.substring(0, 50) || 'N/A',
    });

    // In production, fail fast if Firebase is required
    if (process.env.NODE_ENV === 'production' && process.env.USE_MOCK_AUTH !== 'true') {
      logger.error('Firebase is required in production mode - exiting');
      throw new Error(`Firebase initialization failed: ${errorMessage}. Please check your Firebase credentials and server time synchronization.`);
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
