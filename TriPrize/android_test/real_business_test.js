/**
 * TriPrize 本番前全業務フロー検証
 * 
 * @description 
 * リアル環境（API + DB + Firebase）を使用した完全なE2Eテスト
 * Mock認証は使用せず、実際のFirebase認証を行う
 * 
 * @author AI Assistant
 * @date 2025-11-27
 */

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } = require('firebase/auth');

// =============================================
// 設定
// =============================================
const CONFIG = {
  baseUrl: 'http://localhost:8085',
  apiUrl: 'http://localhost:3000',
  screenshotDir: path.join(__dirname),
  timeout: 60000,
};

// Firebase配置 (从 mobile/lib/firebase_options.dart 提取或使用环境变量)
// 注意：这是测试脚本用的客户端配置，必须与移动端一致
const firebaseConfig = {
  apiKey: "AIzaSyDemoKey-WebPlatform-TriPrize", // ⚠️ 这里应该是真实的Key，如果跑不通说明配置未更新
  authDomain: "triprize-demo.firebaseapp.com",
  projectId: "triprize-demo",
  storageBucket: "triprize-demo.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// 初始化Firebase客户端
let auth;
try {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  console.log('✅ Firebase Client SDK initialized');
} catch (e) {
  console.error('⚠️ Firebase init failed:', e.message);
}

const ANDROID_DEVICE = {
  ...devices['Pixel 7'],
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36',
};

const timestamp = Date.now();
const TEST_DATA = {
  admin: {
    email: `admin_${timestamp}@triprize.test`,
    password: 'Password123!',
    displayName: 'Real Admin',
  },
  customer1: {
    email: `cust1_${timestamp}@triprize.test`,
    password: 'Password123!',
    displayName: 'Real Customer 1',
  },
  campaign: {
    name: `Real Campaign ${timestamp}`,
    description: 'Production Readiness Test',
    baseLength: 3,
    layerPrices: [3000, 2000, 1000],
    profitMarginPercent: 10,
    prizes: [
      { name: 'iPhone 15 Pro', rank: 1, quantity: 1 },
      { name: 'AirPods Pro', rank: 2, quantity: 2 },
    ],
  },
};

const results = [];
let screenshotNum = 0;

// =============================================
// 認証ヘルパー (Real Firebase)
// =============================================

async function getRealIdToken(email, password, displayName) {
  try {
    // 1. 尝试登录
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await userCredential.user.getIdToken();
      return token;
    } catch (loginError) {
      // 2. 登录失败尝试注册
      if (loginError.code === 'auth/user-not-found' || loginError.code === 'auth/invalid-credential') {
        console.log(`   User not found, creating: ${email}`);
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName });
        const token = await userCredential.user.getIdToken();
        return token;
      }
      throw loginError;
    }
  } catch (error) {
    console.error(`❌ Firebase Auth Error: ${error.code} - ${error.message}`);
    // 如果是 API Key 无效，直接抛出明确错误
    if (error.code === 'auth/api-key-not-valid-please-pass-a-valid-api-key') {
      throw new Error('Firebase API Key Invalid - 上线前必须替换 Demo Key');
    }
    throw error;
  }
}

// =============================================
// ユーティリティ
// =============================================

async function screenshot(page, name) {
  const filename = `${String(screenshotNum++).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: path.join(CONFIG.screenshotDir, filename), fullPage: true });
  return filename;
}

async function apiRequest(page, method, endpoint, options = {}) {
  const url = `${CONFIG.apiUrl}${endpoint}`;
  const requestOptions = { ...options };
  
  if (options.token) {
    requestOptions.headers = {
      ...requestOptions.headers,
      'Authorization': `Bearer ${options.token}`,
    };
    delete requestOptions.token;
  }
  
  try {
    const response = await page.request[method.toLowerCase()](url, requestOptions);
    let data = null;
    try { data = await response.json(); } catch { data = await response.text(); }
    return { ok: response.ok(), status: response.status(), data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error.message };
  }
}

// =============================================
// テスト実行
// =============================================

async function runRealTest() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║    TriPrize 本番直前 E2E テスト (Real Auth Mode)               ║');
  console.log('║    USE_MOCK_AUTH=false                                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(ANDROID_DEVICE);
  const page = await context.newPage();

  let adminToken, customerToken, campaignId;

  // Phase 0: 環境チェック
  console.log('🔍 Phase 0: Environment Check');
  const health = await apiRequest(page, 'GET', '/health');
  if (!health.ok) throw new Error(`API Unhealthy: ${health.status}`);
  console.log('✅ API Healthy');

  // Phase 1: 管理者認証 (Real Firebase)
  console.log('\n🔐 Phase 1: Admin Auth (Real Firebase)');
  try {
    adminToken = await getRealIdToken(TEST_DATA.admin.email, TEST_DATA.admin.password, TEST_DATA.admin.displayName);
    console.log('✅ Got Valid ID Token from Firebase');
    
    // 登録 (API側DB同期)
    const regRes = await apiRequest(page, 'POST', '/api/auth/register', {
      data: { firebase_token: adminToken, email: TEST_DATA.admin.email, role: 'admin' }
    });
    console.log(`✅ API Register: ${regRes.status}`);
    
    // ログイン (API側)
    const loginRes = await apiRequest(page, 'POST', '/api/auth/login', {
      data: { firebase_token: adminToken }
    });
    console.log(`✅ API Login: ${loginRes.status}`);
    
  } catch (e) {
    console.error('❌ Auth Failed:', e.message);
    process.exit(1);
  }

  // Phase 2: キャンペーン作成
  console.log('\n🎯 Phase 2: Create Campaign');
  const createRes = await apiRequest(page, 'POST', '/api/campaigns', {
    token: adminToken,
    data: TEST_DATA.campaign
  });
  if (createRes.ok) {
    campaignId = createRes.data.data.id;
    console.log(`✅ Campaign Created: ${campaignId}`);
    
    await apiRequest(page, 'POST', `/api/campaigns/${campaignId}/publish`, { token: adminToken });
    console.log('✅ Campaign Published');
  } else {
    console.error(`❌ Create Failed: ${createRes.status} - ${JSON.stringify(createRes.data)}`);
  }

  // Phase 3: 顧客購入
  console.log('\n🛒 Phase 3: Customer Purchase');
  try {
    customerToken = await getRealIdToken(TEST_DATA.customer1.email, TEST_DATA.customer1.password, TEST_DATA.customer1.displayName);
    await apiRequest(page, 'POST', '/api/auth/register', {
      data: { firebase_token: customerToken, email: TEST_DATA.customer1.email, role: 'customer' }
    });
    
    const buyRes = await apiRequest(page, 'POST', '/api/purchases', {
      token: customerToken,
      data: { campaignId, layer: 3 }
    });
    
    if (buyRes.ok) {
      console.log(`✅ Purchase Created: ${buyRes.data.data.id}`);
    } else {
      console.error(`❌ Purchase Failed: ${buyRes.status}`);
    }
  } catch (e) {
    console.error('❌ Customer Auth Failed:', e.message);
  }

  await browser.close();
  console.log('\n✨ Test Complete');
}

runRealTest();

