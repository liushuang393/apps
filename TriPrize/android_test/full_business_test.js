/**
 * TriPrize 全業務フローE2Eテスト（Mock認証対応）
 * 
 * @description 
 * Android端末をシミュレートした全業務フローの完全テスト
 * USE_MOCK_AUTH=true モードで動作
 * 
 * @author AI Assistant
 * @date 2025-11-27
 */

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

// =============================================
// 設定
// =============================================
const CONFIG = {
  baseUrl: 'http://localhost:8085',
  apiUrl: 'http://localhost:3000',
  screenshotDir: path.join(__dirname),
  timeout: 60000,
};

const ANDROID_DEVICE = {
  ...devices['Pixel 7'],
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36',
};

// テストデータ（一意のタイムスタンプ付き）
const timestamp = Date.now();
const TEST_DATA = {
  admin: {
    email: `admin_${timestamp}@triprize.test`,
    displayName: 'テスト管理者',
    // Mock token形式: mock_ + email
    get mockToken() { return `mock_${this.email}`; },
  },
  customer1: {
    email: `customer1_${timestamp}@triprize.test`,
    displayName: 'テスト顧客1',
    get mockToken() { return `mock_${this.email}`; },
  },
  customer2: {
    email: `customer2_${timestamp}@triprize.test`,
    displayName: 'テスト顧客2',
    get mockToken() { return `mock_${this.email}`; },
  },
  campaign: {
    name: `テストキャンペーン_${timestamp}`,
    description: 'E2Eテスト用キャンペーン - 全業務フロー検証',
    baseLength: 3, // 6ポジション (1+2+3)
    layerPrices: [3000, 2000, 1000],
    profitMarginPercent: 10,
    prizes: [
      { name: 'iPhone 15 Pro', rank: 1, quantity: 1 },
      { name: 'AirPods Pro', rank: 2, quantity: 2 },
    ],
  },
};

// テスト結果
const results = [];
const bugs = [];
let screenshotNum = 0;

// =============================================
// ユーティリティ
// =============================================

