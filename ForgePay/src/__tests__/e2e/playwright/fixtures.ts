import { test as base, expect, Page } from '@playwright/test'

/**
 * API レスポンス型定義
 */
interface ProductResponse {
  id: string
  name: string
  description?: string
  type?: string
  stripe_product_id?: string
}

interface PriceResponse {
  id: string
  product_id: string
  stripe_price_id: string
  amount: number
  currency: string
}

interface CheckoutSessionResponse {
  session_id: string
  checkout_url: string
  expires_at: string
}

interface EntitlementVerifyResponse {
  status: string
  has_access: boolean
  entitlement_id: string | null
  product_id: string | null
  expires_at: string | null
}

/**
 * ForgePay E2E テストフィクスチャ
 *
 * 全テストデータは API 経由で作成（DB 直接操作なし）。
 * 薄いレイヤーのビジネスフロー100%カバレッジ。
 *
 * API キー解決順:
 *   1. process.env.TEST_API_KEY（globalSetup が設定）
 *   2. .e2e-state.json（setup スクリプトが生成）
 *   3. なければエラー
 */
import fs from 'fs'
import path from 'path'

// .e2e-state.json からの読み込み
function loadApiKeyFromState(): string {
  try {
    const statePath = path.resolve(__dirname, '../../../../.e2e-state.json')
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      return state.apiKey || ''
    }
  } catch {
    // 読み込み失敗は無視
  }
  return ''
}

// テスト用 API キー（globalSetup → .e2e-state.json → 環境変数の順で解決）
export const TEST_API_KEY = process.env.TEST_API_KEY || loadApiKeyFromState()

// バックエンド API URL
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'

// ダッシュボード URL
export const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3001'

// API キー未設定時の警告
if (!TEST_API_KEY) {
  console.warn(`
⚠️  TEST_API_KEY が未設定です！

自動セットアップが失敗している可能性があります。
手動で実行する場合:
  node scripts/setup-test-developer.js
`)
}

/**
 * 拡張テストフィクスチャ
 */
export const test = base.extend<{
  authenticatedPage: Page
  apiKey: string
  testProduct: { id: string; name: string; priceId?: string }
}>({
  apiKey: TEST_API_KEY,

  // 認証済みページ: 自動ログイン（リトライ付き）
  authenticatedPage: async ({ page }, use) => {
    if (!TEST_API_KEY) {
      throw new Error('TEST_API_KEY が未設定。setup-test-developer.js を実行してください')
    }

    // 最大3回リトライ（レート制限やネットワーク遅延対策）
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto('/login')
        await page.waitForLoadState('networkidle')
        await page.fill('input[type="password"]', TEST_API_KEY)
        await page.click('button[type="submit"]')
        await page.waitForURL('/', { timeout: 15000 })
        await expect(page.locator('h1')).toContainText('Dashboard', { timeout: 10000 })
        lastError = null
        break
      } catch (e) {
        lastError = e as Error
        if (attempt < 3) {
          // リトライ前に少し待機
          await page.waitForTimeout(1000 * attempt)
        }
      }
    }
    if (lastError) {
      throw lastError
    }

    await use(page)
  },

  // テスト用商品 + 価格を自動作成・自動クリーンアップ
  testProduct: async ({}, use) => {
    if (!TEST_API_KEY) {
      throw new Error('TEST_API_KEY が未設定')
    }

    const productName = `E2E テスト商品 ${Date.now()}`
    const product = await createTestProduct(TEST_API_KEY, productName)
    const price = await createTestPrice(TEST_API_KEY, product.id, 999, 'usd')

    await use({
      id: product.id,
      name: productName,
      priceId: price.id,
    })

    // クリーンアップ
    await archiveTestProduct(TEST_API_KEY, product.id).catch(() => {})
  },
})

export { expect }

// ============================================================
// API ヘルパー関数
// ============================================================

/**
 * API レスポンス待機
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
 * 商品作成（Admin API）
 */
