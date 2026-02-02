import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add API key to requests
api.interceptors.request.use((config) => {
  const apiKey = localStorage.getItem('apiKey')
  if (apiKey) {
    config.headers['X-API-Key'] = apiKey
  }
  return config
})

// Handle errors
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

// API functions
export const adminApi = {
  // Products
  getProducts: () => api.get('/admin/products'),
  getProduct: (id: string) => api.get(`/admin/products/${id}`),
  createProduct: (data: CreateProductData) => api.post('/admin/products', data),
  updateProduct: (id: string, data: UpdateProductData) => api.put(`/admin/products/${id}`, data),
  deleteProduct: (id: string) => api.delete(`/admin/products/${id}`),

  // Prices
  getPrices: () => api.get('/admin/prices'),
  createPrice: (data: CreatePriceData) => api.post('/admin/prices', data),

  // Customers
  getCustomers: () => api.get('/admin/customers'),
  getCustomer: (id: string) => api.get(`/admin/customers/${id}`),

  // Refunds
  createRefund: (data: CreateRefundData) => api.post('/admin/refunds', data),

  // Webhooks
  getFailedWebhooks: () => api.get('/admin/webhooks/failed'),
  retryWebhook: (id: string) => api.post(`/admin/webhooks/${id}/retry`),
  getWebhookDetails: (id: string) => api.get(`/admin/webhooks/${id}`),

  // Audit Logs
  getAuditLogs: (params?: AuditLogParams) => api.get('/admin/audit-logs', { params }),

  // Entitlements
  getEntitlements: () => api.get('/admin/entitlements'),
  revokeEntitlement: (id: string) => api.post(`/admin/entitlements/${id}/revoke`),
}

// Types
export interface CreateProductData {
  name: string
  description?: string
  type: 'one_time' | 'subscription'
}

export interface UpdateProductData {
  name?: string
  description?: string
  active?: boolean
}

export interface CreatePriceData {
  productId: string
  amount: number
  currency: string
  interval?: 'month' | 'year'
}

export interface CreateRefundData {
  paymentId: string
  amount?: number
  reason?: string
}

export interface AuditLogParams {
  startDate?: string
  endDate?: string
  action?: string
  resourceType?: string
  limit?: number
  offset?: number
}

export interface Product {
  id: string
  name: string
  description: string | null
  type: 'one_time' | 'subscription'
  active: boolean
  stripeProductId: string
  createdAt: string
  updatedAt: string
}

export interface Price {
  id: string
  productId: string
  amount: number
  currency: string
  interval: 'month' | 'year' | null
  stripePriceId: string
  active: boolean
  createdAt: string
}

export interface Customer {
  id: string
  email: string
  name: string | null
  stripeCustomerId: string
  createdAt: string
}

export interface Entitlement {
  id: string
  customerId: string
  productId: string
  status: 'active' | 'suspended' | 'expired' | 'revoked'
  expiresAt: string | null
  createdAt: string
}

export interface WebhookLog {
  id: string
  stripeEventId: string
  eventType: string
  status: 'pending' | 'processed' | 'failed' | 'dlq'
  attempts: number
  errorMessage: string | null
  createdAt: string
}

export interface AuditLog {
  id: string
  action: string
  resourceType: string
  resourceId: string
  changes: Record<string, unknown> | null
  createdAt: string
}

// Currency types
export type SupportedCurrency = 'usd' | 'cny' | 'jpy' | 'eur'

export interface CurrencyInfo {
  code: SupportedCurrency
  symbol: string
  name: string
  nameChinese: string
  decimalPlaces: number
}

export interface ExchangeRate {
  currency: SupportedCurrency
  rateFromUSD: number
  lastUpdated: string
}

export interface ConvertedPrice {
  amount: number
  formatted: string
}

export interface MultiCurrencyPrices {
  usd: ConvertedPrice
  cny: ConvertedPrice
  jpy: ConvertedPrice
  eur: ConvertedPrice
}

// Currency API
export const currencyApi = {
  getCurrencies: () => api.get<{ currencies: CurrencyInfo[] }>('/currencies'),
  getRates: () => api.get<{ baseCurrency: string; rates: ExchangeRate[] }>('/currencies/rates'),
  getCurrency: (code: string) => api.get(`/currencies/${code}`),
  convert: (amount: number, fromCurrency: string, toCurrency: string) =>
    api.post('/currencies/convert', { amount, fromCurrency, toCurrency }),
  convertAll: (amount: number) =>
    api.post<{ prices: MultiCurrencyPrices }>('/currencies/convert-all', { amount }),
  format: (amount: number, currency: string, locale?: string) =>
    api.post('/currencies/format', { amount, currency, locale }),
}
