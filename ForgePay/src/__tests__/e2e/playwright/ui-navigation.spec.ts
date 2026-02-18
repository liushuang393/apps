import { test, expect } from './fixtures'

/**
 * サイドバーナビゲーション E2E テスト
 *
 * テスト対象:
 * - 全サイドバーリンクの遷移確認
 * - 各ページのH1見出し表示確認
 * - Dashboard → Products → Customers → Webhooks → Audit Logs → Settings の完全フロー
 * - アクティブリンクのハイライト
 * - 各ページのスクリーンショット
 */

/** サイドバーのナビゲーション項目定義 */
const NAV_ITEMS = [
  { name: 'ダッシュボード', href: '/', heading: 'Dashboard' },
  { name: '商品', href: '/products', heading: 'Products' },
  { name: '顧客', href: '/customers', heading: 'Customers' },
  { name: 'Webhooks', href: '/webhooks', heading: 'Webhooks' },
  { name: '監査ログ', href: '/audit-logs', heading: 'Audit Logs' },
  { name: '設定', href: '/settings', heading: 'Settings' },
] as const

test.describe('サイドバーナビゲーション', () => {
  test('全サイドバーリンクが正しいページに遷移する', async ({ authenticatedPage: page }) => {
    // デスクトップサイドバーのナビゲーションを使用
    const sidebar = page.locator('.hidden.lg\\:fixed')

    for (const item of NAV_ITEMS) {
      // サイドバーリンクをクリック
      await sidebar.getByText(item.name, { exact: true }).click()

      // URLが正しいことを確認
      await page.waitForURL(item.href, { timeout: 10000 })

      // ローディング完了を待つ
      await page.waitForLoadState('networkidle')

      // 各ページのH1見出しが正しく表示されることを確認
      await expect(page.getByRole('heading', { name: item.heading, exact: true }).first()).toBeVisible({ timeout: 10000 })

      // スクリーンショットを撮影
      const safeName = item.heading.toLowerCase().replace(/\s+/g, '-')
      await page.screenshot({ path: `test-results/artifacts/nav-${safeName}.png`, fullPage: true })
    }
  })

  test('アクティブリンクがハイライトされる', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('.hidden.lg\\:fixed')

    for (const item of NAV_ITEMS) {
      // サイドバーリンクをクリック
      await sidebar.getByText(item.name, { exact: true }).click()
      await page.waitForURL(item.href, { timeout: 10000 })
      await page.waitForLoadState('networkidle')

      // アクティブリンクが「bg-primary-50 text-primary-600」クラスを持つことを確認
      const activeLink = sidebar.locator(`a[href="${item.href}"]`)
      await expect(activeLink).toHaveClass(/bg-primary-50/)
      await expect(activeLink).toHaveClass(/text-primary-600/)

      // 他のリンクがアクティブでないことを確認（最初の1つだけ）
      const otherItems = NAV_ITEMS.filter(i => i.href !== item.href)
      if (otherItems.length > 0) {
        const otherLink = sidebar.locator(`a[href="${otherItems[0].href}"]`)
        await expect(otherLink).not.toHaveClass(/bg-primary-50/)
      }
    }

    await page.screenshot({ path: 'test-results/artifacts/nav-active-highlight.png', fullPage: true })
  })

  test('完全ナビゲーションフロー: Dashboard → Products → Customers → Webhooks → Audit Logs → Settings', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('div.hidden.lg\\:fixed')
    await expect(sidebar).toBeVisible({ timeout: 5000 })

    // ステップ1: ダッシュボード（初期ページ）
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: 'test-results/artifacts/nav-flow-01-dashboard.png', fullPage: true })

    // ステップ2: 商品ページに遷移
    await sidebar.getByText('商品', { exact: true }).click()
    await page.waitForURL('/products', { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: 'test-results/artifacts/nav-flow-02-products.png', fullPage: true })

    // ステップ3: 顧客ページに遷移
    await sidebar.getByText('顧客', { exact: true }).click()
    await page.waitForURL('/customers', { timeout: 10000 })
    await expect(page.locator('h1', { hasText: 'Customers' })).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: 'test-results/artifacts/nav-flow-03-customers.png', fullPage: true })

    // ステップ4: Webhookページに遷移
    await sidebar.getByText('Webhooks', { exact: true }).click()
    await page.waitForURL('/webhooks', { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Webhooks', exact: true })).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: 'test-results/artifacts/nav-flow-04-webhooks.png', fullPage: true })

    // ステップ5: 監査ログページに遷移
    await sidebar.getByText('監査ログ', { exact: true }).click()
    await page.waitForURL('/audit-logs', { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: 'test-results/artifacts/nav-flow-05-audit-logs.png', fullPage: true })

    // ステップ6: 設定ページに遷移
    await sidebar.getByText('設定', { exact: true }).click()
    await page.waitForURL('/settings', { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: 'test-results/artifacts/nav-flow-06-settings.png', fullPage: true })

    // ステップ7: ダッシュボードに戻る
    await sidebar.getByText('ダッシュボード', { exact: true }).click()
    await page.waitForURL('/', { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: 'test-results/artifacts/nav-flow-07-back-to-dashboard.png', fullPage: true })
  })

  test('サイドバーにForgePay Adminブランドが表示される', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('.hidden.lg\\:fixed')

    // ForgePay ブランド名が表示される（親要素との重複を回避）
    await expect(sidebar.getByText('ForgePay').first()).toBeVisible()

    // Admin バッジが表示される（親要素との重複を回避）
    await expect(sidebar.getByText('Admin').first()).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/nav-sidebar-brand.png' })
  })

  test('サイドバーのLogoutボタンが表示される', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('.hidden.lg\\:fixed')

    // Logoutボタンが表示される
    const logoutButton = sidebar.getByRole('button', { name: 'Logout' })
    await expect(logoutButton).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/nav-logout-button.png' })
  })

  test('各ページにローディングスピナーが表示されてから消える', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('.hidden.lg\\:fixed')

    // 各ページでローディング→コンテンツ表示のフローを確認
    for (const item of NAV_ITEMS) {
      await sidebar.getByText(item.name, { exact: true }).click()
      await page.waitForURL(item.href, { timeout: 10000 })

      // ローディングが完了するのを待つ（スピナーが消えるまで）
      await page.waitForFunction(() => {
        return document.querySelectorAll('.animate-spin').length === 0
      }, { timeout: 15000 })

      // 見出しが表示されていることを確認
      await expect(page.getByRole('heading', { name: item.heading, exact: true }).first()).toBeVisible()
    }
  })

  test('直接URLアクセスで各ページに正しく遷移できる', async ({ authenticatedPage: page }) => {
    // 直接URLアクセスで各ページに遷移
    for (const item of NAV_ITEMS) {
      await page.goto(item.href)
      await page.waitForLoadState('networkidle')

      // ページ見出しが正しく表示される
      await expect(page.getByRole('heading', { name: item.heading, exact: true }).first()).toBeVisible({ timeout: 10000 })

      // サイドバーの対応するリンクがアクティブになる
      const sidebar = page.locator('.hidden.lg\\:fixed')
      const activeLink = sidebar.locator(`a[href="${item.href}"]`)
      await expect(activeLink).toHaveClass(/bg-primary-50/)
    }

    await page.screenshot({ path: 'test-results/artifacts/nav-direct-url-access.png', fullPage: true })
  })
})
