import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// API キーをリクエストヘッダーに追加
api.interceptors.request.use((config) => {
  const apiKey = localStorage.getItem('apiKey')
  if (apiKey) {
    config.headers['X-API-Key'] = apiKey
  }
  return config
})

// エラーハンドリング
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('apiKey')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ============================
// API メソッド
// ============================
export const adminApi = {
  // 商品
  getProducts: () => api.get('/admin/products'),
  createProduct: (data: CreateProductData) => api.post('/admin/products', data),
  deleteProduct: (id: string) => api.delete(`/admin/products/${id}`),

  // 価格
  getPrices: (params?: { product_id?: string }) => api.get('/admin/prices', { params }),
  createPrice: (data: CreatePriceData) => api.post('/admin/prices', data),

  // 顧客
  getCustomers: () => api.get('/admin/customers'),
  getCustomer: (id: string) => api.get(`/admin/customers/${id}`),

  // Webhook
  getFailedWebhooks: () => api.get('/admin/webhooks/failed'),
  retryWebhook: (id: string) => api.post(`/admin/webhooks/${id}/retry`),

  // 監査ログ
  getAuditLogs: (params?: AuditLogParams) => api.get('/admin/audit-logs', { params }),

  // 開発者設定
  getSettings: () => api.get('/onboarding/settings'),
  updateSettings: (data: UpdateSettingsData) => api.put('/onboarding/settings', data),
}

// ============================
// 型定義（バックエンド snake_case に統一）
// ============================

export interface CreateProductData {
  name: string
  description?: string
  type: 'one_time' | 'subscription'
  payment_methods?: string[]
}

export interface UpdateSettingsData {
  default_success_url?: string
  default_cancel_url?: string
  default_locale?: string
  default_currency?: string
  default_payment_methods?: string[]
  callback_url?: string
  company_name?: string
}

export interface CreatePriceData {
  product_id: string
  amount: number
  currency: string
  interval?: 'month' | 'year'
}

export interface AuditLogParams {
  start_date?: string
  end_date?: string
  action?: string
  resource_type?: string
  limit?: number
  offset?: number
}

// --- エンティティ型（バックエンドのレスポンスそのまま）---

export interface Product {
  id: string
  name: string
  description: string | null
  type: 'one_time' | 'subscription'
  active: boolean
  stripe_product_id: string
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Price {
  id: string
  product_id: string
  stripe_price_id: string
  amount: number
  currency: string
  interval: 'month' | 'year' | null
  active: boolean
  created_at: string
}

export interface Customer {
  id: string
  email: string
  name: string | null
  stripe_customer_id: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface Entitlement {
  id: string
  customer_id: string
  product_id: string
  purchase_intent_id: string
  status: 'active' | 'suspended' | 'expired' | 'revoked'
  expires_at: string | null
  revoked_reason: string | null
  created_at: string
  updated_at: string
}

export interface WebhookLog {
  id: string
  stripe_event_id: string
  event_type: string
  status: 'pending' | 'processed' | 'failed' | 'dlq'
  attempts: number
  error_message: string | null
  last_attempt_at: string | null
  created_at: string
}

export interface AuditLog {
  id: string
  action: string
  resource_type: string
  resource_id: string
  changes: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}
