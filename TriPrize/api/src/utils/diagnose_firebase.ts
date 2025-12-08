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

// Check server time synchronization
const serverTime = new Date();
const serverTimeISO = serverTime.toISOString();
console.log(`🕐 Server time: ${serverTimeISO}`);

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
  
  // Test authentication by getting auth instance
  const auth = admin.auth();
  console.log('✅ Firebase Auth instance created successfully!');
  
} catch (error: unknown) {
  console.error('❌ Firebase Initialization Failed:');
  if (error instanceof Error) {
    console.error(`Error message: ${error.message}`);
    
    // Check for JWT signature errors
    if (error.message.includes('invalid_grant') || 
        error.message.includes('Invalid JWT Signature') ||
        error.message.includes('JWT Signature')) {
      console.error('\n⚠️  JWT Signature Error Detected!');
      console.error('\n考えられる原因:');
      console.error('(1) サーバーの時刻同期が正しくない');
      console.error('(2) Firebaseサービスアカウントキーが無効になっている');
      console.error('\n解決方法:');
      console.error('(1) サーバーの時刻同期を確認してください:');
      console.error('   Windows: w32tm /query /status');
      console.error('   Linux/Mac: timedatectl status');
      console.error('(2) Firebase ConsoleでキーIDを確認:');
      console.error('   https://console.firebase.google.com/iam-admin/serviceaccounts/project');
      console.error('(3) 新しいキーを生成:');
      console.error('   https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk');
    }
    
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  } else {
    console.error(String(error));
  }
  console.log('\n💡 Suggestion: Check if FIREBASE_PRIVATE_KEY is correct and contains proper newlines.');
  process.exit(1);
}
