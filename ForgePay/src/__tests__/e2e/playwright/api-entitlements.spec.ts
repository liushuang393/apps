import {
  test,
  expect,
  API_BASE_URL,
  TEST_API_KEY,
  createTestProduct,
  createTestPrice,
  createCheckoutSession,
  verifyEntitlement,
  archiveTestProduct,
} from './fixtures'

/**
 * Entitlement 検証 E2E テスト
 *
 * 決済前後の Entitlement ステータスを検証。
 * purchase_intent_id による照会・アクセス可否判定・
 * エラーハンドリングを網羅する。
 *
 * 注意: 実際の決済完了（Stripe Webhook 経由）なしでは
 * has_access = false が期待される。Webhook テストは別ファイルで実施。
 */
test.describe('Entitlement 検証', () => {

  // テスト共有リソース
  let sharedProductId: string
  let sharedPriceId: string

  test.beforeAll(async () => {
    // テスト用商品と価格を事前に作成
    const product = await createTestProduct(
      TEST_API_KEY,
      `E2E Entitlement テスト商品 ${Date.now()}`
    )
    sharedProductId = product.id

    const price = await createTestPrice(TEST_API_KEY, product.id, 1500, 'usd')
    sharedPriceId = price.id
  })

  test.afterAll(async () => {
    await archiveTestProduct(TEST_API_KEY, sharedProductId).catch(() => {})
  })

  // ============================================================
  // 決済前の Entitlement 検証
  // ============================================================
  test.describe('決済前の検証（アクセスなし）', () => {

    test('チェックアウト作成後・決済前は Entitlement が見つからないこと', async () => {
      // チェックアウトセッションを作成（決済は完了しない）
      const session = await createCheckoutSession(
        TEST_API_KEY,
        sharedProductId,
        sharedPriceId
      )

      // purchase_intent_id で Entitlement を検証
      const result = await verifyEntitlement(TEST_API_KEY, session.purchaseIntentId)

      // 決済未完了なので Entitlement は存在しない → 404
      expect(result.ok).toBe(false)
      expect(result.status).toBe(404)
    })

    test('verifyEntitlement ヘルパーが正しい構造を返すこと', async () => {
      const session = await createCheckoutSession(
        TEST_API_KEY,
        sharedProductId,
        sharedPriceId
      )

      const result = await verifyEntitlement(TEST_API_KEY, session.purchaseIntentId)

      // ヘルパーの戻り値構造を検証
      expect(result).toHaveProperty('ok')
      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('data')
      expect(typeof result.ok).toBe('boolean')
      expect(typeof result.status).toBe('number')
    })
  })

  // ============================================================
  // 存在しない purchase_intent_id での検証
  // ============================================================
  test.describe('無効な purchase_intent_id', () => {

    test('存在しない purchase_intent_id は 404 を返すこと', async () => {
      const fakePurchaseIntentId = `nonexistent_pi_${Date.now()}`

      const response = await fetch(
        `${API_BASE_URL}/api/v1/entitlements/verify?purchase_intent_id=${fakePurchaseIntentId}`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(404)

      const body = await response.json()
      expect(body.error).toHaveProperty('code', 'resource_not_found')
      expect(body.error).toHaveProperty('type', 'invalid_request_error')
    })

    test('purchase_intent_id も unlock_token も未指定は 400 を返すこと', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/entitlements/verify`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error).toHaveProperty('code', 'invalid_request')
      expect(body.error.message).toContain('unlock_token')
      expect(body.error.message).toContain('purchase_intent_id')
    })

    test('空文字の purchase_intent_id は適切なエラーを返すこと', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/entitlements/verify?purchase_intent_id=`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      // 空文字は 400 または 404 のいずれか
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  // ============================================================
  // レスポンス構造の検証
  // ============================================================
  test.describe('レスポンス構造', () => {

    test('Entitlement 検証のエラーレスポンスに必須フィールドがあること', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/entitlements/verify?purchase_intent_id=nonexistent`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      const body = await response.json()

      // エラーレスポンスの構造を検証
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
      expect(body.error).toHaveProperty('type')
    })

    test('Entitlement 検証は API キーなしでもアクセスできること（optionalApiKeyAuth）', async () => {
      // /entitlements/verify は optionalApiKeyAuth を使用
      const response = await fetch(
        `${API_BASE_URL}/api/v1/entitlements/verify?purchase_intent_id=test_pi`,
      )

      // 認証エラー (401) ではなく、リソース不在 (404) が返ること
      // optionalApiKeyAuth なので認証は任意
      expect(response.status).not.toBe(401)
    })

    test('無効な unlock_token は 401 を返すこと', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/entitlements/verify?unlock_token=invalid_token_xyz`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(401)

      const body = await response.json()
      expect(body.error).toHaveProperty('code', 'invalid_token')
      expect(body.error).toHaveProperty('type', 'authentication_error')
    })
  })

  // ============================================================
  // Admin Entitlements エンドポイント
  // ============================================================
  test.describe('Admin Entitlements 一覧', () => {

    test('Entitlements 一覧を取得できること', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/entitlements`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)
    })

    test('ステータスフィルターで絞り込みできること', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/entitlements?status=active`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)

      // 返却された全 Entitlement が active であること
      for (const ent of body.data) {
        expect(ent.status).toBe('active')
      }
    })

    test('Entitlements 一覧は API キーなしで 401 を返すこと', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/entitlements`
      )

      expect(response.status).toBe(401)
    })
  })

  // ============================================================
  // Entitlement 個別取得
  // ============================================================
  test.describe('Entitlement 個別取得', () => {

    test('存在しない Entitlement ID は 404 を返すこと', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'

      const response = await fetch(
        `${API_BASE_URL}/api/v1/entitlements/${fakeId}`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(404)

      const body = await response.json()
      expect(body.error).toHaveProperty('code', 'resource_not_found')
    })
  })
})
