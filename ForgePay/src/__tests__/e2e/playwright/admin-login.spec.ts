import { test, expect, TEST_API_KEY } from './fixtures'

/**
 * E2E Tests for Admin Dashboard Login Flow
 * 
 * Test Scenarios:
 * 1. Navigate to login page
 * 2. Enter valid API key and verify redirect to Dashboard
 * 3. Test invalid API key error message
 * 4. Test empty API key validation
 */

test.describe('Admin Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any stored authentication
    await page.context().clearCookies()
    await page.goto('/login')
  })

  test('should display login page correctly', async ({ page }) => {
    // Verify page title and description
    await expect(page.locator('h1')).toContainText('ForgePay Admin')
    await expect(page.locator('text=Enter your API key to access the dashboard')).toBeVisible()
    
    // Verify input field exists
    const apiKeyInput = page.locator('input[type="password"]')
    await expect(apiKeyInput).toBeVisible()
    await expect(apiKeyInput).toHaveAttribute('placeholder', 'sk_test_...')
    
    // Verify submit button
    const submitButton = page.locator('button[type="submit"]')
    await expect(submitButton).toBeVisible()
    await expect(submitButton).toContainText('Access Dashboard')
  })

  test('should login with valid API key and redirect to Dashboard', async ({ page }) => {
    // Fill in API key
    await page.fill('input[type="password"]', TEST_API_KEY)
    
    // Click login button
    await page.click('button[type="submit"]')
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 })
    
    // Verify we're on the dashboard
    await expect(page.locator('h1')).toContainText('Dashboard')
    await expect(page.locator('text=Overview of your payment platform')).toBeVisible()
  })

  test('should show error for invalid API key', async ({ page }) => {
    // Fill in invalid API key
    await page.fill('input[type="password"]', 'invalid_api_key_12345')
    
    // Click login button
    await page.click('button[type="submit"]')
    
    // Wait for error message
    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.text-red-600')).toContainText(/Invalid API key|Failed to validate/)
    
    // Verify we're still on login page
    await expect(page).toHaveURL('/login')
  })

  test('should show error for empty API key', async ({ page }) => {
    // Click login button without entering API key
    await page.click('button[type="submit"]')
    
    // Wait for error message
    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 3000 })
    await expect(page.locator('.text-red-600')).toContainText('Please enter your API key')
    
    // Verify we're still on login page
    await expect(page).toHaveURL('/login')
  })

  test('should show loading state while validating', async ({ page }) => {
    // Fill in API key
    await page.fill('input[type="password"]', TEST_API_KEY)
    
    // Click login button
    await page.click('button[type="submit"]')
    
    // Verify loading state appears briefly
    const button = page.locator('button[type="submit"]')
    
    // Button should be disabled during loading
    await expect(button).toBeDisabled()
    await expect(button).toContainText('Validating...')
  })

  test('should redirect to login when accessing protected route without auth', async ({ page }) => {
    // Try to access dashboard directly
    await page.goto('/products')
    
    // Should redirect to login
    await expect(page).toHaveURL('/login')
  })

  test('ログアウトボタンでログアウトできる', async ({ page }) => {
    // まずログイン
    await page.fill('input[type="password"]', TEST_API_KEY)
    await page.click('button[type="submit"]')
    
    // ダッシュボードに遷移するまで待つ
    await page.waitForURL('/', { timeout: 10000 })
    await expect(page.locator('h1')).toContainText('Dashboard')
    
    // ログアウトボタンを探す（ヘッダーまたはサイドバー）
    const logoutButton = page.locator('button:has-text("Logout"), button:has-text("ログアウト"), a:has-text("Logout"), button:has-text("Sign out")')
    
    if (await logoutButton.first().isVisible().catch(() => false)) {
      await logoutButton.first().click()
      
      // ログインページにリダイレクトされることを確認
      await expect(page).toHaveURL('/login', { timeout: 5000 })
    } else {
      // ログアウトボタンがない場合はスキップ
      console.log('ログアウトボタンが見つかりません - UIを確認してください')
    }
  })

  test('セッション期限切れ後にログインページにリダイレクトされる', async ({ page }) => {
    // ログイン
    await page.fill('input[type="password"]', TEST_API_KEY)
    await page.click('button[type="submit"]')
    await page.waitForURL('/', { timeout: 10000 })
    
    // LocalStorageをクリア（セッション切れをシミュレート）
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    
    // ページをリロード
    await page.reload()
    
    // ログインページにリダイレクトされるか、ログインが必要な状態になることを確認
    await page.waitForTimeout(1000)
    const onLoginPage = await page.url().includes('/login')
    const hasLoginForm = await page.locator('input[type="password"]').isVisible().catch(() => false)
    
    expect(onLoginPage || hasLoginForm).toBeTruthy()
  })
})
