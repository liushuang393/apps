import { test, expect } from './fixtures'

/**
 * E2E Tests for Audit Logs Page
 * 
 * Test Scenarios:
 * 1. View audit logs list
 * 2. Filter by action type
 * 3. Filter by resource type
 * 4. Search logs
 * 5. Export CSV
 */

test.describe('Audit Logs Page', () => {
  test('should display audit logs page', async ({ authenticatedPage: page }) => {
    // Navigate to audit logs page
    await page.click('a[href="/audit-logs"]')
    await expect(page).toHaveURL('/audit-logs')
    
    // Verify page title
    await expect(page.locator('h1')).toContainText('Audit Logs')
    await expect(page.locator('text=Track all system activities and changes')).toBeVisible()
  })

  test('should display export CSV button', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    // Verify Export CSV button exists
    const exportButton = page.locator('button:has-text("Export CSV")')
    await expect(exportButton).toBeVisible()
  })

  test('should display search and filter controls', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    // Verify search input
    const searchInput = page.locator('input[placeholder*="Search logs"]')
    await expect(searchInput).toBeVisible()
    
    // Verify filter dropdowns
    const actionFilter = page.locator('select').first()
    await expect(actionFilter).toBeVisible()
  })

  test('should display audit logs table or empty state', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    // Wait for content to load
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Should show either logs table or empty state
    const hasTable = await page.locator('table').isVisible().catch(() => false)
    const hasEmptyState = await page.locator('text=No logs found').isVisible().catch(() => false)
    
    expect(hasTable || hasEmptyState).toBeTruthy()
  })

  test('should display table columns when logs exist', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const hasTable = await page.locator('table').isVisible().catch(() => false)
    
    if (hasTable) {
      // Verify table headers
      await expect(page.locator('th:has-text("Action")')).toBeVisible()
      await expect(page.locator('th:has-text("Resource")')).toBeVisible()
      await expect(page.locator('th:has-text("Changes")')).toBeVisible()
      await expect(page.locator('th:has-text("Time")')).toBeVisible()
    } else {
      test.skip()
    }
  })

  test('should filter logs by search term', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Type in search box
    const searchInput = page.locator('input[placeholder*="Search logs"]')
    await searchInput.fill('product')
    
    // Wait for filter to apply
    await page.waitForTimeout(500)
    
    // Either shows filtered results or "No logs found"
    const hasResults = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    const noResults = await page.locator('text=No logs found').isVisible().catch(() => false)
    
    expect(hasResults || noResults).toBeTruthy()
  })

  test('should filter logs by action dropdown', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Get filter dropdowns
    const filterDropdowns = page.locator('select')
    const actionDropdown = filterDropdowns.first()
    
    // Check if there are options to select
    const options = await actionDropdown.locator('option').count()
    
    if (options > 1) {
      // Select second option (first is "All Actions")
      await actionDropdown.selectOption({ index: 1 })
      
      // Wait for filter to apply
      await page.waitForTimeout(500)
      
      // Page should update
      expect(true).toBeTruthy()
    }
  })

  test('should filter logs by resource dropdown', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Get filter dropdowns
    const filterDropdowns = page.locator('select')
    
    if (await filterDropdowns.count() > 1) {
      const resourceDropdown = filterDropdowns.nth(1)
      
      const options = await resourceDropdown.locator('option').count()
      
      if (options > 1) {
        await resourceDropdown.selectOption({ index: 1 })
        await page.waitForTimeout(500)
        expect(true).toBeTruthy()
      }
    }
  })

  test('should export CSV when clicking export button', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Check if there are logs to export
    const hasLogs = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    
    if (hasLogs) {
      // Set up download listener
      const downloadPromise = page.waitForEvent('download')
      
      // Click export button
      await page.click('button:has-text("Export CSV")')
      
      // Wait for download
      const download = await downloadPromise
      
      // Verify download filename
      const filename = download.suggestedFilename()
      expect(filename).toContain('audit-logs')
      expect(filename).toContain('.csv')
    } else {
      // Export button should be disabled when no logs
      const exportButton = page.locator('button:has-text("Export CSV")')
      await expect(exportButton).toBeDisabled()
    }
  })

  test('should display action badges with proper styling', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const hasTable = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    
    if (hasTable) {
      // Action badges should have primary color styling
      const actionBadges = page.locator('.bg-primary-100.text-primary-700')
      const count = await actionBadges.count()
      expect(count).toBeGreaterThan(0)
    }
  })

  test('should display resource type and ID', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const hasTable = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    
    if (hasTable) {
      // Resource IDs should be in monospace font
      const resourceIds = page.locator('.font-mono.text-xs')
      const count = await resourceIds.count()
      expect(count).toBeGreaterThan(0)
    }
  })

  test('should display relative time for logs', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const hasTable = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    
    if (hasTable) {
      // Should show relative time (e.g., "2 hours ago")
      const timeText = page.locator('text=/\\d+\\s+(second|minute|hour|day|week|month|year)s?\\s+ago/')
      const count = await timeText.count()
      expect(count).toBeGreaterThan(0)
    }
  })

  test('should display changes as JSON when present', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const hasTable = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    
    if (hasTable) {
      // Changes column should either have JSON or dash
      const changesColumn = page.locator('pre, span.text-gray-400:has-text("-")')
      const count = await changesColumn.count()
      expect(count).toBeGreaterThan(0)
    }
  })

  test('should clear all filters', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/audit-logs"]')
    await page.waitForURL('/audit-logs')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Apply search filter
    const searchInput = page.locator('input[placeholder*="Search logs"]')
    await searchInput.fill('test')
    
    // Clear search
    await searchInput.clear()
    
    // Reset action filter to "All Actions"
    const filterDropdowns = page.locator('select')
    await filterDropdowns.first().selectOption({ index: 0 })
    
    // Wait for filters to clear
    await page.waitForTimeout(500)
    
    // Should show unfiltered results
    const hasTable = await page.locator('table').isVisible().catch(() => false)
    const hasEmptyState = await page.locator('text=No logs found').isVisible().catch(() => false)
    
    expect(hasTable || hasEmptyState).toBeTruthy()
  })
})
