import { test, expect, API_BASE_URL, TEST_API_KEY, checkHealth } from './fixtures'

/**
 * ヘルスチェック & API 基本疎通テスト
 *
 * 薄いレイヤーが正常に起動しているか、
 * 認証保護が正しく機能しているかを検証する。
 */
test.describe('ヘルスチェック & API 基本疎通', () => {

  test('GET /health — 200 と status ok が返ること', async () => {
    // ヘルスチェックエンドポイントへリクエスト
    const response = await fetch(`${API_BASE_URL}/health`)

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toHaveProperty('status', 'ok')
    expect(body).toHaveProperty('timestamp')
    expect(body).toHaveProperty('version', 'slim')

    // タイムスタンプが有効な ISO 文字列であること
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp)
  })

  test('ヘルスチェックが許容時間内に応答すること（< 2000ms）', async () => {
    const start = Date.now()
    const response = await fetch(`${API_BASE_URL}/health`)
    const elapsed = Date.now() - start

    expect(response.ok).toBe(true)
    // 2 秒以内に応答すること
    expect(elapsed).toBeLessThan(2000)
  })

  test('checkHealth ヘルパーが true を返すこと', async () => {
    const healthy = await checkHealth()
    expect(healthy).toBe(true)
  })

  test('保護エンドポイントは API キーなしで 401 を返すこと', async () => {
    // 商品一覧エンドポイント（認証必須）にキーなしでアクセス
    const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`)

    expect(response.status).toBe(401)

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  test('保護エンドポイントは無効な API キーで 401 を返すこと', async () => {
    const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
      headers: { 'X-API-Key': 'invalid_key_12345' },
    })

    expect(response.status).toBe(401)
  })

  test('チェックアウトエンドポイントは API キーなしで 401 を返すこと', async () => {
    const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: 'dummy',
        price_id: 'dummy',
        purchase_intent_id: 'dummy',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    })

    expect(response.status).toBe(401)
  })

  test('存在しないパスは 404 を返すこと', async () => {
    const response = await fetch(`${API_BASE_URL}/api/v1/nonexistent-endpoint`)

    expect(response.status).toBe(404)

    const body = await response.json()
    expect(body.error).toHaveProperty('code', 'not_found')
    expect(body.error).toHaveProperty('type', 'invalid_request_error')
  })

  test('有効な API キーで保護エンドポイントにアクセスできること', async () => {
    // TEST_API_KEY が設定されている場合のみ実行
    test.skip(!TEST_API_KEY, 'TEST_API_KEY が未設定のためスキップ')

    const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
      headers: { 'X-API-Key': TEST_API_KEY },
    })

    // 認証成功なので 200 (or 他の成功コード) が返ること
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
  })
})
