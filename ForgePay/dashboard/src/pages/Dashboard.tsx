import { useQuery } from '@tanstack/react-query'
import { adminApi, Product, Customer, WebhookLog } from '../lib/api'
import {
  Package,
  Users,
  AlertTriangle,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

// Mock data for chart (would come from API in real implementation)
const revenueData = [
  { name: 'Jan', revenue: 4000 },
  { name: 'Feb', revenue: 3000 },
  { name: 'Mar', revenue: 5000 },
  { name: 'Apr', revenue: 4500 },
  { name: 'May', revenue: 6000 },
  { name: 'Jun', revenue: 5500 },
]

interface StatCardProps {
  title: string
  value: string | number
  change?: number
  icon: React.ReactNode
  loading?: boolean
}

function StatCard({ title, value, change, icon, loading }: StatCardProps) {
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
          {change !== undefined && !loading && (
            <div className="flex items-center mt-2">
              {change >= 0 ? (
                <ArrowUpRight className="h-4 w-4 text-green-500" />
              ) : (
                <ArrowDownRight className="h-4 w-4 text-red-500" />
              )}
              <span
                className={`text-sm font-medium ${
                  change >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {Math.abs(change)}%
              </span>
              <span className="text-sm text-gray-500 ml-1">vs last month</span>
            </div>
          )}
        </div>
        <div className="p-3 bg-primary-50 rounded-lg">{icon}</div>
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

  const products: Product[] = productsData?.data?.products || []
  const customers: Customer[] = customersData?.data?.customers || []
  const failedWebhooks: WebhookLog[] = webhooksData?.data?.webhooks || []

  const activeProducts = products.filter((p) => p.active).length
  const failedCount = failedWebhooks.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Overview of your payment platform</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Products"
          value={activeProducts}
          change={12}
          icon={<Package className="h-6 w-6 text-primary-600" />}
          loading={productsLoading}
        />
        <StatCard
          title="Total Customers"
          value={customers.length}
          change={8}
          icon={<Users className="h-6 w-6 text-primary-600" />}
          loading={customersLoading}
        />
        <StatCard
          title="Failed Webhooks"
          value={failedCount}
          icon={<AlertTriangle className={`h-6 w-6 ${failedCount > 0 ? 'text-red-500' : 'text-green-500'}`} />}
          loading={webhooksLoading}
        />
        <StatCard
          title="Monthly Revenue"
          value="$12,450"
          change={15}
          icon={<TrendingUp className="h-6 w-6 text-primary-600" />}
        />
      </div>

      {/* Revenue Chart */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue Trend</h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#0284c7"
                strokeWidth={2}
                dot={{ fill: '#0284c7' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Products */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Products</h2>
          {productsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 animate-pulse rounded" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No products yet</p>
          ) : (
            <div className="space-y-3">
              {products.slice(0, 5).map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900">{product.name}</p>
                    <p className="text-sm text-gray-500">{product.type}</p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${
                      product.active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {product.active ? 'Active' : 'Archived'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Failed Webhooks */}
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
                    <p className="font-medium text-gray-900">{webhook.eventType}</p>
                    <p className="text-sm text-red-600">{webhook.errorMessage}</p>
                  </div>
                  <span className="text-xs text-gray-500">
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
