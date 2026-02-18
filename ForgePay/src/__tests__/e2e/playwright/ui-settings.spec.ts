import { test, expect } from './fixtures'

/**
 * 設定ページ E2E テスト
 *
 * テスト対象:
 * - ページ見出しと説明文
 * - Stripe API Keys セクション（「Not configured」バッジ）
 * - Secret Key, Publishable Key, Webhook Signing Secret 入力欄
 * - Company Info セクション
 * - Redirect URLs セクション（Success URL, Cancel URL）
 * - Payment Methods チェックボックス（Credit Card, Convenience Store, Bank Transfer, Stripe Link）
 * - Locale & Currency ドロップダウン
 * - Callback URL 入力欄
 * - Save Settings ボタン
 */
test.describe('設定ページ', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // 設定ページに遷移
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // ローディングスピナーが消えるのを待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })
  })

  test('設定ページの見出しと説明文が表示される', async ({ authenticatedPage: page }) => {
    // 見出し「Settings」が表示される
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

    // 説明テキストが表示される（親要素との重複を回避）
    await expect(page.getByText('Configure defaults for your payment links').first()).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/settings-page-header.png' })
  })

  test('Stripe API Keysセクションが表示される', async ({ authenticatedPage: page }) => {
    // 「Stripe API Keys」見出しが表示される
    const stripeSection = page.locator('section').filter({ hasText: 'Stripe API Keys' }).first()
    await expect(stripeSection).toBeVisible({ timeout: 10000 })

    // 「Not configured」または「Connected」バッジが表示される
    const badgeText = await stripeSection.locator('span').filter({ hasText: /Not configured|Connected/ }).first().textContent().catch(() => '')
    expect(badgeText).toBeTruthy()

    // Secret Key入力欄が表示される
    await expect(stripeSection.locator('label', { hasText: 'Secret Key' })).toBeVisible()

    // Publishable Key入力欄が表示される
    await expect(stripeSection.locator('label', { hasText: 'Publishable Key' })).toBeVisible()

    // Webhook Signing Secret入力欄が表示される
    await expect(stripeSection.locator('label', { hasText: 'Webhook Signing Secret' })).toBeVisible()

    // Stripe Dashboard へのリンクが表示される
    await expect(stripeSection.getByRole('link', { name: 'Stripe Dashboard' })).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/settings-stripe-keys-section.png' })
  })

  test('Stripe APIキー入力欄のプレースホルダーが正しい', async ({ authenticatedPage: page }) => {
    const stripeSection = page.locator('section').filter({ hasText: 'Stripe API Keys' }).first()
    await expect(stripeSection).toBeVisible({ timeout: 10000 })

    // Secret Keyのプレースホルダー
    const secretKeyInput = stripeSection.locator('input[type="password"]').first()
    const placeholder = await secretKeyInput.getAttribute('placeholder')
    expect(placeholder).toMatch(/sk_test_|sk_live_|••/)

    // Publishable Keyのプレースホルダー
    const pubKeyInput = stripeSection.locator('input[type="text"]').first()
    const pubPlaceholder = await pubKeyInput.getAttribute('placeholder')
    expect(pubPlaceholder).toMatch(/pk_test_|pk_live_/)

    // Webhook Signing Secretのプレースホルダー
    const webhookInput = stripeSection.locator('input[placeholder="whsec_..."]')
    await expect(webhookInput).toBeVisible()
  })

  test('Company Infoセクションが表示される', async ({ authenticatedPage: page }) => {
    // Company Infoセクションまでスクロール
    const companySection = page.locator('section').filter({ hasText: 'Company Info' }).first()
    await companySection.scrollIntoViewIfNeeded()
    await expect(companySection).toBeVisible({ timeout: 10000 })

    // Company / Service Name 入力欄が表示される
    await expect(companySection.locator('label', { hasText: 'Company / Service Name' })).toBeVisible()
    await expect(companySection.getByPlaceholder('Your Company Name')).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/settings-company-info.png' })
  })

  test('Redirect URLsセクションが表示される', async ({ authenticatedPage: page }) => {
    // Redirect URLsセクションまでスクロール
    const redirectSection = page.locator('section').filter({ hasText: 'Redirect URLs' }).first()
    await redirectSection.scrollIntoViewIfNeeded()
    await expect(redirectSection).toBeVisible({ timeout: 10000 })

    // Success URL 入力欄が表示される
    await expect(redirectSection.locator('label', { hasText: 'Success URL' })).toBeVisible()
    await expect(redirectSection.getByPlaceholder('https://your-app.com/payment/success')).toBeVisible()

    // Cancel URL 入力欄が表示される
    await expect(redirectSection.locator('label', { hasText: 'Cancel URL' })).toBeVisible()
    await expect(redirectSection.getByPlaceholder('https://your-app.com/payment/cancel')).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/settings-redirect-urls.png' })
  })

  test('Payment Methodsセクションのチェックボックスが表示される', async ({ authenticatedPage: page }) => {
    // 「Payment Methods」見出しが表示される
    await expect(page.getByRole('heading', { name: 'Payment Methods' })).toBeVisible()

    // 説明テキスト（親要素との重複を回避）
    await expect(page.getByText('Select which payment methods are available').first()).toBeVisible()

    // 4つの決済方法チェックボックスが表示される（label と内部 div の重複を回避）
    await expect(page.getByText('Credit Card').first()).toBeVisible()
    await expect(page.getByText('Visa, Mastercard, AMEX').first()).toBeVisible()

    await expect(page.getByText('Convenience Store').first()).toBeVisible()
    await expect(page.getByText('Japan (7-Eleven, Lawson, FamilyMart)').first()).toBeVisible()

    await expect(page.getByText('Bank Transfer').first()).toBeVisible()
    await expect(page.getByText('Direct bank payment').first()).toBeVisible()

    await expect(page.getByText('Stripe Link').first()).toBeVisible()
    await expect(page.getByText('One-click checkout').first()).toBeVisible()

    // チェックボックスが存在する（4つ）
    const checkboxes = page.locator('input[type="checkbox"]')
    const count = await checkboxes.count()
    expect(count).toBe(4)

    await page.screenshot({ path: 'test-results/artifacts/settings-payment-methods.png' })
  })

  test('Locale & Currencyセクションのドロップダウンが表示される', async ({ authenticatedPage: page }) => {
    // Locale & Currencyセクションまでスクロール
    const localeSection = page.locator('section').filter({ hasText: 'Locale & Currency' }).first()
    await localeSection.scrollIntoViewIfNeeded()
    await expect(localeSection).toBeVisible({ timeout: 10000 })

    // Default Language ドロップダウンが表示される
    const langSelect = localeSection.locator('select').first()
    await expect(langSelect).toBeVisible()

    // 言語オプションが含まれることを確認
    const langOptions = await langSelect.locator('option').allTextContents()
    expect(langOptions).toContain('Auto-detect')
    expect(langOptions).toContain('Japanese')
    expect(langOptions).toContain('English')

    // Default Currency ドロップダウンが表示される
    const currencySelect = localeSection.locator('select').nth(1)
    await expect(currencySelect).toBeVisible()

    // 通貨オプションが含まれることを確認
    const currencyOptions = await currencySelect.locator('option').allTextContents()
    expect(currencyOptions).toContain('USD - US Dollar')
    expect(currencyOptions).toContain('JPY - Japanese Yen')
    expect(currencyOptions).toContain('EUR - Euro')

    await page.screenshot({ path: 'test-results/artifacts/settings-locale-currency.png' })
  })

  test('Callback URLセクションが表示される', async ({ authenticatedPage: page }) => {
    // Payment Notificationsセクションまでスクロール
    const callbackSection = page.locator('section').filter({ hasText: 'Payment Notifications' }).first()
    await callbackSection.scrollIntoViewIfNeeded()
    await expect(callbackSection).toBeVisible({ timeout: 10000 })

    // Callback URL入力欄が表示される
    await expect(callbackSection.locator('label', { hasText: 'Callback URL' })).toBeVisible()
    await expect(callbackSection.getByPlaceholder('https://your-app.com/api/payment-webhook')).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/settings-callback-url.png' })
  })

  test('Save Settingsボタンが表示される', async ({ authenticatedPage: page }) => {
    // 「Save Settings」ボタンが表示される
    const saveButton = page.getByRole('button', { name: 'Save Settings' })
    await expect(saveButton).toBeVisible()
    await expect(saveButton).toBeEnabled()

    await page.screenshot({ path: 'test-results/artifacts/settings-save-button.png' })
  })

  test('設定フォームに値を入力して保存できる', async ({ authenticatedPage: page }) => {
    // Company Infoセクションの入力
    const companySection = page.locator('section').filter({ hasText: 'Company Info' }).first()
    await companySection.scrollIntoViewIfNeeded()
    await companySection.getByPlaceholder('Your Company Name').fill(`E2E テスト会社 ${Date.now()}`)

    // Redirect URLsセクションの入力
    const redirectSection = page.locator('section').filter({ hasText: 'Redirect URLs' }).first()
    await redirectSection.scrollIntoViewIfNeeded()
    await redirectSection.getByPlaceholder('https://your-app.com/payment/success').fill('https://example.com/success')
    await redirectSection.getByPlaceholder('https://your-app.com/payment/cancel').fill('https://example.com/cancel')

    // Callback URLセクションの入力
    const callbackSection = page.locator('section').filter({ hasText: 'Payment Notifications' }).first()
    await callbackSection.scrollIntoViewIfNeeded()
    await callbackSection.getByPlaceholder('https://your-app.com/api/payment-webhook').fill('https://example.com/webhook')

    // Locale & Currencyセクション
    const localeSection = page.locator('section').filter({ hasText: 'Locale & Currency' }).first()
    await localeSection.scrollIntoViewIfNeeded()
    await localeSection.locator('select').nth(1).selectOption('jpy')
    await localeSection.locator('select').first().selectOption('ja')

    await page.screenshot({ path: 'test-results/artifacts/settings-form-filled.png', fullPage: true })

    // Save Settingsボタンをクリック
    const saveButton = page.getByRole('button', { name: 'Save Settings' })
    await saveButton.scrollIntoViewIfNeeded()
    await saveButton.click()

    // 保存成功後に「Saved!」が表示される
    await expect(page.getByRole('button', { name: /Saved!/ })).toBeVisible({ timeout: 15000 })

    await page.screenshot({ path: 'test-results/artifacts/settings-saved-success.png', fullPage: true })
  })

  test('Payment Methodsチェックボックスの切り替えが動作する', async ({ authenticatedPage: page }) => {
    // Credit Cardチェックボックスの初期状態を確認
    const cardCheckbox = page.locator('input[type="checkbox"]').first()
    const isCardChecked = await cardCheckbox.isChecked()

    // チェックボックスをトグル
    await cardCheckbox.click()

    // 状態が変わったことを確認
    if (isCardChecked) {
      await expect(cardCheckbox).not.toBeChecked()
    } else {
      await expect(cardCheckbox).toBeChecked()
    }

    // 元に戻す
    await cardCheckbox.click()

    await page.screenshot({ path: 'test-results/artifacts/settings-payment-method-toggle.png' })
  })

  test('設定ページのフルページスクリーンショット', async ({ authenticatedPage: page }) => {
    await page.screenshot({ path: 'test-results/artifacts/settings-full-page.png', fullPage: true })
  })
})
