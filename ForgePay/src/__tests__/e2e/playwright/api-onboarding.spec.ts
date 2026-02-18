import { test, expect, API_BASE_URL, registerDeveloper } from './fixtures'

/**
 * 開発者オンボーディング E2E テスト
 *
 * 開発者登録 → API キー取得 → 認証付きアクセス のフロー全体を検証。
 * 重複登録・バリデーションエラーのハンドリングも確認する。
 */
test.describe('開発者オンボーディング', () => {

  // テストで作成した開発者の API キーを保持
  let registeredApiKey: string
  let registeredEmail: string

  test.beforeAll(() => {
    // ユニークなメールアドレスを生成
    registeredEmail = `e2e-onboard-${Date.now()}@test.example.com`
  })

  test('POST /onboarding/register — 新規開発者を登録できること', async () => {
    const response = await fetch(`${API_BASE_URL}/api/v1/onboarding/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: registeredEmail, testMode: true }),
    })

    expect(response.status).toBe(201)

    const body = await response.json()

    // レスポンス構造の検証
    expect(body).toHaveProperty('message', 'Registration successful')
    expect(body).toHaveProperty('developer')
    expect(body).toHaveProperty('apiKey')
    expect(body).toHaveProperty('warning')

    // 開発者情報の検証
    expect(body.developer).toHaveProperty('id')
    expect(body.developer).toHaveProperty('email', registeredEmail)
    expect(body.developer).toHaveProperty('testMode', true)
    expect(body.developer).toHaveProperty('createdAt')

    // API キー情報の検証
    expect(body.apiKey).toHaveProperty('key')
    expect(body.apiKey).toHaveProperty('prefix')
    expect(typeof body.apiKey.key).toBe('string')
    expect(body.apiKey.key.length).toBeGreaterThan(10)

    // 後続テスト用に API キーを保存
    registeredApiKey = body.apiKey.key
  })

  test('同一メールアドレスでの重複登録は 409 を返すこと', async () => {
    const response = await fetch(`${API_BASE_URL}/api/v1/onboarding/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: registeredEmail, testMode: true }),
    })

    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body).toHaveProperty('error', 'Email already registered')
  })

  test('メールアドレス未指定は 400 を返すこと', async () => {
    const response = await fetch(`${API_BASE_URL}/api/v1/onboarding/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  test('不正なメール形式は 400 を返すこと', async () => {
    const invalidEmails = [
      'not-an-email',
      '@missing-local.com',
      'missing-domain@',
      'spaces in@email.com',
    ]

    for (const email of invalidEmails) {
      const response = await fetch(`${API_BASE_URL}/api/v1/onboarding/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      expect(response.status).toBe(400)
    }
  })

  test('registerDeveloper ヘルパーで開発者を登録できること', async () => {
    const uniqueEmail = `e2e-helper-${Date.now()}@test.example.com`
    const result = await registerDeveloper(uniqueEmail)

    expect(result).toHaveProperty('developer')
    expect(result).toHaveProperty('apiKey')
    expect(result.developer.email).toBe(uniqueEmail)
    expect(typeof result.apiKey.key).toBe('string')
  })

  test('取得した API キーで Admin エンドポイントにアクセスできること', async () => {
    // 前のテストで取得したキーを使用
    test.skip(!registeredApiKey, '登録テストが先に成功している必要がある')

    const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
      headers: { 'X-API-Key': registeredApiKey },
    })

    // 認証成功 → 200 が返ること
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
    // 新規開発者なので商品はまだない
    expect(body.data.length).toBe(0)
  })

  test('取得した API キーでオンボーディングステータスを確認できること', async () => {
    test.skip(!registeredApiKey, '登録テストが先に成功している必要がある')

    const response = await fetch(`${API_BASE_URL}/api/v1/onboarding/status`, {
      headers: { 'X-API-Key': registeredApiKey },
    })

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toHaveProperty('status')
  })

  test('取得した API キーで開発者情報 (me) を取得できること', async () => {
    test.skip(!registeredApiKey, '登録テストが先に成功している必要がある')

    const response = await fetch(`${API_BASE_URL}/api/v1/onboarding/me`, {
      headers: { 'X-API-Key': registeredApiKey },
    })

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toHaveProperty('developer')
    expect(body.developer).toHaveProperty('id')
    // registeredApiKey で認証した開発者の email が返されること
    expect(body.developer).toHaveProperty('email')
    expect(typeof body.developer.email).toBe('string')
    expect(body.developer.email).toContain('@')
  })
})
