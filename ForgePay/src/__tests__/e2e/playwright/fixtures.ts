import { test as base, expect, Page } from '@playwright/test'

/**
 * Test fixtures for ForgePay E2E tests
 * 
 * All test data is created via API requests (not direct DB insertion)
 * to ensure realistic testing scenarios.
 */

// Test API key - set via environment variable or run setup script first
// Run: node scripts/setup-test-developer.js
export const TEST_API_KEY = process.env.TEST_API_KEY || ''

// API Base URL
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'

// Dashboard Base URL  
export const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3001'

// Validate API key is set
if (!TEST_API_KEY) {
  console.warn(`
⚠️  TEST_API_KEY is not set!

To set up a test developer:
1. Start the backend: npm run dev
2. Run: node scripts/setup-test-developer.js
3. Set the API key: export TEST_API_KEY=<your_api_key>
4. Run tests: npm run test:e2e
`)
}

/**
 * Extended test with common fixtures
 */
export const test = base.extend<{
  authenticatedPage: Page
  apiKey: string
  testProduct: { id: string; name: string; priceId?: string }
  testCustomer: { id: string; email: string }
}>({
  apiKey: TEST_API_KEY,
  
  authenticatedPage: async ({ page }, use) => {
    if (!TEST_API_KEY) {
      throw new Error('TEST_API_KEY is not set. Run: node scripts/setup-test-developer.js')
    }
    
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

  // Create test product via API (not direct DB insertion)
  testProduct: async ({}, use) => {
    if (!TEST_API_KEY) {
      throw new Error('TEST_API_KEY is not set')
    }

    const productName = `E2E Test Product ${Date.now()}`
    
    // Create product via API
    const product = await createTestProduct(TEST_API_KEY, productName)
    
    // Create price via API
    const price = await createTestPrice(TEST_API_KEY, product.id, 999, 'usd')
    
    await use({
      id: product.id,
      name: productName,
      priceId: price.id,
    })
    
    // Cleanup: Archive product via API after test
    await archiveTestProduct(TEST_API_KEY, product.id).catch(() => {
      // Ignore cleanup errors
    })
  },

  // Create test customer via checkout (simulating real user flow)
  testCustomer: async ({}, use) => {
    const email = `e2e-test-${Date.now()}@example.com`
    
    // Note: In real E2E tests, customers are created through checkout flow
    // This fixture provides a placeholder for tests that need customer data
    await use({
      id: '', // Will be populated after checkout
      email,
    })
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
 * Create test product via Admin API
 */
export async function createTestProduct(
  apiKey: string, 
  name: string, 
  type: 'one_time' | 'subscription' = 'one_time'
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      name,
      description: `E2E test product: ${name}`,
      type,
    }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create test product: ${response.status} - ${error}`)
  }
  
  return response.json()
}

/**
 * Create test price via Admin API
 */
export async function createTestPrice(
  apiKey: string,
  productId: string,
  amount: number,
  currency: string,
  interval?: 'month' | 'year'
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/prices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      product_id: productId,
      amount,
      currency,
      interval,
    }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create test price: ${response.status} - ${error}`)
  }
  
  return response.json()
}

/**
 * Create checkout session via API (simulates real checkout flow)
 */
export async function createCheckoutSession(
  apiKey: string,
  productId: string,
  priceId: string,
  customerEmail: string,
  successUrl: string = 'http://localhost:3001/success',
  cancelUrl: string = 'http://localhost:3001/cancel'
) {
  const purchaseIntentId = `e2e_test_${Date.now()}`
  
  const response = await fetch(`${API_BASE_URL}/api/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      product_id: productId,
      price_id: priceId,
      purchase_intent_id: purchaseIntentId,
      customer_email: customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create checkout session: ${response.status} - ${error}`)
  }
  
  const data = await response.json()
  return {
    ...data,
    purchaseIntentId,
  }
}

/**
 * Archive (soft-delete) test product via API
 */
export async function archiveTestProduct(apiKey: string, productId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/products/${productId}`, {
    method: 'DELETE',
    headers: {
      'X-API-Key': apiKey,
    },
  })
  
  if (!response.ok && response.status !== 404) {
    console.warn(`Failed to archive product ${productId}: ${response.status}`)
  }
}

/**
 * Get products list via API
 */
export async function getProducts(apiKey: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
    headers: {
      'X-API-Key': apiKey,
    },
  })
  
  if (!response.ok) {
    throw new Error(`Failed to get products: ${response.status}`)
  }
  
  return response.json()
}

/**
 * Request magic link via Portal API
 */
export async function requestMagicLink(apiKey: string, email: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/portal/auth/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ email }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to request magic link: ${response.status} - ${error}`)
  }
  
  return response.json()
}

/**
 * Verify entitlement via API
 */
export async function verifyEntitlement(apiKey: string, purchaseIntentId: string) {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/entitlements/verify?purchase_intent_id=${purchaseIntentId}`,
    {
      headers: {
        'X-API-Key': apiKey,
      },
    }
  )
  
  return {
    ok: response.ok,
    status: response.status,
    data: response.ok ? await response.json() : null,
  }
}

/**
 * Get audit logs via API
 */
export async function getAuditLogs(apiKey: string, params?: Record<string, string>) {
  const queryString = params ? '?' + new URLSearchParams(params).toString() : ''
  
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/audit-logs${queryString}`, {
    headers: {
      'X-API-Key': apiKey,
    },
  })
  
  if (!response.ok) {
    throw new Error(`Failed to get audit logs: ${response.status}`)
  }
  
  return response.json()
}

/**
 * Create coupon via API
 */
export async function createCoupon(
  apiKey: string,
  code: string,
  discountType: 'percentage' | 'fixed',
  discountValue: number,
  currency?: string
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/coupons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      code,
      discount_type: discountType,
      discount_value: discountValue,
      currency: currency || (discountType === 'fixed' ? 'usd' : undefined),
      max_uses: 100,
    }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create coupon: ${response.status} - ${error}`)
  }
  
  return response.json()
}
