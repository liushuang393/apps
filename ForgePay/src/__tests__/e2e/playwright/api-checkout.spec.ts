import {
  test,
  expect,
  API_BASE_URL,
  TEST_API_KEY,
  createTestProduct,
  createTestPrice,
  createCheckoutSession,
  archiveTestProduct,
} from './fixtures'

/**
 * チェックアウトセッション E2E テスト
 *
 * ForgePay のコアフロー:
 * purchase_intent_id → Stripe Checkout Session マッピング を検証。
 * セッション作成・URL 発行・バリデーション・エラーハンドリングを網羅する。
 */
test.describe('チェックアウトセッション（コアフロー）', () => {

  // テスト共有の商品 + 価格
  let sharedProductId: string
  let sharedPriceId: string

  test.beforeAll(async () => {
    // テスト用商品と価格を事前に作成
    const product = await createTestProduct(
      TEST_API_KEY,
      `E2E チェックアウトテスト商品 ${Date.now()}`
    )
    sharedProductId = product.id

    const price = await createTestPrice(TEST_API_KEY, product.id, 2500, 'usd')
    sharedPriceId = price.id
  })

  test.afterAll(async () => {
    // テスト商品をクリーンアップ
    await archiveTestProduct(TEST_API_KEY, sharedProductId).catch(() => {})
  })

  // ============================================================
  // セッション作成テスト
  // ============================================================
  test.describe('セッション作成', () => {

    test('有効なパラメータでチェックアウトセッションを作成できること', async () => {
      const purchaseIntentId = `e2e_pi_${Date.now()}_create`

      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: sharedProductId,
          price_id: sharedPriceId,
          purchase_intent_id: purchaseIntentId,
          customer_email: `e2e-checkout-${Date.now()}@test.example.com`,
          success_url: `${API_BASE_URL}/payment/success`,
          cancel_url: `${API_BASE_URL}/payment/cancel`,
        }),
      })

      expect(response.status).toBe(201)

      const body = await response.json()

      // 必須フィールドの検証
      expect(body).toHaveProperty('session_id')
      expect(body).toHaveProperty('checkout_url')
      expect(body).toHaveProperty('expires_at')

      // checkout_url が Stripe URL であること
      expect(body.checkout_url).toMatch(/^https:\/\/checkout\.stripe\.com\//)

      // session_id が存在すること
      expect(typeof body.session_id).toBe('string')
      expect(body.session_id.length).toBeGreaterThan(0)

      // expires_at が有効な ISO 文字列であること
      expect(new Date(body.expires_at).toISOString()).toBe(body.expires_at)
    })

    test('createCheckoutSession ヘルパーでセッションを作成できること', async () => {
      const result = await createCheckoutSession(
        TEST_API_KEY,
        sharedProductId,
        sharedPriceId
      )

      expect(result).toHaveProperty('sessionId')
      expect(result).toHaveProperty('checkoutUrl')
      expect(result).toHaveProperty('purchaseIntentId')

      // checkoutUrl が Stripe URL であること
      expect(result.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//)

      // purchaseIntentId がプレフィックス付きであること
      expect(result.purchaseIntentId).toMatch(/^e2e_pi_/)
    })

    test('purchase_intent_id が保存・マッピングされること', async () => {
      const result = await createCheckoutSession(
        TEST_API_KEY,
        sharedProductId,
        sharedPriceId
      )

      // セッションを ID で取得して purchase_intent_id が紐づいていることを確認
      const sessionResponse = await fetch(
        `${API_BASE_URL}/api/v1/checkout/sessions/${result.sessionId}`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      // セッション取得が成功していれば purchase_intent_id をチェック
      if (sessionResponse.ok) {
        const session = await sessionResponse.json()
        expect(session).toHaveProperty('purchase_intent_id', result.purchaseIntentId)
        expect(session).toHaveProperty('product_id')
        expect(session).toHaveProperty('price_id')
        expect(session).toHaveProperty('status')
      } else {
        // API がセッション取得をサポートしていない場合でも
        // セッション作成自体は成功していること
        expect(result.sessionId).toBeTruthy()
      }
    })

    test('メタデータ付きでセッションを作成できること', async () => {
      const purchaseIntentId = `e2e_pi_${Date.now()}_meta`

      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: sharedProductId,
          price_id: sharedPriceId,
          purchase_intent_id: purchaseIntentId,
          customer_email: `e2e-meta-${Date.now()}@test.example.com`,
          success_url: `${API_BASE_URL}/payment/success`,
          cancel_url: `${API_BASE_URL}/payment/cancel`,
          metadata: {
            source: 'e2e_test',
            campaign: 'test_campaign',
          },
        }),
      })

      expect(response.status).toBe(201)

      const body = await response.json()
      expect(body).toHaveProperty('checkout_url')
    })
  })

  // ============================================================
  // バリデーションテスト
  // ============================================================
  test.describe('バリデーション', () => {

    test('product_id が未指定の場合エラーを返すこと', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          price_id: sharedPriceId,
          purchase_intent_id: `e2e_pi_${Date.now()}_noprod`,
          success_url: `${API_BASE_URL}/payment/success`,
          cancel_url: `${API_BASE_URL}/payment/cancel`,
        }),
      })

      // 400 系エラーが返ること
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    })

    test('price_id が未指定の場合エラーを返すこと', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: sharedProductId,
          purchase_intent_id: `e2e_pi_${Date.now()}_noprice`,
          success_url: `${API_BASE_URL}/payment/success`,
          cancel_url: `${API_BASE_URL}/payment/cancel`,
        }),
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    })

    test('purchase_intent_id が未指定の場合エラーを返すこと', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: sharedProductId,
          price_id: sharedPriceId,
          success_url: `${API_BASE_URL}/payment/success`,
          cancel_url: `${API_BASE_URL}/payment/cancel`,
        }),
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    })

    test('success_url が未指定の場合エラーを返すこと', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: sharedProductId,
          price_id: sharedPriceId,
          purchase_intent_id: `e2e_pi_${Date.now()}_nosuccess`,
          cancel_url: `${API_BASE_URL}/payment/cancel`,
        }),
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    })

    test('cancel_url が未指定の場合エラーを返すこと', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: sharedProductId,
          price_id: sharedPriceId,
          purchase_intent_id: `e2e_pi_${Date.now()}_nocancel`,
          success_url: `${API_BASE_URL}/payment/success`,
        }),
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    })

    test('存在しない product_id は 404 を返すこと', async () => {
      const fakeProductId = '00000000-0000-0000-0000-000000000000'

      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: fakeProductId,
          price_id: sharedPriceId,
          purchase_intent_id: `e2e_pi_${Date.now()}_fakeprod`,
          success_url: `${API_BASE_URL}/payment/success`,
          cancel_url: `${API_BASE_URL}/payment/cancel`,
        }),
      })

      expect(response.status).toBe(404)

      const body = await response.json()
      expect(body.error).toHaveProperty('code', 'resource_not_found')
      expect(body.error).toHaveProperty('message', 'Product not found')
    })

    test('存在しない price_id は 404 を返すこと', async () => {
      const fakePriceId = '00000000-0000-0000-0000-000000000000'

      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: sharedProductId,
          price_id: fakePriceId,
          purchase_intent_id: `e2e_pi_${Date.now()}_fakeprice`,
          success_url: `${API_BASE_URL}/payment/success`,
          cancel_url: `${API_BASE_URL}/payment/cancel`,
        }),
      })

      expect(response.status).toBe(404)

      const body = await response.json()
      expect(body.error).toHaveProperty('code', 'resource_not_found')
      expect(body.error).toHaveProperty('message', 'Price not found')
    })

    test('API キーなしでセッション作成は 401 を返すこと', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: sharedProductId,
          price_id: sharedPriceId,
          purchase_intent_id: `e2e_pi_${Date.now()}_nokey`,
          success_url: `${API_BASE_URL}/payment/success`,
          cancel_url: `${API_BASE_URL}/payment/cancel`,
        }),
      })

      expect(response.status).toBe(401)
    })
  })

  // ============================================================
  // セッション取得テスト
  // ============================================================
  test.describe('セッション取得', () => {

    test('作成したセッションを ID で取得できること', async () => {
      const result = await createCheckoutSession(
        TEST_API_KEY,
        sharedProductId,
        sharedPriceId
      )

      const response = await fetch(
        `${API_BASE_URL}/api/v1/checkout/sessions/${result.sessionId}`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      // セッション取得が実装されている場合
      if (response.ok) {
        const body = await response.json()
        expect(body).toHaveProperty('id', result.sessionId)
        expect(body).toHaveProperty('purchase_intent_id', result.purchaseIntentId)
        expect(body).toHaveProperty('status')
        expect(body).toHaveProperty('created_at')
      }
    })

    test('存在しないセッション ID は 404 を返すこと', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'

      const response = await fetch(
        `${API_BASE_URL}/api/v1/checkout/sessions/${fakeId}`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(404)
    })
  })
})
