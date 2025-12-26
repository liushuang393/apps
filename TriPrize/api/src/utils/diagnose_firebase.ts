/**
 * Firebase Configuration Diagnostic Tool
 *
 * 新設計: FIREBASE_SERVICE_ACCOUNT_KEY_PATH からJSONファイルを読み込んで診断
 * 実際にAPIを呼び出して権限も検証する
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { FirebaseServiceAccountConfig } from '../config/firebase-service-account.config';

/**
 * メイン診断関数
 */
async function diagnoseFirebase(): Promise<void> {
  // Load .env
  const envPath = path.join(__dirname, '../../.env');
  dotenv.config({ path: envPath });

  console.log('🔍 Diagnosing Firebase Configuration...');
  console.log(`📂 Loading .env from: ${envPath}`);

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;

  console.log(`📄 Service Account Key Path: ${serviceAccountPath || 'NOT SET'}`);

  if (!serviceAccountPath) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT_KEY_PATH is not set in environment variables.');
    console.error('💡 Please set the path to your Firebase service account JSON file in .env');
    process.exit(1);
  }

  // Check server time synchronization
  const serverTime = new Date();
  const serverTimeISO = serverTime.toISOString();
  console.log(`🕐 Server time: ${serverTimeISO}`);

  // サービスアカウント設定を読み込み
  console.log('🔄 Loading Firebase service account configuration...');
  const serviceAccountConfig = FirebaseServiceAccountConfig.getInstance();
  const serviceAccount = serviceAccountConfig.getServiceAccount();

  console.log('✅ Service Account loaded successfully:');
  console.log(`   Project ID: ${serviceAccount.project_id}`);
  console.log(`   Client Email: ${serviceAccount.client_email}`);
  console.log(`   Config File: ${serviceAccountConfig.getLoadedConfigPath()}`);

  // Firebase Admin SDK を初期化
  console.log('🔄 Attempting to initialize Firebase Admin SDK...');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    projectId: serviceAccount.project_id,
  });

  console.log('✅ Firebase Admin SDK initialized successfully!');

  // Test authentication by getting auth instance
  const auth = admin.auth();
  console.log('✅ Firebase Auth instance created successfully!');

  // 実際にAPIを呼び出して権限を検証
  console.log('🔄 Testing actual API call (listUsers) to verify permissions...');
  const listResult = await auth.listUsers(1);
  console.log(`✅ API call successful! Found ${listResult.users.length} user(s).`);
  console.log('');
  console.log('🎉 All configurations and permissions are correctly set up!');
}

/**
 * エラーハンドリング付きでメイン関数を実行
 */
diagnoseFirebase().catch((error: unknown) => {
  console.error('');
  console.error('❌ Firebase Diagnostic Failed:');

  if (error instanceof Error) {
    console.error(`Error message: ${error.message}`);

    // 権限エラーの検出
    if (error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('serviceusage.services.use') ||
        error.message.includes('USER_PROJECT_DENIED')) {
      console.error('\n⚠️  Permission Denied Error Detected!');
      console.error('\n必要な対応:');
      console.error('GCP Console → IAM で以下のService Accountに権限を追加してください:');
      console.error('  firebase-adminsdk-fbsvc@product-triprizeweb-dev.iam.gserviceaccount.com');
      console.error('\n必須ロール:');
      console.error('  ✅ Service Usage Consumer (roles/serviceusage.serviceUsageConsumer)');
      console.error('  ✅ Firebase Admin SDK Administrator Service Agent');
      console.error('\nGCP Console URL:');
      console.error('  https://console.cloud.google.com/iam-admin/iam?project=product-triprizeweb-dev');
      console.error('\n権限追加後、1-5分待ってから再実行してください。');
    }

    // JWT署名エラーの検出
    if (error.message.includes('invalid_grant') ||
        error.message.includes('Invalid JWT Signature') ||
        error.message.includes('JWT Signature')) {
      console.error('\n⚠️  JWT Signature Error Detected!');
      console.error('\n考えられる原因:');
      console.error('(1) サーバーの時刻同期が正しくない');
      console.error('(2) Firebaseサービスアカウントキーが無効になっている');
      console.error('\n解決方法:');
      console.error('(1) サーバーの時刻同期を確認:');
      console.error('   Windows: w32tm /query /status');
      console.error('   Linux/Mac: timedatectl status');
      console.error('(2) Firebase Consoleで新しいキーを生成:');
      console.error('   https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk');
    }

    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  } else {
    console.error(String(error));
  }

  console.log('\n💡 Suggestion: Check the error message above and follow the suggested fix.');
  process.exit(1);
});