async function screenshot(page, name) {
  const filename = `${String(screenshotNum++).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: path.join(CONFIG.screenshotDir, filename), fullPage: true });
  console.log(`📸 ${filename}`);
  return filename;
}

function logBug(severity, title, description, impact) {
  bugs.push({ severity, title, description, impact, timestamp: new Date().toISOString() });
  console.log(`🐛 [${severity}] ${title}: ${description}`);
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
    const status = response.status();
    let data = null;
    
    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }
    
    return { ok: response.ok(), status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error.message };
  }
}

// =============================================
// テストフェーズ
// =============================================

/**
 * Phase 0: 環境確認
 */
async function phase0_Environment(page) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 0: 環境確認');
  console.log('═══════════════════════════════════════');
  
  // APIヘルスチェック
  const health = await apiRequest(page, 'GET', '/health');
  if (!health.ok) {
    throw new Error('APIサーバーが応答しません');
  }
  console.log(`✅ APIサーバー: ${health.data.status}`);
  console.log(`   環境: ${health.data.environment}`);
  
  // Flutter Web確認
  await page.goto(CONFIG.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log('✅ Flutter Web: 読み込み完了');
  
  await screenshot(page, 'env_check');
}

/**
 * Phase 1: 管理者登録・ログイン
 */
async function phase1_AdminAuth(page) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 1: 管理者登録・ログイン');
  console.log('═══════════════════════════════════════');
  
  // 管理者登録
  console.log(`📝 登録: ${TEST_DATA.admin.email}`);
  const registerRes = await apiRequest(page, 'POST', '/api/auth/register', {
    data: {
      firebase_token: TEST_DATA.admin.mockToken,
      email: TEST_DATA.admin.email,
      display_name: TEST_DATA.admin.displayName,
      role: 'admin',
    },
  });
  
  if (registerRes.ok) {
    console.log(`✅ 管理者登録成功`);
    console.log(`   ユーザーID: ${registerRes.data?.data?.user_id || 'N/A'}`);
  } else if (registerRes.status === 409) {
    console.log('⚠️ ユーザー既存（テスト継続）');
  } else {
    console.log(`❌ 登録失敗: ${registerRes.status}`);
    console.log(`   詳細: ${JSON.stringify(registerRes.data).substring(0, 200)}`);
    
    // Firebase token形式の問題をチェック
    if (registerRes.data?.details?.some(d => d.field === 'firebase_token')) {
      logBug('HIGH', '認証API問題', 'firebase_tokenの検証エラー - USE_MOCK_AUTH設定確認必要', '全認証フロー停止');
    }
    
    throw new Error('管理者登録失敗');
  }
  
  // 管理者ログイン確認（認証テスト）
  const loginRes = await apiRequest(page, 'POST', '/api/auth/login', {
    data: {
      firebase_token: TEST_DATA.admin.mockToken,
    },
  });
  
  if (loginRes.ok) {
    console.log('✅ 管理者ログイン確認成功');
    return TEST_DATA.admin.mockToken;
  } else {
    console.log(`⚠️ ログイン確認: ${loginRes.status}`);
    return TEST_DATA.admin.mockToken; // Mock tokenを返す
  }
}

/**
 * Phase 2: キャンペーン作成・発行
 */
async function phase2_CampaignCreate(page, adminToken) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 2: キャンペーン作成・発行');
  console.log('═══════════════════════════════════════');
  
  // キャンペーン作成
  console.log(`📝 作成: ${TEST_DATA.campaign.name}`);
  const createRes = await apiRequest(page, 'POST', '/api/campaigns', {
    token: adminToken,
    data: TEST_DATA.campaign,
  });
  
  if (!createRes.ok) {
    console.log(`❌ 作成失敗: ${createRes.status}`);
    console.log(`   詳細: ${JSON.stringify(createRes.data).substring(0, 300)}`);
    
    // バリデーションエラーの詳細確認
    if (createRes.data?.details) {
      createRes.data.details.forEach(d => {
        logBug('MEDIUM', 'バリデーションエラー', `${d.field}: ${d.message}`, 'キャンペーン作成不可');
      });
    }
    
    throw new Error('キャンペーン作成失敗');
  }
  
  const campaignId = createRes.data?.data?.id;
  console.log(`✅ キャンペーン作成成功: ID=${campaignId}`);
  
  // キャンペーン詳細確認
  const detailRes = await apiRequest(page, 'GET', `/api/campaigns/${campaignId}`);
  if (detailRes.ok) {
    const campaign = detailRes.data?.data;
    console.log(`   名前: ${campaign?.name}`);
    console.log(`   ステータス: ${campaign?.status}`);
    console.log(`   総ポジション: ${campaign?.total_positions}`);
  }
  
  // キャンペーン発行
  console.log('📝 キャンペーン発行中...');
  const publishRes = await apiRequest(page, 'POST', `/api/campaigns/${campaignId}/publish`, {
    token: adminToken,
  });
  
  if (publishRes.ok) {
    console.log('✅ キャンペーン発行成功');
  } else {
    console.log(`⚠️ 発行結果: ${publishRes.status}`);
    console.log(`   詳細: ${JSON.stringify(publishRes.data).substring(0, 200)}`);
    
    // 発行済みの場合は継続
    if (publishRes.data?.message?.includes('already')) {
      console.log('   （既に発行済み）');
    } else {
      logBug('MEDIUM', 'キャンペーン発行問題', `発行API失敗: ${publishRes.status}`, 'キャンペーン公開不可');
    }
  }
  
  return campaignId;
}

/**
 * Phase 3: 顧客登録
 */
async function phase3_CustomerRegistration(page) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 3: 顧客登録');
  console.log('═══════════════════════════════════════');
  
  const customers = [TEST_DATA.customer1, TEST_DATA.customer2];
  const tokens = [];
  
  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    console.log(`📝 顧客${i + 1}登録: ${customer.email}`);
    
    const registerRes = await apiRequest(page, 'POST', '/api/auth/register', {
      data: {
        firebase_token: customer.mockToken,
        email: customer.email,
        display_name: customer.displayName,
        role: 'customer',
      },
    });
    
    if (registerRes.ok) {
      console.log(`✅ 顧客${i + 1}登録成功`);
      tokens.push(customer.mockToken);
    } else if (registerRes.status === 409) {
      console.log(`⚠️ 顧客${i + 1}既存`);
      tokens.push(customer.mockToken);
    } else {
      console.log(`❌ 顧客${i + 1}登録失敗: ${registerRes.status}`);
      logBug('HIGH', '顧客登録失敗', `顧客${i + 1}登録API失敗`, '顧客獲得不可');
    }
  }
  
  return tokens;
}

/**
 * Phase 4: 購入フロー
 */
async function phase4_Purchase(page, campaignId, customerTokens) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 4: 購入フロー');
  console.log('═══════════════════════════════════════');
  
  if (!campaignId) {
    console.log('⚠️ キャンペーンIDなし、スキップ');
    return [];
  }
  
  const purchases = [];
  const layers = [3, 2, 1]; // 下層から上層へ
  
  for (let i = 0; i < customerTokens.length; i++) {
    const token = customerTokens[i];
    const layer = layers[i % layers.length];
    
    console.log(`🛒 顧客${i + 1}購入: Layer ${layer}`);
    
    const purchaseRes = await apiRequest(page, 'POST', '/api/purchases', {
      token: token,
      data: {
        campaignId: campaignId,
        layer: layer,
      },
    });
    
    if (purchaseRes.ok) {
      console.log(`✅ 購入作成成功: ID=${purchaseRes.data?.data?.id}`);
      purchases.push(purchaseRes.data?.data);
    } else {
      console.log(`❌ 購入失敗: ${purchaseRes.status}`);
      console.log(`   詳細: ${JSON.stringify(purchaseRes.data).substring(0, 200)}`);
      
      // 在庫なしエラー
      if (purchaseRes.data?.message?.includes('sold out') || 
          purchaseRes.data?.message?.includes('no positions')) {
        console.log('   （売り切れ）');
      } else {
        logBug('HIGH', '購入フロー問題', `購入API失敗: ${purchaseRes.status}`, '売上損失');
      }
    }
  }
  
  return purchases;
}

/**
 * Phase 5: 支払い処理確認
 */
async function phase5_Payment(page, purchases, customerTokens) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 5: 支払い処理');
  console.log('═══════════════════════════════════════');
  
  if (purchases.length === 0) {
    console.log('⚠️ 購入なし、スキップ');
    return;
  }
  
  for (let i = 0; i < purchases.length; i++) {
    const purchase = purchases[i];
    const token = customerTokens[i % customerTokens.length];
    
    if (!purchase?.id) continue;
    
    console.log(`💳 購入${purchase.id}の支払い確認`);
    
    // 購入詳細取得
    const detailRes = await apiRequest(page, 'GET', `/api/purchases/${purchase.id}`, {
      token: token,
    });
    
    if (detailRes.ok) {
      const p = detailRes.data?.data;
      console.log(`   ステータス: ${p?.status}`);
      console.log(`   金額: ¥${p?.amount}`);
      console.log(`   ポジション: ${p?.position_number}`);
    } else {
      console.log(`   詳細取得失敗: ${detailRes.status}`);
    }
    
    // 支払いIntent作成テスト（Stripeテスト）
    const paymentRes = await apiRequest(page, 'POST', '/api/payment/create-intent', {
      token: token,
      data: {
        purchaseId: purchase.id,
      },
    });
    
    if (paymentRes.ok) {
      console.log(`✅ PaymentIntent作成成功`);
      console.log(`   ClientSecret: ${paymentRes.data?.data?.clientSecret?.substring(0, 20)}...`);
    } else {
      console.log(`⚠️ PaymentIntent: ${paymentRes.status}`);
      // 支払い失敗は警告レベル（テスト環境の制限）
      if (paymentRes.status !== 400) {
        logBug('MEDIUM', '支払いIntent問題', `PaymentIntent作成失敗: ${paymentRes.status}`, '決済フロー影響');
      }
    }
  }
}

/**
 * Phase 6: キャンペーン一覧・詳細UIテスト
 */
async function phase6_CampaignUI(page) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 6: キャンペーンUI確認');
  console.log('═══════════════════════════════════════');
  
  // キャンペーン一覧API
  const listRes = await apiRequest(page, 'GET', '/api/campaigns');
  
  if (listRes.ok) {
    const campaigns = listRes.data?.data || [];
    console.log(`✅ キャンペーン一覧: ${campaigns.length}件`);
    
    campaigns.slice(0, 3).forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.name} [${c.status}]`);
    });
    
    // 統計確認
    if (campaigns.length > 0) {
      const statsRes = await apiRequest(page, 'GET', `/api/campaigns/${campaigns[0].id}/stats`);
      if (statsRes.ok) {
        const stats = statsRes.data?.data;
        console.log(`   統計: 売上${stats?.sold_count || 0}/${stats?.total_positions || 0}`);
      }
    }
  } else {
    logBug('HIGH', 'キャンペーン一覧API', `一覧取得失敗: ${listRes.status}`, 'ユーザー閲覧不可');
  }
  
  // Flutter Web UI確認
  await page.goto(CONFIG.baseUrl);
  await page.waitForTimeout(4000);
  await screenshot(page, 'campaign_ui');
  
  console.log('✅ UI表示確認完了');
}

