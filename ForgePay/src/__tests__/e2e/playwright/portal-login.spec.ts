import { test, expect } from './fixtures'

/**
 * E2E Tests for Customer Portal Magic Link Login
 * 
 * Test Scenarios:
 * 1. Navigate to portal login page
 * 2. Enter email for magic link
 * 3. Verify success message
 * 4. Test invalid email validation
 * 5. Test empty email validation
 */

test.describe('Customer Portal Magic Link Login', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to portal login
    await page.goto('/customer/login')
  })

  test('should display portal login page correctly', async ({ page }) => {
    // Verify page title and description
    await expect(page.locator('h1')).toContainText('Customer Portal')
    await expect(page.locator('text=Enter your email to receive a magic link')).toBeVisible()
    
    // Verify email input field
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute('placeholder', 'you@example.com')
    
    // Verify submit button
    const submitButton = page.locator('button[type="submit"]')
    await expect(submitButton).toBeVisible()
    await expect(submitButton).toContainText('Send Magic Link')
    
    // Verify help text
    await expect(page.locator('text=No password required')).toBeVisible()
  })

  test('should display mail icon', async ({ page }) => {
    // Verify mail icon is displayed
    const iconContainer = page.locator('.bg-primary-100.rounded-full')
    await expect(iconContainer).toBeVisible()
  })

  test('should send magic link for valid email', async ({ page }) => {
    const testEmail = `test_${Date.now()}@example.com`
    
    // Fill in email
    await page.fill('input[type="email"]', testEmail)
    
    // Click submit button
    await page.click('button[type="submit"]')
    
    // Wait for success state
    await expect(page.locator('text=Check your email')).toBeVisible({ timeout: 10000 })
    
    // Verify success message shows email
    await expect(page.locator(`text=${testEmail}`)).toBeVisible()
    
    // Verify success description
    await expect(page.locator('text=Click the link in the email to access your portal')).toBeVisible()
    await expect(page.locator('text=The link expires in 15 minutes')).toBeVisible()
    
    // Verify "Use different email" button
    await expect(page.locator('text=Use a different email')).toBeVisible()
  })

  test('should show success icon after sending magic link', async ({ page }) => {
    await page.fill('input[type="email"]', `test_${Date.now()}@example.com`)
    await page.click('button[type="submit"]')
    
    // Wait for success state
    await expect(page.locator('text=Check your email')).toBeVisible({ timeout: 10000 })
    
    // Success icon should be green
    const successIcon = page.locator('.bg-green-100.rounded-full')
    await expect(successIcon).toBeVisible()
  })

  test('should allow using different email after success', async ({ page }) => {
    await page.fill('input[type="email"]', `test_${Date.now()}@example.com`)
    await page.click('button[type="submit"]')
    
    // Wait for success state
    await expect(page.locator('text=Check your email')).toBeVisible({ timeout: 10000 })
    
    // Click "Use a different email"
    await page.click('text=Use a different email')
    
    // Should go back to email form
    await expect(page.locator('h1')).toContainText('Customer Portal')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="email"]')).toHaveValue('')
  })

  test('should show loading state while sending', async ({ page }) => {
    await page.fill('input[type="email"]', `test_${Date.now()}@example.com`)
    
    // Click submit button
    await page.click('button[type="submit"]')
    
    // Button should show loading state
    const button = page.locator('button[type="submit"]')
    
    // Either shows loading or already transitioned to success
    const isLoading = await button.textContent() === 'Sending...'
    const isSuccess = await page.locator('text=Check your email').isVisible()
    
    expect(isLoading || isSuccess).toBeTruthy()
  })

  test('should show error for invalid email format', async ({ page }) => {
    // Fill in invalid email
    await page.fill('input[type="email"]', 'not-a-valid-email')
    
    // Try to submit
    await page.click('button[type="submit"]')
    
    // Browser should prevent submission with invalid email
    const emailInput = page.locator('input[type="email"]')
    
    // Check for HTML5 validation
    const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid)
    expect(validity).toBe(false)
  })

  test('should require email field', async ({ page }) => {
    // Try to submit with empty email
    await page.click('button[type="submit"]')
    
    // Browser should prevent submission
    const emailInput = page.locator('input[type="email"]')
    
    // Check for required attribute
    await expect(emailInput).toHaveAttribute('required', '')
    
    // Check validity
    const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid)
    expect(validity).toBe(false)
  })

  test('should disable button while sending', async ({ page }) => {
    await page.fill('input[type="email"]', `test_${Date.now()}@example.com`)
    
    // Click submit
    await page.click('button[type="submit"]')
    
    // Button should be disabled during sending
    const button = page.locator('button[type="submit"]')
    
    // Either disabled during loading or success page is shown
    const isDisabled = await button.isDisabled()
    const isSuccess = await page.locator('text=Check your email').isVisible()
    
    expect(isDisabled || isSuccess).toBeTruthy()
  })

  test('should handle network error gracefully', async ({ page }) => {
    // Simulate network error
    await page.route('**/api/v1/portal/auth/magic-link', route => {
      route.abort('failed')
    })
    
    await page.fill('input[type="email"]', `test_${Date.now()}@example.com`)
    await page.click('button[type="submit"]')
    
    // Should show error message
    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.text-red-600')).toContainText(/Network error|Please try again/)
  })

  test('should handle API error gracefully', async ({ page }) => {
    // Simulate API error
    await page.route('**/api/v1/portal/auth/magic-link', route => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Customer not found' }),
      })
    })
    
    await page.fill('input[type="email"]', `nonexistent_${Date.now()}@example.com`)
    await page.click('button[type="submit"]')
    
    // Should show error message
    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.text-red-600')).toContainText(/Customer not found|Failed to send/)
  })
})
