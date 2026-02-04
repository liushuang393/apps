/**
 * E2Eテスト用開発者セットアップスクリプト
 * 
 * このスクリプトは公開APIを通じてテスト開発者を作成し、
 * 生成されたAPIキーを自動的に.envファイルに設定します。
 * 
 * 前提条件:
 * - バックエンドサーバー起動中 (http://localhost:3000)
 * - PostgreSQLとRedis起動中
 * 
 * 使用方法: node scripts/setup-test-developer.js
 */

const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'e2e-test@forgepay.io';
const ENV_FILE_PATH = path.join(__dirname, '..', '.env');

/**
 * .envファイルのTEST_API_KEYを更新する
 * @param {string} apiKey - 新しいAPIキー
 */
function updateEnvFile(apiKey) {
  try {
    let envContent = '';
    
    if (fs.existsSync(ENV_FILE_PATH)) {
      envContent = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    }
    
    // TEST_API_KEY行を探して更新、なければ追加
    const testApiKeyRegex = /^TEST_API_KEY=.*$/m;
    const newLine = `TEST_API_KEY=${apiKey}`;
    
    if (testApiKeyRegex.test(envContent)) {
      // 既存の行を更新
      envContent = envContent.replace(testApiKeyRegex, newLine);
      console.log('📝 .envファイルのTEST_API_KEYを更新しました');
    } else {
      // 新しい行を追加
      envContent = envContent.trimEnd() + '\n' + newLine + '\n';
      console.log('📝 .envファイルにTEST_API_KEYを追加しました');
    }
    
    fs.writeFileSync(ENV_FILE_PATH, envContent);
    return true;
  } catch (error) {
    console.error('⚠️  .envファイルの更新に失敗:', error.message);
    return false;
  }
}

async function setupTestDeveloper() {
  console.log('🚀 Setting up test developer via API...\n');

  try {
    // Step 1: Register a new developer via the public API
    console.log('📝 Registering test developer...');
    
    const registerResponse = await fetch(`${API_BASE_URL}/api/v1/onboarding/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: TEST_EMAIL,
        testMode: true,
      }),
    });

    if (registerResponse.status === 409) {
      console.log('⚠️  Developer already exists. Attempting to retrieve or regenerate...');
      
      // Try to delete and re-register (for clean state)
      console.log('   This is expected if you ran this script before.');
      console.log('   Use the existing API key from your .env file, or:');
      console.log('   1. Manually delete the developer from the database');
      console.log('   2. Run this script again\n');
      
      console.log('📋 To delete existing test developer:');
      console.log(`   docker exec forgepaybridge-postgres psql -U postgres -d forgepaybridge -c "DELETE FROM developers WHERE email = '${TEST_EMAIL}';"`);
      console.log('');
      
      return null;
    }

    if (!registerResponse.ok) {
      const error = await registerResponse.json();
      throw new Error(`Registration failed: ${JSON.stringify(error)}`);
    }

    const registerData = await registerResponse.json();
    console.log('✅ Developer registered successfully!\n');

    // Step 2: APIキーを表示
    const apiKey = registerData.apiKey.key;
    
    console.log('='.repeat(60));
    console.log('🔑 TEST API KEY');
    console.log('='.repeat(60));
    console.log(`\n   ${apiKey}\n`);
    console.log('='.repeat(60));

    // Step 3: .envファイルを自動更新
    console.log('\n📝 .envファイルを自動更新中...');
    const envUpdated = updateEnvFile(apiKey);
    
    if (envUpdated) {
      console.log('✅ TEST_API_KEYが.envファイルに設定されました\n');
    } else {
      console.log('\n⚠️  手動で.envファイルに追加してください:');
      console.log(`   TEST_API_KEY=${apiKey}\n`);
    }

    console.log('📋 E2Eテストを実行:');
    console.log('   npm run test:e2e\n');

    // Step 4: Verify the API key works by making a test request
    console.log('🔍 Verifying API key...');
    
    const verifyResponse = await fetch(`${API_BASE_URL}/api/v1/onboarding/me`, {
      headers: {
        'X-API-Key': apiKey,
      },
    });

    if (verifyResponse.ok) {
      const meData = await verifyResponse.json();
      // Handle nested developer object
      const dev = meData.developer || meData;
      console.log('✅ API key verified successfully!');
      console.log(`   Developer ID: ${dev.id}`);
      console.log(`   Email: ${dev.email}`);
      console.log(`   Test Mode: ${dev.testMode ?? dev.test_mode}`);
    } else {
      console.log('❌ API key verification failed!');
      const errorData = await verifyResponse.json().catch(() => ({}));
      console.log(`   Error: ${errorData.error?.message || verifyResponse.status}`);
    }

    return apiKey;

  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Error: Cannot connect to the server.');
      console.error('   Make sure the backend is running: npm run dev');
      console.error(`   Server URL: ${API_BASE_URL}`);
    } else {
      console.error('❌ Error:', error.message);
    }
    process.exit(1);
  }
}

// Run the setup
setupTestDeveloper().then(apiKey => {
  if (apiKey) {
    console.log('\n✨ Setup complete!\n');
  }
});
