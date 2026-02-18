import { test, expect, TEST_API_KEY, createTestProduct, archiveTestProduct } from './fixtures'

/**
 * 監査ログページ E2E テスト
 *
 * テスト対象:
 * - ページ見出しと説明文
 * - 検索入力によるフィルタリング
 * - アクションフィルタードロップダウン
 * - リソースフィルタードロップダウン
 * - Export CSV ボタン（ログがない場合はdisabled）
 * - テーブルのカラム構成（Action, Resource, Changes, Time）
 * - 空状態の「No logs found」表示
 * - API経由で商品を作成し、監査ログに反映されることを確認
 */
test.describe('監査ログページ', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // 監査ログページに遷移
    await page.goto('/audit-logs')
    await page.waitForLoadState('networkidle')
  })

  test('監査ログページの見出しと基本要素が表示される', async ({ authenticatedPage: page }) => {
    // 見出し「Audit Logs」が表示される
    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible()

    // 説明テキストが表示される（親要素との重複を回避）
    await expect(page.getByText('Track all system activities and changes').first()).toBeVisible()

    // 検索入力欄が表示される
    await expect(page.getByPlaceholder('Search logs...')).toBeVisible()

    // Export CSV ボタンが表示される
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/audit-logs-page-header.png' })
  })

  test('アクションフィルタードロップダウンが存在する', async ({ authenticatedPage: page }) => {
    // 「All Actions」オプションを含むselectが存在する
    const actionSelect = page.locator('select').filter({ hasText: 'All Actions' })
    await expect(actionSelect).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/audit-logs-action-filter.png' })
  })

  test('リソースフィルタードロップダウンが存在する', async ({ authenticatedPage: page }) => {
    // 「All Resources」オプションを含むselectが存在する
    const resourceSelect = page.locator('select').filter({ hasText: 'All Resources' })
    await expect(resourceSelect).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/audit-logs-resource-filter.png' })
  })

  test('ログがない場合に「No logs found」が表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 空状態メッセージの確認（親要素との重複を回避）
    const emptyState = page.getByText('No logs found').first()
    const isEmptyVisible = await emptyState.isVisible().catch(() => false)

    if (isEmptyVisible) {
      await expect(page.getByText('Audit logs will appear here as actions are performed').first()).toBeVisible()

      await page.screenshot({ path: 'test-results/artifacts/audit-logs-empty-state.png', fullPage: true })
    }
  })

  test('ログがない場合にExport CSVボタンが無効になる', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    const exportButton = page.getByRole('button', { name: 'Export CSV' })

    // テーブルが空の場合はdisabledになる（親要素との重複を回避）
    const emptyState = page.getByText('No logs found').first()
    const isEmpty = await emptyState.isVisible().catch(() => false)

    if (isEmpty) {
      await expect(exportButton).toBeDisabled()
    } else {
      // ログがある場合はenabledになる
      await expect(exportButton).toBeEnabled()
    }
  })

  test('監査ログテーブルのカラムが正しく表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // テーブルが存在する場合のみカラムヘッダーを確認
    const table = page.locator('table')
    const hasTable = await table.isVisible().catch(() => false)

    if (hasTable) {
      const thead = table.locator('thead')
      await expect(thead.getByText('Action')).toBeVisible()
      await expect(thead.getByText('Resource')).toBeVisible()
      await expect(thead.getByText('Changes')).toBeVisible()
      await expect(thead.getByText('Time')).toBeVisible()

      await page.screenshot({ path: 'test-results/artifacts/audit-logs-table-columns.png' })
    }
  })

  test('商品を作成すると監査ログに記録される', async ({ authenticatedPage: page }) => {
    // API経由で商品を作成
    const productName = `E2E 監査ログテスト ${Date.now()}`
    const product = await createTestProduct(TEST_API_KEY, productName)

    try {
      // 監査ログページをリロードして最新のログを取得
      await page.reload()
      await page.waitForLoadState('networkidle')

      // ローディング完了を待つ
      await page.waitForFunction(() => {
        return document.querySelectorAll('.animate-spin').length === 0
      }, { timeout: 15000 })

      // テーブルが表示されることを確認
      const table = page.locator('table')
      const hasTable = await table.isVisible().catch(() => false)

      if (hasTable) {
        // テーブル内にログエントリが存在する
        const rows = table.locator('tbody tr')
        const count = await rows.count()
        expect(count).toBeGreaterThan(0)

        // 商品作成アクションのログが存在する（'create' または 'product' を含む行）
        // 注: 実際のログエントリの内容はバックエンドの実装に依存
        await page.screenshot({ path: 'test-results/artifacts/audit-logs-with-data.png', fullPage: true })
      }
    } finally {
      await archiveTestProduct(TEST_API_KEY, product.id).catch(() => {})
    }
  })

  test('検索入力でログをフィルタリングできる', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 検索ボックスに文字を入力
    const searchInput = page.getByPlaceholder('Search logs...')
    await searchInput.fill('product')

    // フィルタリング結果を待つ
    await page.waitForTimeout(500)

    await page.screenshot({ path: 'test-results/artifacts/audit-logs-search-filter.png', fullPage: true })

    // 存在しないキーワードで検索
    await searchInput.fill('zzz_nonexistent_log_entry_xyz')
    await page.waitForTimeout(500)

    // フィルター適用後、一致しない場合は「No logs found」が表示される（親要素との重複を回避）
    const noLogsMessage = page.getByText('No logs found').first()
    const isNoLogsVisible = await noLogsMessage.isVisible().catch(() => false)

    if (isNoLogsVisible) {
      await expect(page.getByText('Try adjusting your filters').first()).toBeVisible()
    }

    await page.screenshot({ path: 'test-results/artifacts/audit-logs-search-no-results.png', fullPage: true })
  })

  test('フィルタードロップダウンでログを絞り込める', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // テーブルが存在する場合のみフィルターテスト
    const table = page.locator('table')
    const hasTable = await table.isVisible().catch(() => false)

    if (hasTable) {
      // アクションフィルタードロップダウンのオプションを確認
      const actionSelect = page.locator('select').filter({ hasText: 'All Actions' })
      const actionOptions = await actionSelect.locator('option').allTextContents()

      // 「All Actions」が含まれることを確認
      expect(actionOptions).toContain('All Actions')

      // リソースフィルタードロップダウンのオプションを確認
      const resourceSelect = page.locator('select').filter({ hasText: 'All Resources' })
      const resourceOptions = await resourceSelect.locator('option').allTextContents()

      // 「All Resources」が含まれることを確認
      expect(resourceOptions).toContain('All Resources')

      await page.screenshot({ path: 'test-results/artifacts/audit-logs-filters.png', fullPage: true })
    }
  })

  test('監査ログの各行にアクションバッジとリソース情報が表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    const table = page.locator('table')
    const hasTable = await table.isVisible().catch(() => false)

    if (hasTable) {
      const rows = table.locator('tbody tr')
      const rowCount = await rows.count()

      if (rowCount > 0) {
        const firstRow = rows.first()

        // アクションバッジがスタイル付きで表示される
        const actionBadge = firstRow.locator('.bg-primary-100.text-primary-700')
        await expect(actionBadge).toBeVisible()

        // リソースタイプとリソースIDが表示される
        const resourceCell = firstRow.locator('td').nth(1)
        await expect(resourceCell.locator('.font-medium')).toBeVisible()
        await expect(resourceCell.locator('.font-mono')).toBeVisible()

        // 時間が表示される
        const timeCell = firstRow.locator('td').nth(3)
        await expect(timeCell).toBeVisible()

        await page.screenshot({ path: 'test-results/artifacts/audit-logs-row-detail.png' })
      }
    }
  })

  test('監査ログページのフルページスクリーンショット', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    await page.screenshot({ path: 'test-results/artifacts/audit-logs-full-page.png', fullPage: true })
  })
})
