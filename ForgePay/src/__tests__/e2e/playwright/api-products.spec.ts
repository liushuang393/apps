import {
  test,
  expect,
  API_BASE_URL,
  TEST_API_KEY,
  createTestProduct,
  createTestPrice,
  archiveTestProduct,
  getProducts,
} from './fixtures'

/**
 * 商品 & 価格 CRUD E2E テスト
 *
 * Admin API を通じた商品・価格のライフサイクル全体を検証。
 * one_time / subscription 両タイプ、複数通貨（usd, jpy, eur）、
 * バリデーションエラーのハンドリングを網羅する。
 */
test.describe('商品 & 価格管理（Admin API）', () => {

  // テスト中に作成した商品 ID を保持（クリーンアップ用）
  const createdProductIds: string[] = []

  test.afterAll(async () => {
    // テストで作成した商品をすべてアーカイブ
    for (const id of createdProductIds) {
      await archiveTestProduct(TEST_API_KEY, id).catch(() => {})
    }
  })

  // ============================================================
  // 商品作成テスト
  // ============================================================
  test.describe('商品作成', () => {

    test('one_time タイプの商品を作成できること', async () => {
      const name = `E2E 単発商品 ${Date.now()}`

      const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          name,
          description: 'E2E テスト: 単発購入商品',
          type: 'one_time',
        }),
      })

      expect(response.status).toBe(201)

      const body = await response.json()
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('stripe_product_id')
      expect(body).toHaveProperty('name', name)
      expect(body).toHaveProperty('type', 'one_time')
      expect(body).toHaveProperty('active', true)
      expect(body).toHaveProperty('created_at')

      // stripe_product_id が Stripe の形式であること
      expect(body.stripe_product_id).toMatch(/^prod_/)

      createdProductIds.push(body.id)
    })

    test('subscription タイプの商品を作成できること', async () => {
      const name = `E2E サブスク商品 ${Date.now()}`

      const product = await createTestProduct(TEST_API_KEY, name, 'subscription')

      expect(product).toHaveProperty('id')
      expect(product).toHaveProperty('stripe_product_id')
      expect(product).toHaveProperty('name', name)
      expect(product.stripe_product_id).toMatch(/^prod_/)

      createdProductIds.push(product.id)
    })

    test('createTestProduct ヘルパーで商品を作成できること', async () => {
      const name = `E2E ヘルパー商品 ${Date.now()}`
      const product = await createTestProduct(TEST_API_KEY, name)

      expect(product.id).toBeTruthy()
      expect(product.name).toBe(name)

      createdProductIds.push(product.id)
    })

    test('必須フィールド（name）が未指定の場合 400 を返すこと', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          description: '名前なし商品',
        }),
      })

      // バリデーションエラー
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    })
  })

  // ============================================================
  // 商品一覧テスト
  // ============================================================
  test.describe('商品一覧', () => {

    test('商品一覧を取得できること', async () => {
      // テスト用商品を 1 つ作成
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E 一覧テスト商品 ${Date.now()}`
      )
      createdProductIds.push(product.id)

      const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
        headers: { 'X-API-Key': TEST_API_KEY },
      })

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThanOrEqual(1)

      // 各商品のフィールドを検証
      const item = body.data[0]
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('stripe_product_id')
      expect(item).toHaveProperty('name')
      expect(item).toHaveProperty('type')
      expect(item).toHaveProperty('active')
      expect(item).toHaveProperty('created_at')
      expect(item).toHaveProperty('updated_at')
    })

    test('getProducts ヘルパーで一覧を取得できること', async () => {
      const result = await getProducts(TEST_API_KEY)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ============================================================
  // 商品詳細テスト
  // ============================================================
  test.describe('商品詳細', () => {

    test('個別商品を ID で取得できること', async () => {
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E 詳細テスト商品 ${Date.now()}`
      )
      createdProductIds.push(product.id)

      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/products/${product.id}`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body).toHaveProperty('id', product.id)
      expect(body).toHaveProperty('name', product.name)
      expect(body).toHaveProperty('prices')
      expect(Array.isArray(body.prices)).toBe(true)
    })

    test('存在しない商品 ID は 404 を返すこと', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/products/${fakeId}`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(404)

      const body = await response.json()
      expect(body.error).toHaveProperty('code', 'resource_not_found')
    })
  })

  // ============================================================
  // 価格作成テスト
  // ============================================================
  test.describe('価格作成', () => {

    let productForPricing: { id: string; name: string }

    test.beforeAll(async () => {
      // 価格テスト用の共有商品を作成
      productForPricing = await createTestProduct(
        TEST_API_KEY,
        `E2E 価格テスト商品 ${Date.now()}`
      )
      createdProductIds.push(productForPricing.id)
    })

    test('USD 価格を作成できること', async () => {
      const price = await createTestPrice(
        TEST_API_KEY,
        productForPricing.id,
        1999,
        'usd'
      )

      expect(price).toHaveProperty('id')
      expect(price).toHaveProperty('stripe_price_id')
      expect(price).toHaveProperty('product_id', productForPricing.id)
      expect(price).toHaveProperty('amount', 1999)
      expect(price).toHaveProperty('currency', 'usd')

      // stripe_price_id が Stripe の形式であること
      expect(price.stripe_price_id).toMatch(/^price_/)
    })

    test('JPY 価格を作成できること（ゼロデシマル通貨）', async () => {
      const price = await createTestPrice(
        TEST_API_KEY,
        productForPricing.id,
        2980,
        'jpy'
      )

      expect(price.amount).toBe(2980)
      expect(price.currency).toBe('jpy')
      expect(price.stripe_price_id).toMatch(/^price_/)
    })

    test('EUR 価格を作成できること', async () => {
      const price = await createTestPrice(
        TEST_API_KEY,
        productForPricing.id,
        1499,
        'eur'
      )

      expect(price.amount).toBe(1499)
      expect(price.currency).toBe('eur')
    })

    test('サブスクリプション価格（月次）を作成できること', async () => {
      // サブスクリプション商品を作成
      const subProduct = await createTestProduct(
        TEST_API_KEY,
        `E2E サブスク価格テスト ${Date.now()}`,
        'subscription'
      )
      createdProductIds.push(subProduct.id)

      const response = await fetch(`${API_BASE_URL}/api/v1/admin/prices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: subProduct.id,
          amount: 980,
          currency: 'usd',
          interval: 'month',
        }),
      })

      expect(response.status).toBe(201)

      const body = await response.json()
      expect(body).toHaveProperty('interval', 'month')
      expect(body).toHaveProperty('amount', 980)
    })

    test('サブスクリプション価格（年次）を作成できること', async () => {
      const subProduct = await createTestProduct(
        TEST_API_KEY,
        `E2E 年次サブスク ${Date.now()}`,
        'subscription'
      )
      createdProductIds.push(subProduct.id)

      const price = await createTestPrice(
        TEST_API_KEY,
        subProduct.id,
        9800,
        'usd',
        'year'
      )

      expect(price).toHaveProperty('interval', 'year')
      expect(price.amount).toBe(9800)
    })

    test('存在しない商品 ID で価格作成は 404 を返すこと', async () => {
      const fakeProductId = '00000000-0000-0000-0000-000000000000'

      const response = await fetch(`${API_BASE_URL}/api/v1/admin/prices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          product_id: fakeProductId,
          amount: 999,
          currency: 'usd',
        }),
      })

      expect(response.status).toBe(404)
    })

    test('必須フィールド（product_id）が未指定の場合 400 を返すこと', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/admin/prices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_API_KEY,
        },
        body: JSON.stringify({
          amount: 999,
          currency: 'usd',
        }),
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    })
  })

  // ============================================================
  // 価格一覧テスト
  // ============================================================
  test.describe('価格一覧', () => {

    test('商品に紐づく価格一覧を取得できること', async () => {
      // 商品 + 価格を作成
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E 価格一覧テスト ${Date.now()}`
      )
      createdProductIds.push(product.id)

      await createTestPrice(TEST_API_KEY, product.id, 500, 'usd')
      await createTestPrice(TEST_API_KEY, product.id, 800, 'jpy')

      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/prices?product_id=${product.id}`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body).toHaveProperty('data')
      expect(body.data.length).toBeGreaterThanOrEqual(2)

      // 各価格のフィールドを検証
      for (const price of body.data) {
        expect(price).toHaveProperty('id')
        expect(price).toHaveProperty('stripe_price_id')
        expect(price).toHaveProperty('product_id', product.id)
        expect(price).toHaveProperty('amount')
        expect(price).toHaveProperty('currency')
        expect(price).toHaveProperty('active')
        expect(price).toHaveProperty('created_at')
      }
    })
  })

  // ============================================================
  // 商品アーカイブ（削除）テスト
  // ============================================================
  test.describe('商品アーカイブ', () => {

    test('商品をアーカイブ（ソフト削除）できること', async () => {
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E 削除テスト商品 ${Date.now()}`
      )

      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/products/${product.id}`,
        {
          method: 'DELETE',
          headers: { 'X-API-Key': TEST_API_KEY },
        }
      )

      // 204 No Content が返ること
      expect(response.status).toBe(204)
    })

    test('archiveTestProduct ヘルパーでアーカイブできること', async () => {
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E ヘルパー削除テスト ${Date.now()}`
      )

      // エラーが投げられないこと
      await expect(
        archiveTestProduct(TEST_API_KEY, product.id)
      ).resolves.not.toThrow()
    })

    test('存在しない商品のアーカイブは 404 を返すこと', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'

      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/products/${fakeId}`,
        {
          method: 'DELETE',
          headers: { 'X-API-Key': TEST_API_KEY },
        }
      )

      expect(response.status).toBe(404)
    })
  })

  // ============================================================
  // 商品更新テスト
  // ============================================================
  test.describe('商品更新', () => {

    test('商品名と説明を更新できること', async () => {
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E 更新前 ${Date.now()}`
      )
      createdProductIds.push(product.id)

      const updatedName = `E2E 更新後 ${Date.now()}`
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/products/${product.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': TEST_API_KEY,
          },
          body: JSON.stringify({
            name: updatedName,
            description: '更新後の説明',
          }),
        }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body).toHaveProperty('name', updatedName)
      expect(body).toHaveProperty('description', '更新後の説明')
    })
  })
})
