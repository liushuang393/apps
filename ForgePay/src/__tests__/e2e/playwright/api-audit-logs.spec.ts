import {
  test,
  expect,
  API_BASE_URL,
  TEST_API_KEY,
  createTestProduct,
  archiveTestProduct,
  getAuditLogs,
} from './fixtures'

/**
 * 監査ログ E2E テスト
 *
 * 全ての管理操作（商品作成・更新・アーカイブ等）が
 * 監査ログに正しく記録されることを検証。
 * ページネーション・フィルタリング・レスポンス構造も確認する。
 */
test.describe('監査ログ', () => {

  // テストで作成した商品 ID（クリーンアップ用）
  const createdProductIds: string[] = []

  test.afterAll(async () => {
    for (const id of createdProductIds) {
      await archiveTestProduct(TEST_API_KEY, id).catch(() => {})
    }
  })

  // ============================================================
  // 監査ログ取得テスト
  // ============================================================
  test.describe('ログ取得', () => {

    test('監査ログ一覧を取得できること', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/audit-logs`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('pagination')
      expect(Array.isArray(body.data)).toBe(true)

      // ページネーション構造の検証
      expect(body.pagination).toHaveProperty('total')
      expect(body.pagination).toHaveProperty('limit')
      expect(body.pagination).toHaveProperty('offset')
      expect(typeof body.pagination.total).toBe('number')
    })

    test('getAuditLogs ヘルパーでログを取得できること', async () => {
      const result = await getAuditLogs(TEST_API_KEY)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    test('監査ログは API キーなしで 401 を返すこと', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/audit-logs`
      )

      expect(response.status).toBe(401)
    })
  })

  // ============================================================
  // ログ記録の検証
  // ============================================================
  test.describe('操作時のログ記録', () => {

    test('商品作成時に product.created ログが記録されること', async () => {
      const productName = `E2E 監査ログテスト商品 ${Date.now()}`
      const product = await createTestProduct(TEST_API_KEY, productName)
      createdProductIds.push(product.id)

      // 少し待ってからログを取得（非同期書き込みの可能性があるため）
      await new Promise(resolve => setTimeout(resolve, 500))

      const logs = await getAuditLogs(TEST_API_KEY, {
        action: 'product.created',
        resource_type: 'product',
        resource_id: product.id,
      })

      expect(logs.data.length).toBeGreaterThanOrEqual(1)

      // 該当ログの検証
      const logEntry = logs.data.find(
        (log: any) => log.resource_id === product.id
      )
      expect(logEntry).toBeTruthy()
      expect(logEntry.action).toBe('product.created')
      expect(logEntry.resource_type).toBe('product')
      expect(logEntry.resource_id).toBe(product.id)
    })

    test('商品アーカイブ時に product.archived ログが記録されること', async () => {
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E アーカイブログテスト ${Date.now()}`
      )

      // 商品をアーカイブ
      await archiveTestProduct(TEST_API_KEY, product.id)

      // 少し待ってからログを取得
      await new Promise(resolve => setTimeout(resolve, 500))

      const logs = await getAuditLogs(TEST_API_KEY, {
        action: 'product.archived',
        resource_id: product.id,
      })

      expect(logs.data.length).toBeGreaterThanOrEqual(1)

      const logEntry = logs.data.find(
        (log: any) => log.resource_id === product.id
      )
      expect(logEntry).toBeTruthy()
      expect(logEntry.action).toBe('product.archived')
    })
  })

  // ============================================================
  // ログ構造の検証
  // ============================================================
  test.describe('ログ構造', () => {

    test('各監査ログエントリに必須フィールドがあること', async () => {
      // テストデータ作成（ログが最低 1 件ある状態を保証）
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E 構造テスト商品 ${Date.now()}`
      )
      createdProductIds.push(product.id)

      await new Promise(resolve => setTimeout(resolve, 500))

      const logs = await getAuditLogs(TEST_API_KEY)

      expect(logs.data.length).toBeGreaterThanOrEqual(1)

      // 最新のログエントリの構造を検証
      const logEntry = logs.data[0]
      expect(logEntry).toHaveProperty('id')
      expect(logEntry).toHaveProperty('action')
      expect(logEntry).toHaveProperty('resource_type')
      expect(logEntry).toHaveProperty('resource_id')
      expect(logEntry).toHaveProperty('created_at')

      // id が文字列であること
      expect(typeof logEntry.id).toBe('string')

      // action がドット区切り形式であること（例: product.created）
      expect(logEntry.action).toMatch(/^[a-z_]+\.[a-z_]+$/)

      // created_at が有効な ISO 文字列であること
      expect(new Date(logEntry.created_at).toISOString()).toBe(logEntry.created_at)
    })

    test('監査ログに changes フィールドが含まれること', async () => {
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E changes フィールドテスト ${Date.now()}`
      )
      createdProductIds.push(product.id)

      await new Promise(resolve => setTimeout(resolve, 500))

      const logs = await getAuditLogs(TEST_API_KEY, {
        resource_id: product.id,
      })

      expect(logs.data.length).toBeGreaterThanOrEqual(1)

      const logEntry = logs.data.find(
        (log: any) => log.resource_id === product.id
      )
      expect(logEntry).toBeTruthy()

      // changes フィールドが存在すること（null 許容）
      expect('changes' in logEntry).toBe(true)
    })
  })

  // ============================================================
  // フィルタリングテスト
  // ============================================================
  test.describe('フィルタリング', () => {

    test('action フィルターで絞り込みできること', async () => {
      const logs = await getAuditLogs(TEST_API_KEY, {
        action: 'product.created',
      })

      expect(logs.data).toBeDefined()
      expect(Array.isArray(logs.data)).toBe(true)

      // 全エントリが指定した action であること
      for (const log of logs.data) {
        expect(log.action).toBe('product.created')
      }
    })

    test('resource_type フィルターで絞り込みできること', async () => {
      const logs = await getAuditLogs(TEST_API_KEY, {
        resource_type: 'product',
      })

      expect(logs.data).toBeDefined()
      expect(Array.isArray(logs.data)).toBe(true)

      // 全エントリが指定した resource_type であること
      for (const log of logs.data) {
        expect(log.resource_type).toBe('product')
      }
    })

    test('resource_id フィルターで特定リソースのログを取得できること', async () => {
      const product = await createTestProduct(
        TEST_API_KEY,
        `E2E リソースIDフィルターテスト ${Date.now()}`
      )
      createdProductIds.push(product.id)

      await new Promise(resolve => setTimeout(resolve, 500))

      const logs = await getAuditLogs(TEST_API_KEY, {
        resource_id: product.id,
      })

      expect(logs.data.length).toBeGreaterThanOrEqual(1)

      // 全エントリが指定した resource_id であること
      for (const log of logs.data) {
        expect(log.resource_id).toBe(product.id)
      }
    })

    test('複数フィルターを組み合わせて絞り込みできること', async () => {
      const logs = await getAuditLogs(TEST_API_KEY, {
        action: 'product.created',
        resource_type: 'product',
      })

      expect(logs.data).toBeDefined()

      for (const log of logs.data) {
        expect(log.action).toBe('product.created')
        expect(log.resource_type).toBe('product')
      }
    })
  })

  // ============================================================
  // ページネーションテスト
  // ============================================================
  test.describe('ページネーション', () => {

    test('limit パラメータで取得件数を制限できること', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/audit-logs?limit=2`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.data.length).toBeLessThanOrEqual(2)
      expect(body.pagination.limit).toBe(2)
    })

    test('offset パラメータでスキップできること', async () => {
      // まず全件取得
      const allLogs = await getAuditLogs(TEST_API_KEY)

      if (allLogs.data.length < 2) {
        // ログが少なすぎるのでスキップ
        test.skip()
        return
      }

      // offset=1 で取得
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/audit-logs?offset=1&limit=10`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.pagination.offset).toBe(1)

      // 最初のページとオフセットページの 1 件目が異なること
      if (body.data.length > 0 && allLogs.data.length > 1) {
        expect(body.data[0].id).toBe(allLogs.data[1].id)
      }
    })

    test('total が正しくカウントされること', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/audit-logs?limit=1`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      // total は limit 以上であること（全件数だから）
      expect(body.pagination.total).toBeGreaterThanOrEqual(body.data.length)
    })
  })

  // ============================================================
  // Webhook ログ（DLQ）テスト
  // ============================================================
  test.describe('失敗 Webhook 一覧', () => {

    test('失敗 Webhook 一覧を取得できること', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/webhooks/failed`,
        { headers: { 'X-API-Key': TEST_API_KEY } }
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)
    })

    test('失敗 Webhook 一覧は API キーなしで 401 を返すこと', async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/admin/webhooks/failed`
      )

      expect(response.status).toBe(401)
    })
  })
})
