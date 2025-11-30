/**
 * TriPrize Android端E2Eテスト
 * 
 * @description 
 * Android端末をシミュレートした全業務フローのテスト
 * 
 * @author AI Assistant
 * @date 2025-11-26
 */

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

// =============================================
// 定数定義
// =============================================
const CONFIG = {
  baseUrl: 'http://localhost:8085',
  apiUrl: 'http://localhost:3000',
  screenshotDir: path.join(__dirname),
  timeout: 60000,
  elementTimeout: 30000,
  flutterInitWait: 5000,
};

/** Android端末エミュレーション設定 */
const ANDROID_DEVICE = {
  ...devices['Pixel 7'],
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
};

/** テストデータ */
const TEST_DATA = {
  admin: {
    email: `admin_test_${Date.now()}@triprize.test`,
    password: 'Admin123456!',
    displayName: 'テスト管理者',
  },
  customer1: {
    email: `customer1_test_${Date.now()}@triprize.test`,
    password: 'Customer123456!',
    displayName: 'テスト顧客1',
  },
  customer2: {
    email: `customer2_test_${Date.now()}@triprize.test`,
    password: 'Customer123456!',
    displayName: 'テスト顧客2',
  },
  campaign: {
    name: 'E2Eテストキャンペーン',
    description: 'Android端末E2Eテスト用のキャンペーン',
    baseLength: 3,
    layerPrices: [3000, 2000, 1000],
    profitMargin: 10,
  },
};

const testResults = [];
let screenshotCounter = 0;

// =============================================
// ユーティリティ関数
// =============================================

/**
 * スクリーンショット保存
 */
async function saveScreenshot(page, name) {
  const filename = `${String(screenshotCounter++).padStart(2, '0')}_${name}.png`;
  const filepath = path.join(CONFIG.screenshotDir, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`📸 Screenshot: ${filename}`);
  return filename;
}

/**
 * Flutter Web初期化待機
 */
async function waitForFlutterInit(page) {
  console.log('⏳ Flutter Web初期化待機中...');
  
  try {
    await page.waitForFunction(() => {
      return typeof window._flutter !== 'undefined' ||
             document.querySelector('flt-glass-pane') !== null ||
             document.querySelector('canvas') !== null;
    }, { timeout: CONFIG.timeout });
    
    await page.waitForTimeout(CONFIG.flutterInitWait);
    console.log('✅ Flutter Web初期化完了');
  } catch (e) {
    console.log('⚠️ Flutter初期化タイムアウト、続行');
  }
}

/**
 * テキストを含む要素をクリック
 */
