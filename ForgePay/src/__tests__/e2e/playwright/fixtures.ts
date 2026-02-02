import { test as base, expect, Page } from '@playwright/test'

/**
 * Test fixtures for ForgePay E2E tests
 */

// Test API key - should match what's in your .env or test database
export const TEST_API_KEY = process.env.TEST_API_KEY || 'sk_test_demo_key_12345'

// API Base URL
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'

// Dashboard Base URL  
export const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5173'

/**
 * Extended test with common fixtures
 */
export const test = base.extend<{
  authenticatedPage: Page
  apiKey: string
}>({
  apiKey: TEST_API_KEY,
  
  authenticatedPage: async ({ page }, use) => {
    // Navigate to login
    await page.goto('/login')
    
    // Fill in API key
    await page.fill('input[type="password"]', TEST_API_KEY)
    
    // Click login button
    await page.click('button[type="submit"]')
    
    // Wait for redirect to dashboard
    await page.waitForURL('/')
    
    // Verify we're on the dashboard
    await expect(page.locator('h1')).toContainText('Dashboard')
    
    await use(page)
  },
})

export { expect }

/**
 * Helper to wait for API response
 */
export async function waitForApiResponse(page: Page, urlPattern: string | RegExp) {
  return page.waitForResponse(response => {
    const url = response.url()
    if (typeof urlPattern === 'string') {
      return url.includes(urlPattern)
    }
    return urlPattern.test(url)
  })
}

/**
 * Helper to create test product via API
 */
export async function createTestProduct(apiKey: string, name: string, type: 'one_time' | 'subscription' = 'one_time') {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      name,
      description: `Test product: ${name}`,
      type,
    }),
  })
  
  if (!response.ok) {
    throw new Error(`Failed to create test product: ${response.statusText}`)
  }
  
  return response.json()
}

/**
 * Helper to create test customer via API
 */
export async function createTestCustomer(apiKey: string, email: string, name: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/customers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      email,
      name,
    }),
  })
  
  if (!response.ok) {
    throw new Error(`Failed to create test customer: ${response.statusText}`)
  }
  
  return response.json()
}

/**
 * Helper to cleanup test data via API
 */
export async function cleanupTestData(apiKey: string, productIds: string[], customerIds: string[]) {
  // Cleanup products
  for (const id of productIds) {
    await fetch(`${API_BASE_URL}/api/v1/admin/products/${id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': apiKey },
    }).catch(() => {/* ignore errors */})
  }
  
  // Cleanup customers  
  for (const id of customerIds) {
    await fetch(`${API_BASE_URL}/api/v1/admin/customers/${id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': apiKey },
    }).catch(() => {/* ignore errors */})
  }
}
