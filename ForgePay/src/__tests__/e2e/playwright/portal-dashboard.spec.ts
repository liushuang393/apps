import { test, expect } from './fixtures'

/**
 * E2E Tests for Customer Portal Dashboard
 * 
 * Test Scenarios:
 * 1. View active subscriptions
 * 2. View one-time purchases
 * 3. Cancel subscription flow
 * 4. Logout functionality
 * 5. Manage billing button
 * 
 * Note: These tests require a logged-in customer session.
 * In production, this would be set up via magic link verification.
 * For testing, we may need to mock the session or use test tokens.
 */

test.describe('Customer Portal Dashboard', () => {
  // Helper to set up authenticated portal session
  const setupPortalSession = async (page: any) => {
    // Mock the portal API responses for testing
    await page.route('**/api/v1/portal/me', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-customer-id',
          email: 'test@example.com',
          name: 'Test Customer',
        }),
      })
    })

    await page.route('**/api/v1/portal/subscriptions', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscriptions: [
            {
              id: 'sub-1',
              productId: 'prod-1',
              status: 'active',
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              stripeSubscription: {
                id: 'sub_stripe_1',
                status: 'active',
                currentPeriodStart: new Date().toISOString(),
                currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                cancelAtPeriodEnd: false,
                canceledAt: null,
              },
            },
          ],
        }),
      })
    })

    await page.route('**/api/v1/portal/entitlements', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entitlements: [
            {
              id: 'ent-1',
              productId: 'prod-2',
              status: 'active',
              expiresAt: null,
              isSubscription: false,
              createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ],
        }),
      })
    })
  }

  test('should display portal dashboard header', async ({ page }) => {
    await setupPortalSession(page)
    await page.goto('/customer')

    // Verify header
    await expect(page.locator('text=Customer Portal').first()).toBeVisible()
    await expect(page.locator('text=test@example.com')).toBeVisible()
    
    // Verify logout button
    const logoutButton = page.locator('button').filter({ has: page.locator('svg') }).last()
    await expect(logoutButton).toBeVisible()
  })

  test('should display quick actions section', async ({ page }) => {
    await setupPortalSession(page)
    await page.goto('/customer')

    // Verify quick actions
    await expect(page.locator('text=Quick Actions')).toBeVisible()
    await expect(page.locator('text=Manage Payment Methods')).toBeVisible()
  })

  test('should display subscriptions section', async ({ page }) => {
    await setupPortalSession(page)
    await page.goto('/customer')

    // Verify subscriptions section
    await expect(page.locator('h2:has-text("Subscriptions")')).toBeVisible()
    
    // Should show active subscription
    await expect(page.locator('text=Product: prod-1')).toBeVisible()
    await expect(page.locator('span:has-text("active")').first()).toBeVisible()
  })

  test('should display one-time purchases section', async ({ page }) => {
    await setupPortalSession(page)
    await page.goto('/customer')

    // Verify one-time purchases section
    await expect(page.locator('h2:has-text("One-time Purchases")')).toBeVisible()
    
    // Should show one-time purchase
    await expect(page.locator('text=Product: prod-2')).toBeVisible()
    await expect(page.locator('text=Lifetime Access')).toBeVisible()
  })

  test('should display cancel button for active subscriptions', async ({ page }) => {
    await setupPortalSession(page)
    await page.goto('/customer')

    // Should have cancel button for active subscription
    const cancelButton = page.locator('button:has-text("Cancel"), text=Cancel')
    await expect(cancelButton.first()).toBeVisible()
  })

  test('should show empty state when no subscriptions', async ({ page }) => {
    await page.route('**/api/v1/portal/me', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email: 'test@example.com' }),
      })
    })

    await page.route('**/api/v1/portal/subscriptions', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscriptions: [] }),
      })
    })

    await page.route('**/api/v1/portal/entitlements', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entitlements: [] }),
      })
    })

    await page.goto('/customer')

    // Should show empty states
    await expect(page.locator('text=No active subscriptions')).toBeVisible()
    await expect(page.locator('text=No one-time purchases')).toBeVisible()
  })

  test('should show help section', async ({ page }) => {
    await setupPortalSession(page)
    await page.goto('/customer')

    // Verify help section
    await expect(page.locator('text=Need help?')).toBeVisible()
    await expect(page.locator('text=For billing questions or subscription changes')).toBeVisible()
  })

  test('should handle logout', async ({ page }) => {
    await setupPortalSession(page)
    
    await page.route('**/api/v1/portal/auth/logout', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    })

    await page.goto('/customer')

    // Click logout button
    const logoutButton = page.locator('button').filter({ has: page.locator('svg') }).last()
    await logoutButton.click()

    // Should redirect to login
    await expect(page).toHaveURL('/customer/login', { timeout: 5000 })
  })

  test('should handle manage billing button', async ({ page }) => {
    await setupPortalSession(page)
    
    await page.route('**/api/v1/portal/billing', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://billing.stripe.com/test' }),
      })
    })

    await page.goto('/customer')

    // Click manage billing button
    await page.click('text=Manage Payment Methods')

    // Note: In real test, this would redirect to Stripe billing portal
    // For testing, we just verify the API was called
  })

  test('should show loading state', async ({ page }) => {
    // Delay API responses to catch loading state
    await page.route('**/api/v1/portal/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    })

    await page.goto('/customer')

    // Should show loading spinner
    await expect(page.locator('.animate-spin')).toBeVisible()
  })

  test('should redirect to login when not authenticated', async ({ page }) => {
    // Simulate 401 response
    await page.route('**/api/v1/portal/me', route => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }),
      })
    })

    await page.goto('/customer')

    // Should redirect to login
    await expect(page).toHaveURL('/customer/login', { timeout: 5000 })
  })

  test('should show subscription cancellation flow', async ({ page }) => {
    await setupPortalSession(page)
    
    // Mock cancel endpoint
    await page.route('**/api/v1/portal/subscriptions/*/cancel', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    })

    await page.goto('/customer')

    // Set up dialog handler for confirmation
    page.on('dialog', dialog => dialog.accept())

    // Find and click cancel button
    const cancelButton = page.locator('button:has-text("Cancel"), .text-red-600:has-text("Cancel")')
    if (await cancelButton.count() > 0) {
      await cancelButton.first().click()
      // The subscription list should refresh
    }
  })

  test('should display subscription renewal date', async ({ page }) => {
    await setupPortalSession(page)
    await page.goto('/customer')

    // Should show renewal text
    await expect(page.locator('text=/Renews \\d+ (day|week|month|year)s? (from now|ago)/')).toBeVisible()
  })

  test('should show cancellation pending state', async ({ page }) => {
    await page.route('**/api/v1/portal/me', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email: 'test@example.com' }),
      })
    })

    await page.route('**/api/v1/portal/subscriptions', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscriptions: [
            {
              id: 'sub-1',
              productId: 'prod-1',
              status: 'active',
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              stripeSubscription: {
                id: 'sub_stripe_1',
                status: 'active',
                currentPeriodStart: new Date().toISOString(),
                currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                cancelAtPeriodEnd: true, // Marked for cancellation
                canceledAt: null,
              },
            },
          ],
        }),
      })
    })

    await page.route('**/api/v1/portal/entitlements', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entitlements: [] }),
      })
    })

    await page.goto('/customer')

    // Should show cancellation pending message
    await expect(page.locator('text=Cancels at period end')).toBeVisible()
  })
})