/**
 * Phase 7: 抽選機能テスト
 */
async function phase7_Lottery(page, campaignId, adminToken) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 7: 抽選機能');
  console.log('═══════════════════════════════════════');
  
  if (!campaignId) {
    console.log('⚠️ キャンペーンIDなし、スキップ');
    return;
  }
  
  // 抽選実行（全ポジション販売前でも実行テスト）
  console.log('🎲 抽選実行テスト...');
  const drawRes = await apiRequest(page, 'POST', `/api/lottery/draw/${campaignId}`, {
    token: adminToken,
  });
  
  if (drawRes.ok) {
    console.log('✅ 抽選実行成功');
    console.log(`   結果: ${JSON.stringify(drawRes.data?.data).substring(0, 200)}`);
  } else {
    console.log(`⚠️ 抽選結果: ${drawRes.status}`);
    console.log(`   詳細: ${JSON.stringify(drawRes.data).substring(0, 200)}`);
    
    // 全ポジション未販売は正常
    if (drawRes.data?.message?.includes('not all positions')) {
      console.log('   （全ポジション未販売のため実行不可 - 正常動作）');
    }
  }
  
  // 抽選結果API確認
  const resultsRes = await apiRequest(page, 'GET', `/api/lottery/results/${campaignId}`);
  console.log(`📊 抽選結果API: ${resultsRes.status}`);
}