export async function createTestProduct(
  apiKey: string,
  name: string,
  type: 'one_time' | 'subscription' = 'one_time'
): Promise<ProductResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      name,
      description: `E2E テスト商品: ${name}`,
      type,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`商品作成失敗: ${response.status} - ${error}`)
  }

  return response.json() as Promise<ProductResponse>
}

/**
 * 価格作成（Admin API）
 */
export async function createTestPrice(
  apiKey: string,
  productId: string,
  amount: number,
  currency: string,
  interval?: 'month' | 'year'
): Promise<PriceResponse> {
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
    throw new Error(`価格作成失敗: ${response.status} - ${error}`)
  }

  return response.json() as Promise<PriceResponse>
}

/**
 * チェックアウトセッション作成（Checkout API）
 */
export async function createCheckoutSession(
  apiKey: string,
  productId: string,
  priceId: string,
  customerEmail: string = `e2e-${Date.now()}@test.example.com`,
  successUrl: string = `${API_BASE_URL}/payment/success`,
  cancelUrl: string = `${API_BASE_URL}/payment/cancel`
): Promise<{ sessionId: string; checkoutUrl: string; purchaseIntentId: string }> {
  const purchaseIntentId = `e2e_pi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

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
    throw new Error(`チェックアウトセッション作成失敗: ${response.status} - ${error}`)
  }

  const data = await response.json() as CheckoutSessionResponse
  return {
    sessionId: data.session_id,
    checkoutUrl: data.checkout_url,
    purchaseIntentId,
  }
}

/**
 * Entitlement 検証（Entitlement API）
 */
export async function verifyEntitlement(
  apiKey: string,
  purchaseIntentId: string
): Promise<{ ok: boolean; status: number; data: EntitlementVerifyResponse | null }> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/entitlements/verify?purchase_intent_id=${purchaseIntentId}`,
    {
      headers: { 'X-API-Key': apiKey },
    }
  )

  return {
    ok: response.ok,
    status: response.status,
    data: response.ok ? await response.json() as EntitlementVerifyResponse : null,
  }
}

/**
 * 商品アーカイブ（クリーンアップ）
 */
export async function archiveTestProduct(apiKey: string, productId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/products/${productId}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey },
  })

  if (!response.ok && response.status !== 404) {
    console.warn(`商品アーカイブ失敗 ${productId}: ${response.status}`)
  }
}

/**
 * 商品一覧取得
 */
export async function getProducts(apiKey: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
    headers: { 'X-API-Key': apiKey },
  })

  if (!response.ok) {
    throw new Error(`商品一覧取得失敗: ${response.status}`)
  }

  return response.json()
}

/**
 * 監査ログ取得
 */
export async function getAuditLogs(apiKey: string, params?: Record<string, string>) {
  const queryString = params ? '?' + new URLSearchParams(params).toString() : ''

  const response = await fetch(`${API_BASE_URL}/api/v1/admin/audit-logs${queryString}`, {
    headers: { 'X-API-Key': apiKey },
  })

  if (!response.ok) {
    throw new Error(`監査ログ取得失敗: ${response.status}`)
  }

  return response.json()
}

/**
 * ヘルスチェック
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`)
    return response.ok
  } catch {
    return false
  }
}

/**
 * 開発者登録（Onboarding API）
 */
export async function registerDeveloper(email: string): Promise<{
  developer: { id: string; email: string }
  apiKey: { key: string; prefix: string }
}> {
  const response = await fetch(`${API_BASE_URL}/api/v1/onboarding/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, testMode: true }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`開発者登録失敗: ${response.status} - ${error}`)
  }

  return response.json() as Promise<{
    developer: { id: string; email: string }
    apiKey: { key: string; prefix: string }
  }>
}

/**
 * 失敗 Webhook 一覧取得
 */
export async function getFailedWebhooks(apiKey: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/webhooks/failed`, {
    headers: { 'X-API-Key': apiKey },
  })

  if (!response.ok) {
    throw new Error(`失敗 Webhook 取得失敗: ${response.status}`)
  }

  return response.json()
}
