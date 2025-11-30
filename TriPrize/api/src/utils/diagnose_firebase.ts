import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

console.log('🔍 Diagnosing Firebase Configuration...');
console.log(`📂 Loading .env from: ${envPath}`);

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

console.log(`ID: ${projectId || 'MISSING'}`);
console.log(`Email: ${clientEmail || 'MISSING'}`);
console.log(`Key: ${privateKey ? 'PRESENT (Length: ' + privateKey.length + ')' : 'MISSING'}`);

if (!projectId || !clientEmail || !privateKey) {
  console.error('❌ Missing required environment variables.');
  process.exit(1);
}

try {
  console.log('🔄 Attempting to initialize Firebase Admin SDK...');
  
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  });
  
  console.log('✅ Firebase Admin SDK initialized successfully!');
  console.log('ℹ️  Configuration is VALID.');
} catch (error: unknown) {
  console.error('❌ Firebase Initialization Failed:');
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  console.log('\n💡 Suggestion: Check if FIREBASE_PRIVATE_KEY is correct and contains proper newlines.');
  process.exit(1);
}
