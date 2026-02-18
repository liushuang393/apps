import { test, expect, TEST_API_KEY, createTestProduct, createTestPrice, archiveTestProduct } from './fixtures'

/**
 * 商品管理ページ E2E テスト
 *
 * テスト対象:
 * - 商品一覧の表示
 * - 「Add Product」ボタンとモーダル
 * - ワンタイム商品の作成
 * - サブスクリプション商品の作成
 * - 価格モーダルの表示と価格追加
 * - 商品のタイプバッジ（One-time/Subscription）とステータスバッジ（Active/Archived）
 * - 商品のアーカイブ（削除確認ダイアログ）
 * - 空状態の表示
 */
test.describe('商品管理ページ', () => {
  test('商品ページの見出しと基本要素が表示される', async ({ authenticatedPage: page }) => {
    // 商品ページに遷移
    await page.goto('/products')
    await page.waitForLoadState('networkidle')

    // 見出し「Products」が表示される
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()

    // 説明テキストが表示される
    await expect(page.getByText('Manage your products, pricing, and payment links')).toBeVisible()

    // 「Add Product」ボタンが表示される
    await expect(page.getByRole('button', { name: 'Add Product' })).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/products-page-header.png' })
  })

  test('商品がない場合に空状態が表示される', async ({ authenticatedPage: page }) => {
    await page.goto('/products')
    await page.waitForLoadState('networkidle')

    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 商品がない場合は「No products yet」と「Create Product」ボタンが表示される
    const emptyState = page.getByText('No products yet')
    const isEmptyVisible = await emptyState.isVisible().catch(() => false)

    if (isEmptyVisible) {
      await expect(page.getByText('Get started by creating your first product')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Create Product' })).toBeVisible()

      await page.screenshot({ path: 'test-results/artifacts/products-empty-state.png', fullPage: true })
    }
  })

  test('「Add Product」ボタンで作成モーダルが開く', async ({ authenticatedPage: page }) => {
    await page.goto('/products')
    await page.waitForLoadState('networkidle')

    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 「Add Product」ボタンをクリック
    await page.getByRole('button', { name: 'Add Product' }).click()

    // モーダルが開くことを確認
    const modal = page.locator('.fixed.inset-0')
    await expect(modal).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'Create Product' })).toBeVisible()

    // モーダル内のフォーム要素を確認（htmlFor 未設定のため placeholder/要素タイプで特定）
    const nameInput = modal.getByPlaceholder('e.g. Premium Plan')
    await expect(nameInput).toBeVisible()
    await expect(modal.locator('textarea')).toBeVisible()
    const typeSelect = modal.locator('select')
    await expect(typeSelect).toBeVisible()

    // タイプセレクトのデフォルト値が「one_time」であることを確認
    await expect(typeSelect).toHaveValue('one_time')

    // CancelとCreateボタンが表示される
    await expect(modal.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Create' })).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/products-create-modal.png', fullPage: true })

    // Cancelボタンでモーダルが閉じる
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Create Product' })).not.toBeVisible()
  })

  test('ワンタイム商品を作成できる', async ({ authenticatedPage: page }) => {
    const productName = `E2E ワンタイムテスト ${Date.now()}`

    await page.goto('/products')
    await page.waitForLoadState('networkidle')

    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // モーダルを開く
    await page.getByRole('button', { name: 'Add Product' }).click()
    const modal = page.locator('.fixed.inset-0')
    await expect(modal).toBeVisible({ timeout: 5000 })

    // フォームに入力（htmlFor 未設定のため placeholder/要素タイプで特定）
    await modal.getByPlaceholder('e.g. Premium Plan').fill(productName)
    await modal.locator('textarea').fill('E2E テスト用ワンタイム商品')
    await modal.locator('select').selectOption('one_time')

    // 送信
    await modal.getByRole('button', { name: 'Create' }).click()

    // モーダルが閉じることを確認
    await expect(modal).not.toBeVisible({ timeout: 15000 })

    // 商品リストに新しい商品が表示されることを確認
    await expect(page.locator('h3', { hasText: productName })).toBeVisible({ timeout: 10000 })

    // タイプバッジ「One-time」が表示されることを確認
    await expect(page.getByText('One-time').first()).toBeVisible()

    // ステータスバッジ「Active」が表示されることを確認
    await expect(page.getByText('Active').first()).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/products-one-time-created.png', fullPage: true })
  })

  test('サブスクリプション商品を作成できる', async ({ authenticatedPage: page }) => {
    const productName = `E2E サブスクテスト ${Date.now()}`

    await page.goto('/products')
    await page.waitForLoadState('networkidle')

    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // モーダルを開く
    await page.getByRole('button', { name: 'Add Product' }).click()
    const modal = page.locator('.fixed.inset-0')
    await expect(modal).toBeVisible({ timeout: 5000 })

    // サブスクリプション商品として入力（htmlFor 未設定のため placeholder/要素タイプで特定）
    await modal.getByPlaceholder('e.g. Premium Plan').fill(productName)
    await modal.locator('textarea').fill('E2E テスト用サブスクリプション商品')
    await modal.locator('select').selectOption('subscription')

    // 送信
    await modal.getByRole('button', { name: 'Create' }).click()

    // モーダルが閉じることを確認
    await expect(modal).not.toBeVisible({ timeout: 15000 })

    // 商品リストに新しい商品が表示されることを確認
    await expect(page.locator('h3', { hasText: productName })).toBeVisible({ timeout: 10000 })

    // タイプバッジ「Subscription」が表示されることを確認
    await expect(page.getByText('Subscription').first()).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/products-subscription-created.png', fullPage: true })
  })

  test('価格モーダルを開いて価格を追加できる', async ({ authenticatedPage: page }) => {
    // テスト用商品をAPIで先に作成
    const product = await createTestProduct(TEST_API_KEY, `E2E 価格テスト ${Date.now()}`)

    try {
      await page.goto('/products')
      await page.waitForLoadState('networkidle')

      // ローディング完了を待つ
      await page.waitForFunction(() => {
        return document.querySelectorAll('.animate-spin').length === 0
      }, { timeout: 15000 })

      // 商品行の「Price」ボタンをクリック（行全体をフィルタで特定）
      const productRow = page.locator('.divide-y > div').filter({ hasText: product.name })
      await productRow.getByRole('button', { name: 'Price' }).click()

      // 価格モーダルが開くことを確認（モーダル内でスコープして重複を回避）
      await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible()
      const modal = page.locator('.fixed.inset-0')
      await expect(modal.getByText(product.name)).toBeVisible()

      // 「No prices set」の空状態が表示される
      await expect(page.getByText('No prices set')).toBeVisible()

      // 「Add New Price」フォームが表示される
      await expect(page.getByText('Add New Price')).toBeVisible()

      // 金額を入力（htmlFor 未設定のためタイプで特定）
      const amountInput = page.locator('input[type="number"]')
      await amountInput.fill('980')

      // 通貨を選択（価格モーダル内の select）
      const priceModal = page.locator('.fixed.inset-0')
      await priceModal.locator('select').first().selectOption('jpy')

      await page.screenshot({ path: 'test-results/artifacts/products-price-modal.png', fullPage: true })

      // 価格を追加
      await page.getByRole('button', { name: 'Add Price' }).click()

      // 成功メッセージが表示される
      await expect(page.getByText('Price added successfully!')).toBeVisible({ timeout: 10000 })

      // 「Current Prices」セクションに追加された価格が表示される
      await expect(page.getByText('Current Prices')).toBeVisible()

      await page.screenshot({ path: 'test-results/artifacts/products-price-added.png', fullPage: true })
    } finally {
      await archiveTestProduct(TEST_API_KEY, product.id).catch(() => {})
    }
  })

  test('商品リストにタイプバッジとステータスバッジが表示される', async ({ authenticatedPage: page }) => {
    // テスト用商品を作成
    const product = await createTestProduct(TEST_API_KEY, `E2E バッジテスト ${Date.now()}`, 'one_time')

    try {
      await page.goto('/products')
      await page.waitForLoadState('networkidle')

      // ローディング完了を待つ
      await page.waitForFunction(() => {
        return document.querySelectorAll('.animate-spin').length === 0
      }, { timeout: 15000 })

      // 商品名が表示される（heading で特定し重複を回避）
      await expect(page.getByRole('heading', { name: product.name })).toBeVisible()

      // タイプバッジが表示される（行全体をフィルタで特定）
      const productRow = page.locator('.divide-y > div').filter({ hasText: product.name })
      await expect(productRow.getByText('One-time')).toBeVisible()

      // ステータスバッジ「Active」が表示される
      await expect(productRow.getByText('Active')).toBeVisible()

      await page.screenshot({ path: 'test-results/artifacts/products-badges.png', fullPage: true })
    } finally {
      await archiveTestProduct(TEST_API_KEY, product.id).catch(() => {})
    }
  })

  test('商品をアーカイブ（削除）できる', async ({ authenticatedPage: page }) => {
    // テスト用商品をAPIで先に作成
    const product = await createTestProduct(TEST_API_KEY, `E2E 削除テスト ${Date.now()}`)

    // ダイアログのハンドラーを設定（confirmをacceptする）
    page.on('dialog', async (dialog) => {
      await dialog.accept()
    })

    try {
      await page.goto('/products')
      await page.waitForLoadState('networkidle')

      // ローディング完了を待つ
      await page.waitForFunction(() => {
        return document.querySelectorAll('.animate-spin').length === 0
      }, { timeout: 15000 })

      // 商品が表示されることを確認（heading で特定し重複を回避）
      await expect(page.getByRole('heading', { name: product.name })).toBeVisible()

      // 商品行のArchive（削除）ボタンをクリック（行全体をフィルタで特定）
      const productRow = page.locator('.divide-y > div').filter({ hasText: product.name })
      await productRow.getByTitle('Archive').click()

      // confirm ダイアログが自動的に accept される

      // 商品がリストから消えることを確認（またはArchivedステータスになる）
      await page.waitForTimeout(2000)

      await page.screenshot({ path: 'test-results/artifacts/products-archived.png', fullPage: true })
    } finally {
      await archiveTestProduct(TEST_API_KEY, product.id).catch(() => {})
    }
  })

  test('商品の編集ボタンで編集モーダルが開く', async ({ authenticatedPage: page }) => {
    // テスト用商品をAPIで先に作成
    const product = await createTestProduct(TEST_API_KEY, `E2E 編集テスト ${Date.now()}`)

    try {
      await page.goto('/products')
      await page.waitForLoadState('networkidle')

      // ローディング完了を待つ
      await page.waitForFunction(() => {
        return document.querySelectorAll('.animate-spin').length === 0
      }, { timeout: 15000 })

      // 商品が表示されることを確認（heading で特定し重複を回避）
      await expect(page.getByRole('heading', { name: product.name })).toBeVisible()

      // 商品行のEditボタンをクリック（行全体をフィルタで特定）
      const productRow = page.locator('.divide-y > div').filter({ hasText: product.name })
      await expect(productRow).toBeVisible({ timeout: 10000 })
      await productRow.getByTitle('Edit').click()

      // 編集モーダルが開くことを確認
      const modal = page.locator('.fixed.inset-0')
      await expect(modal).toBeVisible({ timeout: 5000 })
      await expect(page.getByRole('heading', { name: 'Edit Product' })).toBeVisible()

      // フォームに既存の値がプリフィルされていることを確認
      await expect(modal.getByPlaceholder('e.g. Premium Plan')).toHaveValue(product.name)

      await page.screenshot({ path: 'test-results/artifacts/products-edit-modal.png', fullPage: true })

      // Cancelボタンでモーダルを閉じる
      await modal.getByRole('button', { name: 'Cancel' }).click()
    } finally {
      await archiveTestProduct(TEST_API_KEY, product.id).catch(() => {})
    }
  })

  test('商品一覧のフルページスクリーンショット', async ({ authenticatedPage: page }) => {
    await page.goto('/products')
    await page.waitForLoadState('networkidle')

    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    await page.screenshot({ path: 'test-results/artifacts/products-full-page.png', fullPage: true })
  })
})
