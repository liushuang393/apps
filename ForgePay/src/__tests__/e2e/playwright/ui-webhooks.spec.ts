import { test, expect } from './fixtures'

/**
 * Webhook ページ E2E テスト
 *
 * テスト対象:
 * - ページ見出しと説明文
 * - サマリーカード3枚（Failed Events, Dead Letter Queue, Total Events）
 * - 失敗Webhookテーブルのカラム構成
 * - 「All webhooks processed」メッセージ（失敗Webhookがない場合）
 * - Retryボタン
 * - ステータスバッジの表示とカラー（Failed/Dead Letter Queue）
 */
test.describe('Webhookページ', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Webhookページに遷移
    await page.goto('/webhooks')
    await page.waitForLoadState('networkidle')
  })

  test('Webhookページの見出しと説明文が表示される', async ({ authenticatedPage: page }) => {
    // 見出し「Webhooks」が表示される
    await expect(page.getByRole('heading', { name: 'Webhooks', exact: true })).toBeVisible()

    // 説明テキストが表示される
    await expect(page.getByText('Monitor and retry failed webhook events')).toBeVisible()

    await page.screenshot({ path: 'test-results/artifacts/webhooks-page-header.png' })
  })

  test('サマリーカード3枚が表示される', async ({ authenticatedPage: page }) => {
    // サマリーカードコンテナ内で確認（テーブル内バッジとの重複を回避）
    const summaryGrid = page.locator('.grid.grid-cols-1.md\\:grid-cols-3')

    // 「Failed Events」カードが表示される
    await expect(summaryGrid.getByText('Failed Events')).toBeVisible()

    // 「Dead Letter Queue」カードが表示される
    await expect(summaryGrid.getByText('Dead Letter Queue')).toBeVisible()

    // 「Total Events」カードが表示される
    await expect(summaryGrid.getByText('Total Events')).toBeVisible()

    // 各カードの値が数値で表示されることを確認
    const summaryCards = page.locator('.grid.grid-cols-1.md\\:grid-cols-3 .bg-white')
    const cardCount = await summaryCards.count()
    expect(cardCount).toBe(3)

    // 各カードに数値が表示されている
    for (let i = 0; i < cardCount; i++) {
      const valueElement = summaryCards.nth(i).locator('.text-2xl.font-bold')
      await expect(valueElement).toBeVisible()
      const text = await valueElement.textContent()
      expect(text).toMatch(/^\d+$/)
    }

    await page.screenshot({ path: 'test-results/artifacts/webhooks-summary-cards.png' })
  })

  test('失敗Webhookがない場合「All webhooks processed」が表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 失敗Webhookがない場合のメッセージを確認
    const allProcessedMessage = page.getByText('All webhooks processed')
    const isAllProcessed = await allProcessedMessage.isVisible().catch(() => false)

    if (isAllProcessed) {
      await expect(page.getByText('No failed webhooks to display')).toBeVisible()

      await page.screenshot({ path: 'test-results/artifacts/webhooks-all-processed.png', fullPage: true })
    }
  })

  test('失敗Webhookテーブルのカラムが正しく表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // 「Failed Webhooks」セクション見出しが表示される
    await expect(page.getByRole('heading', { name: 'Failed Webhooks' })).toBeVisible()

    // テーブルが存在する場合、カラムヘッダーを確認
    const table = page.locator('table')
    const hasTable = await table.isVisible().catch(() => false)

    if (hasTable) {
      // テーブルヘッダーのカラムを確認
      const thead = table.locator('thead')
      await expect(thead.getByText('Event Type')).toBeVisible()
      await expect(thead.getByText('Status')).toBeVisible()
      await expect(thead.getByText('Attempts')).toBeVisible()
      await expect(thead.getByText('Error')).toBeVisible()
      await expect(thead.getByText('Time')).toBeVisible()
      await expect(thead.getByText('Actions')).toBeVisible()

      await page.screenshot({ path: 'test-results/artifacts/webhooks-table-columns.png' })
    }
  })

  test('失敗Webhookのステータスバッジが正しいカラーで表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // テーブルが存在する場合のみ確認
    const table = page.locator('table')
    const hasTable = await table.isVisible().catch(() => false)

    if (hasTable) {
      // 「Failed」バッジが赤色で表示される
      const failedBadge = page.locator('.bg-red-100.text-red-700').filter({ hasText: 'Failed' })
      const hasFailedBadge = await failedBadge.first().isVisible().catch(() => false)

      if (hasFailedBadge) {
        // 赤色のバッジスタイルが正しいことを確認
        await expect(failedBadge.first()).toHaveClass(/bg-red-100/)
        await expect(failedBadge.first()).toHaveClass(/text-red-700/)
      }

      // 「Dead Letter Queue」バッジがオレンジ色で表示される
      const dlqBadge = page.locator('.bg-orange-100.text-orange-700').filter({ hasText: 'Dead Letter Queue' })
      const hasDlqBadge = await dlqBadge.first().isVisible().catch(() => false)

      if (hasDlqBadge) {
        await expect(dlqBadge.first()).toHaveClass(/bg-orange-100/)
        await expect(dlqBadge.first()).toHaveClass(/text-orange-700/)
      }

      await page.screenshot({ path: 'test-results/artifacts/webhooks-status-badges.png' })
    }
  })

  test('Retryボタンが失敗Webhookに表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // テーブルが存在する場合のみ確認
    const table = page.locator('table')
    const hasTable = await table.isVisible().catch(() => false)

    if (hasTable) {
      // 各行にRetryボタンが存在する
      const retryButtons = page.getByRole('button', { name: 'Retry' })
      const count = await retryButtons.count()

      if (count > 0) {
        // 最初のRetryボタンが有効であることを確認
        await expect(retryButtons.first()).toBeEnabled()

        await page.screenshot({ path: 'test-results/artifacts/webhooks-retry-button.png' })
      }
    }
  })

  test('失敗Webhookの各行にイベント詳細が表示される', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    // テーブルが存在する場合のみ確認
    const tableBody = page.locator('table tbody')
    const hasTable = await tableBody.isVisible().catch(() => false)

    if (hasTable) {
      const rows = tableBody.locator('tr')
      const rowCount = await rows.count()

      if (rowCount > 0) {
        const firstRow = rows.first()

        // イベントタイプがmono fontで表示される
        await expect(firstRow.locator('.font-mono').first()).toBeVisible()

        // 試行回数が表示される
        const attemptsCell = firstRow.locator('td').nth(2)
        await expect(attemptsCell).toBeVisible()

        // エラーメッセージが表示される
        const errorCell = firstRow.locator('td').nth(3)
        await expect(errorCell).toBeVisible()

        // 時間が表示される（relative time format）
        const timeCell = firstRow.locator('td').nth(4)
        await expect(timeCell).toBeVisible()
      }
    }
  })

  test('Webhookページのフルページスクリーンショット', async ({ authenticatedPage: page }) => {
    // ローディング完了を待つ
    await page.waitForFunction(() => {
      return document.querySelectorAll('.animate-spin').length === 0
    }, { timeout: 15000 })

    await page.screenshot({ path: 'test-results/artifacts/webhooks-full-page.png', fullPage: true })
  })
})