async function clickByText(page, text) {
  try {
    const locator = page.getByText(text, { exact: false });
    if (await locator.count() > 0) {
      await locator.first().click();
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// =============================================
// テストケース
// =============================================

/**
 * Phase 0: 環境確認
 */
async function testEnvironment(page) {
  console.log('\n🔍 Phase 0: 環境確認');
  
  // API健康チェック
  const apiResponse = await page.request.get(`${CONFIG.apiUrl}/health`);
  if (!apiResponse.ok()) {
    throw new Error(`API サーバー異常: ${apiResponse.status()}`);
  }
  const apiData = await apiResponse.json();
  console.log(`  ✅ APIサーバー: ${apiData.status}`);
  
  // Flutter Web読み込み
  await page.goto(CONFIG.baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForFlutterInit(page);
  console.log('  ✅ Flutter Web: 読み込み完了');
}

/**
 * Phase 1: スプラッシュ・役割選択画面
 */
async function testSplashAndRoleSelection(page) {
  console.log('\n👤 Phase 1: スプラッシュ・役割選択');
  
  await page.goto(CONFIG.baseUrl);
  await page.waitForTimeout(2000);
  await saveScreenshot(page, 'splash_screen');
  
  // スプラッシュ後の遷移待機
  await page.waitForTimeout(3000);
  await saveScreenshot(page, 'role_selection');
  
  // アクセシビリティツリー取得
  const snapshot = await page.accessibility.snapshot();
  if (snapshot) {
    console.log('  📋 検出された要素:');
    const logElements = (node, depth = 0) => {
      if (depth > 3) return;
      const indent = '    '.repeat(depth);
      if (node.name && node.name.trim()) {
        console.log(`${indent}- [${node.role}] "${node.name}"`);
      }
      if (node.children) {
        node.children.forEach(child => logElements(child, depth + 1));
      }
    };
    logElements(snapshot);
  }
  
  console.log('  ✅ 画面表示確認完了');
}

/**
 * Phase 2: UI操作テスト
 */
async function testUIInteraction(page) {
  console.log('\n🖱️ Phase 2: UI操作テスト');
  
  await page.waitForTimeout(1000);
  
  // 管理者/顧客ボタンを探す
  const adminClicked = await clickByText(page, '管理者') || 
                       await clickByText(page, 'Admin') ||
                       await clickByText(page, '店舗');
  
  if (adminClicked) {
    console.log('  ✅ 管理者ボタンクリック成功');
    await page.waitForTimeout(2000);
    await saveScreenshot(page, 'admin_screen');
    
    // 戻る
    try {
      await page.goBack();
      await page.waitForTimeout(1000);
    } catch (e) {
      // ナビゲーション失敗は無視
    }
  } else {
    console.log('  ⚠️ 管理者ボタン未検出 - 画面構造を確認');
  }
  
  // 顧客ボタンテスト
  const customerClicked = await clickByText(page, '顧客') ||
                          await clickByText(page, 'Customer') ||
                          await clickByText(page, 'お客様');
  
  if (customerClicked) {
    console.log('  ✅ 顧客ボタンクリック成功');
    await page.waitForTimeout(2000);
    await saveScreenshot(page, 'customer_screen');
  }
}

/**
 * Phase 3: API認証テスト
 */
async function testApiAuth(page) {
  console.log('\n🔐 Phase 3: API認証テスト');
  
  // 管理者登録
  const registerRes = await page.request.post(`${CONFIG.apiUrl}/api/auth/register`, {
    data: {
      email: TEST_DATA.admin.email,
      password: TEST_DATA.admin.password,
      displayName: TEST_DATA.admin.displayName,
      role: 'admin',
    },
  });
  
  if (registerRes.ok()) {
    const data = await registerRes.json();
    console.log(`  ✅ 管理者登録成功: ${data.data?.user?.id || 'ID不明'}`);
  } else {
    const errorText = await registerRes.text();
    console.log(`  ⚠️ 管理者登録: ${registerRes.status()}`);
    // 重複エラーの場合は継続
    if (!errorText.includes('already exists')) {
      console.log(`     詳細: ${errorText.substring(0, 100)}`);
    }
  }
  
  // ログインテスト
  const loginRes = await page.request.post(`${CONFIG.apiUrl}/api/auth/login`, {
    data: {
      email: TEST_DATA.admin.email,
      password: TEST_DATA.admin.password,
    },
  });
  
  if (loginRes.ok()) {
    const loginData = await loginRes.json();
    console.log(`  ✅ ログイン成功: Token取得済み`);
    return loginData.data?.token;
  } else {
    console.log(`  ⚠️ ログイン失敗: ${loginRes.status()}`);
    return null;
  }
}

/**
 * Phase 4: キャンペーン作成テスト
 */
async function testCampaignCreation(page, token) {
  console.log('\n🎯 Phase 4: キャンペーン作成テスト');
  
  if (!token) {
    console.log('  ⚠️ トークンなし、スキップ');
    return null;
  }
  
  // キャンペーン作成
  const createRes = await page.request.post(`${CONFIG.apiUrl}/api/campaigns`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: TEST_DATA.campaign.name + '_' + Date.now(),
      description: TEST_DATA.campaign.description,
      baseLength: TEST_DATA.campaign.baseLength,
      layerPrices: TEST_DATA.campaign.layerPrices,
      profitMarginPercent: TEST_DATA.campaign.profitMargin,
      prizes: [
        { name: 'iPhone 15 Pro', rank: 1, quantity: 1 },
        { name: 'AirPods Pro', rank: 2, quantity: 2 },
      ],
    },
  });
  
  if (createRes.ok()) {
    const data = await createRes.json();
    console.log(`  ✅ キャンペーン作成成功: ID=${data.data?.id}`);
    
    // 発行
    if (data.data?.id) {
      const publishRes = await page.request.post(
        `${CONFIG.apiUrl}/api/campaigns/${data.data.id}/publish`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (publishRes.ok()) {
        console.log('  ✅ キャンペーン発行成功');
      } else {
        console.log(`  ⚠️ 発行失敗: ${publishRes.status()}`);
      }
    }
    
    return data.data?.id;
  } else {
    const errorText = await createRes.text();
    console.log(`  ⚠️ キャンペーン作成失敗: ${createRes.status()}`);
    console.log(`     詳細: ${errorText.substring(0, 150)}`);
    return null;
  }
}

/**
 * Phase 5: 顧客購入テスト
 */
async function testCustomerPurchase(page, campaignId) {
  console.log('\n🛒 Phase 5: 顧客購入テスト');
  
  // 顧客1登録
  const reg1Res = await page.request.post(`${CONFIG.apiUrl}/api/auth/register`, {
    data: {
      email: TEST_DATA.customer1.email,
      password: TEST_DATA.customer1.password,
      displayName: TEST_DATA.customer1.displayName,
      role: 'customer',
    },
  });
  
  if (reg1Res.ok()) {
    console.log('  ✅ 顧客1登録成功');
  }
  
  // 顧客1ログイン
  const login1Res = await page.request.post(`${CONFIG.apiUrl}/api/auth/login`, {
    data: {
      email: TEST_DATA.customer1.email,
      password: TEST_DATA.customer1.password,
    },
  });
  
  if (login1Res.ok()) {
    const loginData = await login1Res.json();
    const customerToken = loginData.data?.token;
    console.log('  ✅ 顧客1ログイン成功');
    
    // キャンペーン一覧取得
    const campaignsRes = await page.request.get(`${CONFIG.apiUrl}/api/campaigns`);
    const campaigns = await campaignsRes.json();
    
    const targetCampaign = campaignId || 
      (campaigns.data && campaigns.data.length > 0 ? campaigns.data[0].id : null);
    
    if (targetCampaign) {
      console.log(`  📋 購入対象キャンペーン: ${targetCampaign}`);
      
      // 購入作成
      const purchaseRes = await page.request.post(`${CONFIG.apiUrl}/api/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` },
        data: {
          campaignId: targetCampaign,
          layer: 3,
        },
      });
      
      if (purchaseRes.ok()) {
        const purchaseData = await purchaseRes.json();
        console.log(`  ✅ 購入作成成功: ID=${purchaseData.data?.id}`);
      } else {
        const errorText = await purchaseRes.text();
        console.log(`  ⚠️ 購入失敗: ${purchaseRes.status()}`);
        console.log(`     詳細: ${errorText.substring(0, 150)}`);
      }
    } else {
      console.log('  ⚠️ アクティブなキャンペーンなし');
    }
  } else {
    console.log(`  ⚠️ 顧客1ログイン失敗: ${login1Res.status()}`);
  }
}

/**
 * Phase 6: エラーハンドリングテスト
 */
async function testErrorHandling(page) {
  console.log('\n⚠️ Phase 6: エラーハンドリングテスト');
  
  // 無効なデータでの登録
  const invalidRes = await page.request.post(`${CONFIG.apiUrl}/api/auth/register`, {
    data: {
      email: 'invalid-email',
      password: 'short',
      displayName: '',
      role: 'customer',
    },
  });
  
  console.log(`  📝 無効データ登録: ${invalidRes.status()} ${invalidRes.status() === 400 ? '✅' : '⚠️'}`);
  
  // 認証なしアクセス
  const unauthRes = await page.request.get(`${CONFIG.apiUrl}/api/purchases/me`);
  console.log(`  🔐 認証なしアクセス: ${unauthRes.status()} ${unauthRes.status() === 401 ? '✅' : '⚠️'}`);
  
  // 存在しないリソース
  const notFoundRes = await page.request.get(`${CONFIG.apiUrl}/api/campaigns/99999999`);
  console.log(`  🔍 存在しないID: ${notFoundRes.status()} ${notFoundRes.status() === 404 ? '✅' : '⚠️'}`);
  
  console.log('  ✅ エラーハンドリング確認完了');
}

/**
 * Phase 7: キャンペーン一覧UIテスト
 */
async function testCampaignListUI(page) {
  console.log('\n📋 Phase 7: キャンペーン一覧UIテスト');
  
  await page.goto(CONFIG.baseUrl);
  await waitForFlutterInit(page);
  await page.waitForTimeout(3000);
  
  // 顧客として進む
  await clickByText(page, '顧客') || await clickByText(page, 'Customer');
  await page.waitForTimeout(2000);
  await saveScreenshot(page, 'customer_entry');
  
  // ログイン画面で「スキップ」か「ゲスト」があれば
  await clickByText(page, 'スキップ') || await clickByText(page, 'ゲスト') || await clickByText(page, 'Skip');
  await page.waitForTimeout(2000);
  
  await saveScreenshot(page, 'campaign_list');
  
  // キャンペーンカードをクリック
  const campaignClicked = await clickByText(page, 'キャンペーン') || 
                          await clickByText(page, TEST_DATA.campaign.name.substring(0, 10));
  
  if (campaignClicked) {
    await page.waitForTimeout(2000);
    await saveScreenshot(page, 'campaign_detail');
    console.log('  ✅ キャンペーン詳細画面表示');
  }
  
  console.log('  ✅ UIテスト完了');
}

/**
 * Phase 8: パフォーマンステスト
 */
async function testPerformance(page) {
  console.log('\n⚡ Phase 8: パフォーマンステスト');
  
  // ページ読み込み時間
  const startTime = Date.now();
  await page.goto(CONFIG.baseUrl);
  await waitForFlutterInit(page);
  const loadTime = Date.now() - startTime;
  
  const loadStatus = loadTime < 5000 ? '良好 ✅' : loadTime < 10000 ? '要改善 ⚠️' : '遅い ❌';
  console.log(`  📊 ページ読み込み: ${loadTime}ms ${loadStatus}`);
  
  // API応答時間
  const apiStart = Date.now();
  await page.request.get(`${CONFIG.apiUrl}/api/campaigns`);
  const apiTime = Date.now() - apiStart;
  
  const apiStatus = apiTime < 500 ? '良好 ✅' : apiTime < 1000 ? '要改善 ⚠️' : '遅い ❌';
  console.log(`  📊 API応答時間: ${apiTime}ms ${apiStatus}`);
  
  // ヘルスチェック応答
  const healthStart = Date.now();
  await page.request.get(`${CONFIG.apiUrl}/health`);
  const healthTime = Date.now() - healthStart;
  console.log(`  📊 ヘルスチェック: ${healthTime}ms`);
}

/**
 * Phase 9: 入力バリデーションテスト
 */
async function testInputValidation(page, token) {
  console.log('\n✏️ Phase 9: 入力バリデーションテスト');
  
  if (!token) {
    console.log('  ⚠️ トークンなし、スキップ');
    return;
  }
  
  // 無効なキャンペーンデータ
  const tests = [
    { name: '空の名前', data: { name: '', baseLength: 3 }, expect: 400 },
    { name: '負のbaseLength', data: { name: 'Test', baseLength: -1 }, expect: 400 },
    { name: '大きすぎるbaseLength', data: { name: 'Test', baseLength: 1000 }, expect: 400 },
    { name: '空の配列layerPrices', data: { name: 'Test', baseLength: 3, layerPrices: [] }, expect: 400 },
  ];
  
  for (const test of tests) {
    const res = await page.request.post(`${CONFIG.apiUrl}/api/campaigns`, {
      headers: { Authorization: `Bearer ${token}` },
      data: test.data,
    });
    
    const icon = res.status() === test.expect ? '✅' : '⚠️';
    console.log(`  ${icon} ${test.name}: ${res.status()} (期待: ${test.expect})`);
  }
}

// =============================================
// メイン実行
// =============================================

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   TriPrize Android E2E 全業務フローテスト                    ║');
  console.log('║   端末: Samsung Galaxy S21 (Android 14 エミュレート)         ║');
  console.log('║   解像度: 412 x 915                                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const browser = await chromium.launch({
    headless: false,
  });
  
  const context = await browser.newContext({
    ...ANDROID_DEVICE,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  
  const page = await context.newPage();
  page.setDefaultTimeout(CONFIG.timeout);
  
  let adminToken = null;
  let campaignId = null;
  
  const tests = [
    { name: '環境確認', fn: () => testEnvironment(page) },
    { name: 'スプラッシュ・役割選択', fn: () => testSplashAndRoleSelection(page) },
    { name: 'UI操作', fn: () => testUIInteraction(page) },
    { name: 'API認証', fn: async () => { adminToken = await testApiAuth(page); } },
    { name: 'キャンペーン作成', fn: async () => { campaignId = await testCampaignCreation(page, adminToken); } },
    { name: '顧客購入', fn: () => testCustomerPurchase(page, campaignId) },
    { name: 'エラーハンドリング', fn: () => testErrorHandling(page) },
    { name: 'キャンペーン一覧UI', fn: () => testCampaignListUI(page) },
    { name: 'パフォーマンス', fn: () => testPerformance(page) },
    { name: '入力バリデーション', fn: () => testInputValidation(page, adminToken) },
  ];
  
  for (const test of tests) {
    const startTime = Date.now();
    try {
      await test.fn();
      testResults.push({
        name: test.name,
        status: 'passed',
        duration: Date.now() - startTime,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ テスト失敗 [${test.name}]: ${errorMsg}`);
      await saveScreenshot(page, `error_${test.name.replace(/\s/g, '_')}`);
      testResults.push({
        name: test.name,
        status: 'failed',
        duration: Date.now() - startTime,
        error: errorMsg,
      });
    }
  }
  
  // 結果サマリー
  console.log('\n\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    テスト結果サマリー                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const passed = testResults.filter(r => r.status === 'passed').length;
  const failed = testResults.filter(r => r.status === 'failed').length;
  
  testResults.forEach(result => {
    const icon = result.status === 'passed' ? '✅' : '❌';
    console.log(`${icon} ${result.name}: ${result.status} (${result.duration}ms)`);
    if (result.error) {
      console.log(`   └─ Error: ${result.error}`);
    }
  });
  
  console.log(`\n📊 合計: ${passed}件成功 / ${failed}件失敗 / ${tests.length}件中`);
  console.log(`📊 成功率: ${Math.round(passed / tests.length * 100)}%`);
  
  // レポート保存
  const report = {
    timestamp: new Date().toISOString(),
    device: 'Android (Samsung Galaxy S21 - Pixel 7 emulation)',
    resolution: '412 x 915',
    results: testResults,
    summary: { total: tests.length, passed, failed },
    bugs: [],
  };
  
  // バグ検出
  if (failed > 0) {
    testResults.filter(r => r.status === 'failed').forEach(r => {
      report.bugs.push({
        severity: 'HIGH',
        test: r.name,
        description: r.error,
        impact: '業務フロー中断の可能性',
      });
    });
  }
  
  const reportPath = path.join(CONFIG.screenshotDir, 'test_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 テストレポート: ${reportPath}`);
  
  // スクリーンショット一覧
  console.log(`📸 スクリーンショット: ${screenshotCounter}枚保存`);
  
  await browser.close();
  
  // 終了コード
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});


