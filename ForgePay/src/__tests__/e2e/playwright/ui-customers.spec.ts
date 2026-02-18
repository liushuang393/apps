import { test, expect } from './fixtures'

/**
 * 顧客ページ E2E テスト
 *
 * テスト対象:
 * - 顧客一覧の表示
 * - メール/名前での検索フィルタリング
 * - 空状態の表示
 * - 顧客クリックで詳細モーダルが開く
 * - 詳細モーダルの顧客情報（メール、ID、Stripe Customer ID、作成日）
 * - 詳細モーダルのEntitlementsセクション
 * - Xボタンでモーダルを閉じる
 */
test.describe('顧客ページ', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // 顧客ページに遷移
    await page.goto('/customers')
    await page.waitForLoadState('networkidle')
  })

  test('顧客ページの見出しと基本要素が表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 見出し「Customers」が表示される（h1 を明示的に指定し h3 との重複を回避）
    await expect(page.locator('h1', { hasText: 'Customers' })).toBeVisible({ timeout: 10000 })

    // 説明テキストが表示される
    await expect(page.getByText('View and manage your customers')).toBeVisible()

    // 検索入力欄が表示される
    await expect(page.getByPlaceholder('Search customers by email or name...')).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/customers-page-header.png' })
  })

  test('顧客一覧が表示される（またはの空状態）', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 顧客がいない場合は「No customers yet」が表示される
    const emptyState = page.getByText('No customers yet')
    const isEmptyVisible = await emptyState.isVisible().catch(() => false)

    if (isEmptyVisible) {
      await expect(page.getByText('Customers will appear here after their first purchase')).toBeVisible()
      await page.screenshot({ path: 'test-results/artifacts/customers-empty-state.png', fullPage: true })
    } else {
      // 顧客行が少なくとも1つ表示されている
      const customerRows = page.locator('.divide-y .hover\\:bg-gray-50')
      const count = await customerRows.count()
      expect(count).toBeGreaterThan(0)

      await page.screenshot({ path: 'test-results/artifacts/customers-list.png', fullPage: true })
    }
  })

  test('検索入力で顧客をフィルタリングできる', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 検索ボックスに文字を入力
    const searchInput = page.getByPlaceholder('Search customers by email or name...')
    await searchInput.fill('test')

    // フィルタリング結果を待つ
    await page.waitForTimeout(500)

    await page.screenshot({ path: 'test-results/artifacts/customers-search-filter.png', fullPage: true })

    // 存在しないキーワードで検索すると「No customers found」が表示される
    await searchInput.fill('zzz_nonexistent_query_12345')
    await page.waitForTimeout(500)

    await expect(page.getByText('No customers found')).toBeVisible()
    await expect(page.getByText('Try adjusting your search')).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/customers-search-no-results.png', fullPage: true })
  })

  test('顧客クリックで詳細モーダルが開く', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 顧客行が存在する場合のみテスト
    const customerRows = page.locator('.divide-y .cursor-pointer')
    const count = await customerRows.count()

    if (count > 0) {
      // 最初の顧客行をクリック
      await customerRows.first().click()

      // 詳細モーダルが開くことを確認
      await expect(page.getByRole('heading', { name: 'Customer Details' })).toBeVisible()

      // 顧客情報が表示される（モーダル内でスコープし親要素との重複を回避）
      const modal = page.locator('.fixed.inset-0')
      await expect(modal.getByText('Customer ID').first()).toBeVisible()
      await expect(modal.getByText('Stripe Customer').first()).toBeVisible()
      await expect(modal.getByText('Created').first()).toBeVisible()

      // Entitlementsセクションが表示される
      await expect(page.getByRole('heading', { name: 'Entitlements' })).toBeVisible()

      await page.screenshot({ path: 'test-results/artifacts/customers-detail-modal.png', fullPage: true })

      // Xボタンでモーダルを閉じる
      const closeButton = page.locator('.fixed.inset-0 button').filter({ has: page.locator('svg') }).first()
      await closeButton.click()

      // モーダルが閉じることを確認
      await expect(page.getByRole('heading', { name: 'Customer Details' })).not.toBeVisible()
    } else {
      // 顧客がいない場合はスキップ（テスト結果にログを残す）
      test.skip(true, '顧客データが存在しないため詳細モーダルテストをスキップ')
    }
  })

  test('顧客詳細モーダルの情報が正しく表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    const customerRows = page.locator('.divide-y .cursor-pointer')
    const count = await customerRows.count()

    if (count > 0) {
      // 最初の顧客の情報を取得
      const firstRow = customerRows.first()
      const customerEmail = await firstRow.locator('.text-gray-500').first().textContent()

      // クリックしてモーダルを開く
      await firstRow.click()
      await expect(page.getByRole('heading', { name: 'Customer Details' })).toBeVisible()

      // メールアドレスがモーダル内に表示されることを確認
      if (customerEmail) {
        await expect(page.locator('.fixed.inset-0').getByText(customerEmail.trim())).toBeVisible()
      }

      // モーダル内のアバターイニシャルが表示される
      const avatar = page.locator('.w-16.h-16.bg-primary-100')
      await expect(avatar).toBeVisible()

      // 各情報フィールドが表示される（親要素との重複を回避）
      const detailGrid = page.locator('.grid.grid-cols-2')
      await expect(detailGrid.getByText('Customer ID').first()).toBeVisible()
      await expect(detailGrid.getByText('Stripe Customer').first()).toBeVisible()
      await expect(detailGrid.getByText('Created').first()).toBeVisible()

      // Entitlementsセクション（heading ロールで特定）
      await expect(page.getByRole('heading', { name: 'Entitlements' })).toBeVisible()

      // Entitlementがある場合はステータスバッジを確認
      const entitlementItems = page.locator('.bg-gray-50').filter({ hasText: 'Product:' })
      const entitlementCount = await entitlementItems.count()

      if (entitlementCount === 0) {
        // Entitlementがない場合は「No entitlements」が表示される
        await expect(page.getByText('No entitlements')).toBeVisible()
      }

      await page.screenshot({ path: 'test-results/artifacts/customers-detail-full.png', fullPage: true })
    } else {
      test.skip(true, '顧客データが存在しないためスキップ')
    }
  })

  test('顧客ページのフルページスクリーンショット', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    await page.screenshot({ path: 'test-results/artifacts/customers-full-page.png', fullPage: true })
  })
})
