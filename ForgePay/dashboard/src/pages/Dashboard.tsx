import { useQuery } from '@tanstack/react-query'
import { adminApi, Product, Customer, WebhookLog } from '../lib/api'
import {
  Package,
  Users,
  AlertTriangle,
  Link as LinkIcon,
  Copy,
  Check,
} from 'lucide-react'
import { useState } from 'react'

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ReactNode
  loading?: boolean
  color?: string
}

function StatCard({ title, value, icon, loading, color = 'primary' }: StatCardProps) {
  const bgClass = color === 'red' ? 'bg-red-50' : color === 'green' ? 'bg-green-50' : 'bg-primary-50'
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-gray-200 animate-pulse rounded mt-1" />
          ) : (
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          )}
        </div>
        <div className={`p-3 ${bgClass} rounded-lg`}>{icon}</div>
      </div>
    </div>
  )
}

export function Dashboard() {
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => adminApi.getProducts(),
  })

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => adminApi.getCustomers(),
  })

  const { data: webhooksData, isLoading: webhooksLoading } = useQuery({
    queryKey: ['failedWebhooks'],
    queryFn: () => adminApi.getFailedWebhooks(),
  })

  // バックエンドの実際のレスポンス形式に合わせる
  const products: Product[] = productsData?.data?.data || []
  const customers: Customer[] = customersData?.data?.data || []
  const failedWebhooks: WebhookLog[] = webhooksData?.data?.data || []

  const activeProducts = products.filter((p) => p.active).length
  const failedCount = failedWebhooks.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Overview of your payment platform</p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Active Products"
          value={activeProducts}
          icon={<Package className="h-6 w-6 text-primary-600" />}
          loading={productsLoading}
        />
        <StatCard
          title="Total Customers"
          value={customers.length}
          icon={<Users className="h-6 w-6 text-primary-600" />}
          loading={customersLoading}
        />
        <StatCard
          title="Failed Webhooks"
          value={failedCount}
          icon={<AlertTriangle className={`h-6 w-6 ${failedCount > 0 ? 'text-red-500' : 'text-green-500'}`} />}
          loading={webhooksLoading}
          color={failedCount > 0 ? 'red' : 'green'}
        />
        <StatCard
          title="Payment Links"
          value={products.filter(p => p.payment_link).length}
          icon={<LinkIcon className="h-6 w-6 text-primary-600" />}
          loading={productsLoading}
        />
      </div>

      {/* クイックスタートガイド（商品がない場合） */}
      {!productsLoading && products.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-blue-900 mb-3">Quick Start Guide</h2>
          <ol className="space-y-3 text-sm text-blue-800">
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold mr-3 mt-0.5">1</span>
              <div>
                <p className="font-medium">Configure Stripe Keys</p>
                <p className="text-blue-600">Go to Settings and enter your Stripe API keys</p>
              </div>
            </li>
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold mr-3 mt-0.5">2</span>
              <div>
                <p className="font-medium">Create a Product</p>
                <p className="text-blue-600">Go to Products and create your first product with pricing</p>
              </div>
            </li>
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold mr-3 mt-0.5">3</span>
              <div>
                <p className="font-medium">Copy Payment Link</p>
                <p className="text-blue-600">Embed the auto-generated payment link in your app — no coding required!</p>
              </div>
            </li>
          </ol>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 決済リンク一覧（最重要！） */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment Links</h2>
          {productsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : products.filter(p => p.payment_link && p.active).length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              Create a product to generate payment links
            </p>
          ) : (
            <div className="space-y-3">
              {products
                .filter(p => p.payment_link && p.active)
                .map((product) => (
                  <PaymentLinkRow key={product.id} product={product} />
                ))}
            </div>
          )}
        </div>

        {/* 失敗した Webhook */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Failed Webhooks</h2>
          {webhooksLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 animate-pulse rounded" />
              ))}
            </div>
          ) : failedWebhooks.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <AlertTriangle className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-gray-500">No failed webhooks</p>
            </div>
          ) : (
            <div className="space-y-3">
              {failedWebhooks.slice(0, 5).map((webhook) => (
                <div
                  key={webhook.id}
                  className="flex items-center justify-between p-3 bg-red-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{webhook.event_type}</p>
                    <p className="text-xs text-red-600 truncate max-w-[250px]">{webhook.error_message}</p>
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                    {webhook.attempts} attempts
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * ダッシュボード用の決済リンク行（コピー機能付き）
 */
function PaymentLinkRow({ product }: { product: Product }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!product.payment_link) return
    try {
      await navigator.clipboard.writeText(product.payment_link)
    } catch {
      const input = document.createElement('input')
      input.value = product.payment_link
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900 text-sm">{product.name}</p>
        <code className="text-xs text-blue-600 truncate block">{product.payment_link}</code>
      </div>
      <button
        onClick={handleCopy}
        className={`ml-3 flex-shrink-0 flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          copied
            ? 'bg-green-100 text-green-700'
            : 'bg-primary-100 text-primary-700 hover:bg-primary-200'
        }`}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 mr-1" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3 mr-1" />
            Copy
          </>
        )}
      </button>
    </div>
  )
}
