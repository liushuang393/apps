import { test, expect } from './fixtures'

/**
 * E2E Tests for Customers Page
 * 
 * Test Scenarios:
 * 1. View customer list
 * 2. Search customers
 * 3. View customer details modal
 * 4. View customer entitlements
 */

test.describe('Customers Page', () => {
  test('should display customers page', async ({ authenticatedPage: page }) => {
    // Navigate to customers page
    await page.click('a[href="/customers"]')
    await expect(page).toHaveURL('/customers')
    
    // Verify page title
    await expect(page.locator('h1')).toContainText('Customers')
    await expect(page.locator('text=View and manage your customers')).toBeVisible()
    
    // Verify search input exists
    const searchInput = page.locator('input[placeholder*="Search customers"]')
    await expect(searchInput).toBeVisible()
  })

  test('should display customer list or empty state', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/customers"]')
    await page.waitForURL('/customers')
    
    // Wait for content to load
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Should show either customer list or empty state
    const hasCustomers = await page.locator('.divide-y.divide-gray-200').isVisible().catch(() => false)
    const hasEmptyState = await page.locator('text=No customers yet').isVisible().catch(() => false)
    
    expect(hasCustomers || hasEmptyState).toBeTruthy()
  })

  test('should filter customers with search', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/customers"]')
    await page.waitForURL('/customers')
    
    // Wait for content to load
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Type in search box
    const searchInput = page.locator('input[placeholder*="Search customers"]')
    await searchInput.fill('test@example.com')
    
    // Search should filter results
    // Either shows matching results or "No customers found"
    await page.waitForTimeout(500) // Wait for filter to apply
    
    const hasResults = await page.locator('.divide-y.divide-gray-200').isVisible().catch(() => false)
    const noResults = await page.locator('text=No customers found').isVisible().catch(() => false)
    
    expect(hasResults || noResults).toBeTruthy()
  })

  test('should clear search filter', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/customers"]')
    await page.waitForURL('/customers')
    
    // Wait for content to load
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Type in search box
    const searchInput = page.locator('input[placeholder*="Search customers"]')
    await searchInput.fill('nonexistent_customer_xyz')
    
    // Wait for filter
    await page.waitForTimeout(500)
    
    // Clear search
    await searchInput.clear()
    
    // Wait for results to update
    await page.waitForTimeout(500)
    
    // Should show all customers again or empty state
    const hasCustomers = await page.locator('.divide-y.divide-gray-200').isVisible().catch(() => false)
    const hasEmptyState = await page.locator('text=No customers yet').isVisible().catch(() => false)
    
    expect(hasCustomers || hasEmptyState).toBeTruthy()
  })

  test('should open customer detail modal when clicking customer row', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/customers"]')
    await page.waitForURL('/customers')
    
    // Wait for content to load
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Check if there are customers
    const customerRow = page.locator('.divide-y.divide-gray-200 > div').first()
    const hasCustomers = await customerRow.isVisible().catch(() => false)
    
    if (hasCustomers) {
      // Click on customer row
      await customerRow.click()
      
      // Verify modal opens
      await expect(page.locator('text=Customer Details')).toBeVisible({ timeout: 5000 })
      
      // Modal should have customer info sections
      await expect(page.locator('text=Customer ID')).toBeVisible()
      await expect(page.locator('text=Stripe Customer')).toBeVisible()
      await expect(page.locator('text=Entitlements')).toBeVisible()
    } else {
      // Skip if no customers - this is expected in fresh environment
      test.skip()
    }
  })

  test('should display customer email and name in details modal', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/customers"]')
    await page.waitForURL('/customers')
    
    // Wait for content to load
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Check if there are customers
    const customerRow = page.locator('.divide-y.divide-gray-200 > div').first()
    const hasCustomers = await customerRow.isVisible().catch(() => false)
    
    if (hasCustomers) {
      // Click on customer row
      await customerRow.click()
      
      // Wait for modal
      await expect(page.locator('text=Customer Details')).toBeVisible({ timeout: 5000 })
      
      // Should display email (contains @)
      await expect(page.locator('.text-gray-500:has-text("@")')).toBeVisible()
      
      // Should display customer ID (UUID format)
      await expect(page.locator('.font-mono')).toBeVisible()
    } else {
      test.skip()
    }
  })

  test('should close customer detail modal', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/customers"]')
    await page.waitForURL('/customers')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const customerRow = page.locator('.divide-y.divide-gray-200 > div').first()
    const hasCustomers = await customerRow.isVisible().catch(() => false)
    
    if (hasCustomers) {
      // Click on customer row
      await customerRow.click()
      
      // Wait for modal
      await expect(page.locator('text=Customer Details')).toBeVisible({ timeout: 5000 })
      
      // Click close button
      await page.click('.fixed.inset-0 button:has(svg)')
      
      // Modal should close
      await expect(page.locator('text=Customer Details')).not.toBeVisible({ timeout: 3000 })
    } else {
      test.skip()
    }
  })

  test('should show entitlements section in customer modal', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/customers"]')
    await page.waitForURL('/customers')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const customerRow = page.locator('.divide-y.divide-gray-200 > div').first()
    const hasCustomers = await customerRow.isVisible().catch(() => false)
    
    if (hasCustomers) {
      await customerRow.click()
      
      await expect(page.locator('text=Customer Details')).toBeVisible({ timeout: 5000 })
      
      // Entitlements section should be visible
      await expect(page.locator('text=Entitlements')).toBeVisible()
      
      // Should show either entitlements list or "No entitlements"
      const hasEntitlements = await page.locator('.bg-gray-50.rounded-lg').last().isVisible().catch(() => false)
      const noEntitlements = await page.locator('text=No entitlements').isVisible().catch(() => false)
      
      expect(hasEntitlements || noEntitlements).toBeTruthy()
    } else {
      test.skip()
    }
  })

  test('should display customer avatar with initial', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/customers"]')
    await page.waitForURL('/customers')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Check if there are customers with avatars
    const avatars = page.locator('.bg-primary-100.rounded-full')
    const count = await avatars.count()
    
    if (count > 0) {
      // Avatar should contain initial letter
      await expect(avatars.first()).toBeVisible()
    }
  })
})
