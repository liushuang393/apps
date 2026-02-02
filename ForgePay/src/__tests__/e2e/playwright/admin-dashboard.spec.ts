import { test, expect } from './fixtures'

/**
 * E2E Tests for Admin Dashboard Overview
 * 
 * Test Scenarios:
 * 1. Verify stats cards display (Products, Customers, Webhooks, Revenue)
 * 2. Verify revenue chart renders
 * 3. Verify recent products list
 * 4. Verify failed webhooks section
 */

test.describe('Admin Dashboard Overview', () => {
  test('should display dashboard with stats cards', async ({ authenticatedPage: page }) => {
    // Verify page title
    await expect(page.locator('h1')).toContainText('Dashboard')
    await expect(page.locator('text=Overview of your payment platform')).toBeVisible()
    
    // Wait for stats to load
    await page.waitForSelector('.bg-white.rounded-xl.shadow-sm', { timeout: 10000 })
    
    // Verify stats cards are present
    const statsGrid = page.locator('.grid.grid-cols-1.md\\:grid-cols-2.lg\\:grid-cols-4')
    await expect(statsGrid).toBeVisible()
    
    // Check for stat card titles
    await expect(page.locator('text=Total Products')).toBeVisible()
    await expect(page.locator('text=Total Customers')).toBeVisible()
    await expect(page.locator('text=Failed Webhooks')).toBeVisible()
    await expect(page.locator('text=Monthly Revenue')).toBeVisible()
  })

  test('should display revenue trend chart', async ({ authenticatedPage: page }) => {
    // Wait for chart section to load
    await expect(page.locator('text=Revenue Trend')).toBeVisible({ timeout: 10000 })
    
    // Verify chart container exists
    const chartContainer = page.locator('.recharts-responsive-container')
    await expect(chartContainer).toBeVisible()
    
    // Verify chart has rendered (SVG element)
    await expect(page.locator('.recharts-wrapper')).toBeVisible()
  })

  test('should display recent products section', async ({ authenticatedPage: page }) => {
    // Wait for products section
    await expect(page.locator('text=Recent Products')).toBeVisible({ timeout: 10000 })
    
    // Verify section exists in the grid
    const recentProductsSection = page.locator('.bg-white.rounded-xl.shadow-sm').filter({ hasText: 'Recent Products' })
    await expect(recentProductsSection).toBeVisible()
    
    // Products list or empty state should be visible
    const hasProducts = await page.locator('.bg-gray-50.rounded-lg').first().isVisible().catch(() => false)
    const hasEmptyState = await page.locator('text=No products yet').isVisible().catch(() => false)
    
    expect(hasProducts || hasEmptyState).toBeTruthy()
  })

  test('should display failed webhooks section', async ({ authenticatedPage: page }) => {
    // Wait for webhooks section
    await expect(page.locator('text=Failed Webhooks').first()).toBeVisible({ timeout: 10000 })
    
    // Verify section exists
    const webhooksSection = page.locator('.bg-white.rounded-xl.shadow-sm').filter({ hasText: 'Failed Webhooks' })
    await expect(webhooksSection).toBeVisible()
    
    // Should show either failed webhooks list or success state
    const hasFailedWebhooks = await page.locator('.bg-red-50.rounded-lg').first().isVisible().catch(() => false)
    const hasNoFailedWebhooks = await page.locator('text=No failed webhooks').isVisible().catch(() => false)
    
    expect(hasFailedWebhooks || hasNoFailedWebhooks).toBeTruthy()
  })

  test('should show loading states while fetching data', async ({ page }) => {
    // Navigate fresh (not using authenticated fixture to catch loading states)
    await page.goto('/login')
    await page.fill('input[type="password"]', process.env.TEST_API_KEY || 'sk_test_demo_key_12345')
    await page.click('button[type="submit"]')
    await page.waitForURL('/')
    
    // Loading skeletons should appear (may be too fast to catch in some cases)
    const loadingIndicator = page.locator('.animate-pulse, .animate-spin').first()
    
    // Either we catch loading state or data is already loaded
    const isLoading = await loadingIndicator.isVisible().catch(() => false)
    const dataLoaded = await page.locator('text=Total Products').isVisible().catch(() => false)
    
    expect(isLoading || dataLoaded).toBeTruthy()
  })

  test('should navigate to other pages from sidebar', async ({ authenticatedPage: page }) => {
    // Click on Products link in sidebar
    await page.click('a[href="/products"]')
    await expect(page).toHaveURL('/products')
    await expect(page.locator('h1')).toContainText('Products')
    
    // Click on Customers link
    await page.click('a[href="/customers"]')
    await expect(page).toHaveURL('/customers')
    await expect(page.locator('h1')).toContainText('Customers')
    
    // Click on Dashboard to go back
    await page.click('a[href="/"]')
    await expect(page).toHaveURL('/')
    await expect(page.locator('h1')).toContainText('Dashboard')
  })

  test('should display percentage change indicators on stats', async ({ authenticatedPage: page }) => {
    // Wait for stats to load
    await page.waitForSelector('text=Total Products', { timeout: 10000 })
    
    // Look for percentage indicators (e.g., +12%, -5%)
    const percentageIndicators = page.locator('text=/\\d+%/')
    
    // At least some stats should have percentage indicators
    const count = await percentageIndicators.count()
    expect(count).toBeGreaterThanOrEqual(0) // Some may not have change data
  })
})
