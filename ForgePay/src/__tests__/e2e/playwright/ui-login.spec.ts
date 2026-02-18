import { test, expect, TEST_API_KEY, DASHBOARD_URL } from './fixtures'

/**
 * ログインページ E2E テスト
 *
 * テスト対象:
 * - ログイン画面の表示要素
 * - 空APIキーのバリデーション
 * - 無効APIキーのエラーハンドリング
 * - 正常ログインとリダイレクト
 * - localStorage による認証永続化
 * - ログアウト処理
 */
test.describe('ログインページ', () => {
  test.beforeEach(async ({ page }) => {
    // 各テスト前にlocalStorageをクリアして未認証状態にする
    await page.goto('/login')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test('ログイン画面が正しく表示される', async ({ page }) => {
    // 「ForgePay Admin」見出しが表示される
    await expect(page.getByRole('heading', { name: 'ForgePay Admin' })).toBeVisible()

    // APIキー入力欄が存在する（type="password"、placeholder="sk_test_..."）
    const apiKeyInput = page.locator('input[type="password"]')
    await expect(apiKeyInput).toBeVisible()
    await expect(apiKeyInput).toHaveAttribute('placeholder', 'sk_test_...')

    // 「Access Dashboard」ボタンが表示される
    const submitButton = page.getByRole('button', { name: 'Access Dashboard' })
    await expect(submitButton).toBeVisible()

    // 説明テキストが表示される
    await expect(page.getByText('Enter your API key to access the dashboard')).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/login-page-initial.png', fullPage: true })
  })

  test('空のAPIキーでエラーメッセージが表示される', async ({ page }) => {
    // APIキーを入力せずに送信ボタンをクリック
    await page.getByRole('button', { name: 'Access Dashboard' }).click()

    // エラーメッセージ「Please enter your API key」が表示される
    await expect(page.getByText('Please enter your API key')).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/login-empty-key-error.png', fullPage: true })
  })

  test('無効なAPIキーでエラーメッセージが表示される', async ({ page }) => {
    // 無効なAPIキーを入力して送信
    const apiKeyInput = page.locator('input[type="password"]')
    await apiKeyInput.fill('sk_test_invalid_key_12345')
    await page.getByRole('button', { name: 'Access Dashboard' }).click()

    // エラーメッセージが表示される（「Invalid API key」または「Failed to validate」）
    // レート制限時は「Failed to validate API key」になる可能性があるため両方許容
    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 15000 })

    // エラーコンテナ内にテキストが存在することを確認
    const errorText = await page.locator('.bg-red-50').textContent()
    expect(errorText).toBeTruthy()
    expect(
      errorText!.includes('Invalid API key') || errorText!.includes('Failed to validate')
    ).toBe(true)

    await page.screenshot({ path: 'test-results/artifacts/login-invalid-key-error.png', fullPage: true })
  })

  test('正しいAPIキーでダッシュボードにリダイレクトされる', async ({ page }) => {
    // 有効なAPIキーを入力して送信
    const apiKeyInput = page.locator('input[type="password"]')
    await apiKeyInput.fill(TEST_API_KEY)
    await page.getByRole('button', { name: 'Access Dashboard' }).click()

    // ダッシュボードにリダイレクトされることを確認
    await page.waitForURL('/', { timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/login-success-redirect.png', fullPage: true })
  })

  test('ログイン後、ページをリロードしても認証状態が維持される', async ({ page }) => {
    // ログイン処理
    await page.locator('input[type="password"]').fill(TEST_API_KEY)
    await page.getByRole('button', { name: 'Access Dashboard' }).click()
    await page.waitForURL('/')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // ページをリロード
    await page.reload()
    await page.waitForLoadState('networkidle')

    // ダッシュボードに留まっていることを確認（/loginにリダイレクトされない）
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // localStorageにAPIキーが保存されていることを確認
    const storedKey = await page.evaluate(() => localStorage.getItem('apiKey'))
    expect(storedKey).toBe(TEST_API_KEY)

    await page.screenshot({ path: 'test-results/artifacts/login-persistence-after-reload.png', fullPage: true })
  })

  test('ログアウトで認証状態がクリアされる', async ({ page }) => {
    // まずログインする
    await page.locator('input[type="password"]').fill(TEST_API_KEY)
    await page.getByRole('button', { name: 'Access Dashboard' }).click()
    await page.waitForURL('/', { timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })

    // デスクトップサイドバーを取得（lg:flex で表示される要素）
    const sidebar = page.locator('div.hidden.lg\\:fixed')
    await expect(sidebar).toBeVisible({ timeout: 5000 })

    // Logoutボタンをクリック
    const logoutButton = sidebar.getByRole('button', { name: 'Logout' })
    await expect(logoutButton).toBeVisible({ timeout: 5000 })
    await logoutButton.click()

    // ログアウト処理: React の setState → ProtectedRoute の再レンダリングを待つ
    // 即座にURLが変わらない場合があるため、ページリロードで状態を反映させる
    await page.waitForTimeout(1000)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // ログインページにリダイレクトされることを確認
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'ForgePay Admin' })).toBeVisible({ timeout: 10000 })

    // localStorageからAPIキーが削除されていることを確認
    const storedKey = await page.evaluate(() => localStorage.getItem('apiKey'))
    expect(storedKey).toBeNull()

    await page.screenshot({ path: 'test-results/artifacts/login-logout-complete.png', fullPage: true })
  })

  test('未認証状態でダッシュボードにアクセスするとログインページにリダイレクトされる', async ({ page }) => {
    // localStorageをクリアした状態でダッシュボードにアクセス
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // ログインページにリダイレクトされることを確認
    await expect(page).toHaveURL('/login')
    await expect(page.getByRole('heading', { name: 'ForgePay Admin' })).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/login-unauthenticated-redirect.png', fullPage: true })
  })
})