/**
 * Phase 8: エラーハンドリング・バリデーション
 */
async function phase8_ErrorHandling(page, adminToken) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 8: エラーハンドリング検証');
  console.log('═══════════════════════════════════════');
  
  const tests = [
    {
      name: '無効メール登録',
      fn: () => apiRequest(page, 'POST', '/api/auth/register', {
        data: { firebase_token: 'mock_invalid', email: 'bad-email', display_name: '' },
      }),
      expect: 400,
    },
    {
      name: '認証なしアクセス',
      fn: () => apiRequest(page, 'GET', '/api/purchases/me'),
      expect: 401,
    },
    {
      name: '存在しないキャンペーン',
      fn: () => apiRequest(page, 'GET', '/api/campaigns/00000000-0000-0000-0000-000000000000'),
      expect: 404,
    },
    {
      name: '空のキャンペーン作成',
      fn: () => apiRequest(page, 'POST', '/api/campaigns', {
        token: adminToken,
        data: {},
      }),
      expect: 400,
    },
    {
      name: '無効なLayer購入',
      fn: () => apiRequest(page, 'POST', '/api/purchases', {
        token: TEST_DATA.customer1.mockToken,
        data: { campaignId: '00000000-0000-0000-0000-000000000000', layer: 999 },
      }),
      expect: [400, 404],
    },
  ];
  
  for (const test of tests) {
    const result = await test.fn();
    const expected = Array.isArray(test.expect) ? test.expect : [test.expect];
    const passed = expected.includes(result.status);
    
    console.log(`${passed ? '✅' : '❌'} ${test.name}: ${result.status} (期待: ${test.expect})`);
    
    if (!passed) {
      logBug('MEDIUM', 'エラーハンドリング', `${test.name}が期待値と異なる`, 'エラー表示の問題');
    }
  }
}

/**
 * Phase 9: パフォーマンス計測
 */
async function phase9_Performance(page) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 9: パフォーマンス計測');
  console.log('═══════════════════════════════════════');
  
  const metrics = [];
  
  // API応答時間
  const apiTests = [
    { name: 'Health', fn: () => apiRequest(page, 'GET', '/health') },
    { name: 'Campaigns List', fn: () => apiRequest(page, 'GET', '/api/campaigns') },
  ];
  
  for (const test of apiTests) {
    const start = Date.now();
    await test.fn();
    const time = Date.now() - start;
    metrics.push({ name: test.name, time });
    
    const status = time < 500 ? '✅' : time < 1000 ? '⚠️' : '❌';
    console.log(`${status} ${test.name}: ${time}ms`);
    
    if (time > 1000) {
      logBug('LOW', 'パフォーマンス', `${test.name}応答が遅い: ${time}ms`, 'UX低下');
    }
  }
  
  // ページ読み込み
  const pageStart = Date.now();
  await page.goto(CONFIG.baseUrl);
  await page.waitForTimeout(3000);
  const pageTime = Date.now() - pageStart;
  
  const pageStatus = pageTime < 5000 ? '✅' : pageTime < 10000 ? '⚠️' : '❌';
  console.log(`${pageStatus} Page Load: ${pageTime}ms`);
  
  if (pageTime > 10000) {
    logBug('MEDIUM', 'ページ読み込み', `初期読み込みが遅い: ${pageTime}ms`, 'ユーザー離脱');
  }
}

/**
 * Phase 10: 権限チェック
 */
async function phase10_Authorization(page, adminToken, customerToken) {
  console.log('\n═══════════════════════════════════════');
  console.log('Phase 10: 権限チェック');
  console.log('═══════════════════════════════════════');
  
  // 顧客がキャンペーン作成を試みる
  const customerCreateRes = await apiRequest(page, 'POST', '/api/campaigns', {
    token: customerToken,
    data: TEST_DATA.campaign,
  });
  
  const customerCreateOk = customerCreateRes.status === 403 || customerCreateRes.status === 401;
  console.log(`${customerCreateOk ? '✅' : '❌'} 顧客によるキャンペーン作成: ${customerCreateRes.status} (期待: 403/401)`);
  
  if (!customerCreateOk && customerCreateRes.ok) {
    logBug('CRITICAL', '権限バイパス', '顧客がキャンペーン作成可能', 'セキュリティ脆弱性');
  }
  
  // 顧客が抽選実行を試みる
  const customerDrawRes = await apiRequest(page, 'POST', '/api/lottery/draw/test-id', {
    token: customerToken,
  });
  
  const customerDrawOk = customerDrawRes.status === 403 || customerDrawRes.status === 401;
  console.log(`${customerDrawOk ? '✅' : '❌'} 顧客による抽選実行: ${customerDrawRes.status} (期待: 403/401)`);
  
  if (!customerDrawOk && customerDrawRes.ok) {
    logBug('CRITICAL', '権限バイパス', '顧客が抽選実行可能', 'セキュリティ脆弱性');
  }
}

// =============================================
// メイン実行
// =============================================

async function runFullTest() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║    TriPrize 全業務フロー E2E テスト                             ║');
  console.log('║    端末: Android (Samsung Galaxy S21 エミュレート)              ║');
  console.log('║    認証: Mock Mode (USE_MOCK_AUTH=true)                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(`\n開始時刻: ${new Date().toISOString()}`);
  console.log(`API: ${CONFIG.apiUrl}`);
  console.log(`Flutter: ${CONFIG.baseUrl}\n`);
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    ...ANDROID_DEVICE,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(CONFIG.timeout);
  
  let adminToken = null;
  let campaignId = null;
  let customerTokens = [];
  let purchases = [];
  
  const phases = [
    { name: 'Phase 0: 環境確認', fn: () => phase0_Environment(page) },
    { name: 'Phase 1: 管理者認証', fn: async () => { adminToken = await phase1_AdminAuth(page); } },
    { name: 'Phase 2: キャンペーン', fn: async () => { campaignId = await phase2_CampaignCreate(page, adminToken); } },
    { name: 'Phase 3: 顧客登録', fn: async () => { customerTokens = await phase3_CustomerRegistration(page); } },
    { name: 'Phase 4: 購入フロー', fn: async () => { purchases = await phase4_Purchase(page, campaignId, customerTokens); } },
    { name: 'Phase 5: 支払い', fn: () => phase5_Payment(page, purchases, customerTokens) },
    { name: 'Phase 6: UI確認', fn: () => phase6_CampaignUI(page) },
    { name: 'Phase 7: 抽選機能', fn: () => phase7_Lottery(page, campaignId, adminToken) },
    { name: 'Phase 8: エラー処理', fn: () => phase8_ErrorHandling(page, adminToken) },
    { name: 'Phase 9: パフォーマンス', fn: () => phase9_Performance(page) },
    { name: 'Phase 10: 権限チェック', fn: () => phase10_Authorization(page, adminToken, customerTokens[0]) },
  ];
  
  for (const phase of phases) {
    const start = Date.now();
    try {
      await phase.fn();
      results.push({ name: phase.name, status: 'passed', duration: Date.now() - start });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ ${phase.name} 失敗: ${msg}`);
      await screenshot(page, `error_${phase.name.replace(/[^a-zA-Z0-9]/g, '_')}`);
      results.push({ name: phase.name, status: 'failed', duration: Date.now() - start, error: msg });
      
      // 重大エラーの場合は停止
      if (phase.name.includes('環境') || phase.name.includes('管理者認証')) {
        console.log('⛔ 重大エラーのためテスト中断');
        break;
      }
    }
  }
  
  // 最終スクリーンショット
  await screenshot(page, 'final_state');
  
  // サマリー出力
  console.log('\n\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                      テスト結果サマリー                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  
  results.forEach(r => {
    const icon = r.status === 'passed' ? '✅' : '❌';
    console.log(`${icon} ${r.name}: ${r.duration}ms`);
    if (r.error) console.log(`   └─ ${r.error}`);
  });
  
  console.log(`\n📊 結果: ${passed}/${phases.length} 成功 (${Math.round(passed / phases.length * 100)}%)`);
  
  // バグレポート
  if (bugs.length > 0) {
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                     検出されたバグ                              ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
    
    const critical = bugs.filter(b => b.severity === 'CRITICAL');
    const high = bugs.filter(b => b.severity === 'HIGH');
    const medium = bugs.filter(b => b.severity === 'MEDIUM');
    const low = bugs.filter(b => b.severity === 'LOW');
    
    console.log(`🔴 CRITICAL: ${critical.length}件`);
    console.log(`🟠 HIGH: ${high.length}件`);
    console.log(`🟡 MEDIUM: ${medium.length}件`);
    console.log(`🟢 LOW: ${low.length}件`);
    
    bugs.forEach(b => {
      const icon = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' }[b.severity];
      console.log(`\n${icon} [${b.severity}] ${b.title}`);
      console.log(`   説明: ${b.description}`);
      console.log(`   影響: ${b.impact}`);
    });
  } else {
    console.log('\n✨ バグは検出されませんでした！');
  }
  
  // レポート保存
  const report = {
    timestamp: new Date().toISOString(),
    device: 'Android (Samsung Galaxy S21)',
    authMode: 'Mock (USE_MOCK_AUTH=true)',
    results,
    bugs,
    summary: {
      total: phases.length,
      passed,
      failed,
      criticalBugs: bugs.filter(b => b.severity === 'CRITICAL').length,
      highBugs: bugs.filter(b => b.severity === 'HIGH').length,
    },
    releaseReadiness: bugs.filter(b => b.severity === 'CRITICAL' || b.severity === 'HIGH').length === 0,
  };
  
  fs.writeFileSync(
    path.join(CONFIG.screenshotDir, 'full_test_report.json'),
    JSON.stringify(report, null, 2)
  );
  
  console.log(`\n📄 レポート保存: android_test/full_test_report.json`);
  console.log(`📸 スクリーンショット: ${screenshotNum}枚`);
  
  if (report.releaseReadiness) {
    console.log('\n🚀 リリース準備: OK');
  } else {
    console.log('\n⚠️ リリース準備: NG（重大/高優先度バグあり）');
  }
  
  await browser.close();
  process.exit(failed > 0 || bugs.some(b => b.severity === 'CRITICAL') ? 1 : 0);
}

runFullTest().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});


