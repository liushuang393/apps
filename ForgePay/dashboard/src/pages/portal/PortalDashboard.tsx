import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Package, Calendar, LogOut, ExternalLink, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Subscription {
  id: string
  productId: string
  status: string
  expiresAt: string | null
  stripeSubscription: {
    id: string
    status: string
    currentPeriodStart: string
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
    canceledAt: string | null
  } | null
}

interface Entitlement {
  id: string
  productId: string
  status: string
  expiresAt: string | null
  isSubscription: boolean
  createdAt: string
}

async function fetchWithSession(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
  })
  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = '/customer/login'
    }
    throw new Error('Request failed')
  }
  return response.json()
}

export function PortalDashboard() {
  const queryClient = useQueryClient()

  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => fetchWithSession('/api/v1/portal/me'),
  })

  const { data: subscriptionsData, isLoading: subscriptionsLoading } = useQuery({
    queryKey: ['portal-subscriptions'],
    queryFn: () => fetchWithSession('/api/v1/portal/subscriptions'),
  })

  const { data: entitlementsData, isLoading: entitlementsLoading } = useQuery({
    queryKey: ['portal-entitlements'],
    queryFn: () => fetchWithSession('/api/v1/portal/entitlements'),
  })

  const cancelMutation = useMutation({
    mutationFn: async ({ id, immediately }: { id: string; immediately: boolean }) => {
      const response = await fetch(`/api/v1/portal/subscriptions/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ immediately }),
      })
      if (!response.ok) throw new Error('Failed to cancel subscription')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-subscriptions'] })
      queryClient.invalidateQueries({ queryKey: ['portal-entitlements'] })
    },
  })

  const handleLogout = async () => {
    await fetch('/api/v1/portal/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
    window.location.href = '/customer/login'
  }

  const handleManageBilling = async () => {
    try {
      const data = await fetchWithSession('/api/v1/portal/billing')
      if (data.url) {
        window.location.href = data.url
      }
    } catch (error) {
      console.error('Failed to get billing portal URL', error)
    }
  }

  const subscriptions: Subscription[] = subscriptionsData?.subscriptions || []
  const entitlements: Entitlement[] = entitlementsData?.entitlements || []
  const oneTimeEntitlements = entitlements.filter((e) => !e.isSubscription)

  const isLoading = meLoading || subscriptionsLoading || entitlementsLoading

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-primary-600">Customer Portal</h1>
          <div className="flex items-center space-x-4">
            {meData && (
              <span className="text-sm text-gray-600">{meData.email}</span>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center text-gray-600 hover:text-gray-900"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : (
          <>
            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
              <div className="flex flex-wrap gap-4">
                <button
                  onClick={handleManageBilling}
                  className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                >
                  <CreditCard className="h-5 w-5 mr-2" />
                  Manage Payment Methods
                  <ExternalLink className="h-4 w-4 ml-2" />
                </button>
              </div>
            </div>

            {/* Active Subscriptions */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                <Calendar className="h-5 w-5 inline mr-2" />
                Subscriptions
              </h2>
              {subscriptions.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No active subscriptions</p>
              ) : (
                <div className="space-y-4">
                  {subscriptions.map((sub) => (
                    <div
                      key={sub.id}
                      className="border border-gray-200 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">
                            Product: {sub.productId}
                          </p>
                          <p className="text-sm text-gray-500">
                            {sub.stripeSubscription?.cancelAtPeriodEnd ? (
                              <span className="text-orange-600">
                                Cancels at period end
                              </span>
                            ) : sub.expiresAt ? (
                              `Renews ${formatDistanceToNow(new Date(sub.expiresAt), { addSuffix: true })}`
                            ) : (
                              'Active'
                            )}
                          </p>
                        </div>
                        <div className="flex items-center space-x-4">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded ${
                              sub.status === 'active'
                                ? 'bg-green-100 text-green-700'
                                : sub.status === 'suspended'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {sub.status}
                          </span>
                          {sub.status === 'active' && !sub.stripeSubscription?.cancelAtPeriodEnd && (
                            <button
                              onClick={() => {
                                if (confirm('Cancel this subscription at the end of the billing period?')) {
                                  cancelMutation.mutate({ id: sub.id, immediately: false })
                                }
                              }}
                              disabled={cancelMutation.isPending}
                              className="text-sm text-red-600 hover:text-red-700"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* One-time Purchases */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                <Package className="h-5 w-5 inline mr-2" />
                One-time Purchases
              </h2>
              {oneTimeEntitlements.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No one-time purchases</p>
              ) : (
                <div className="space-y-4">
                  {oneTimeEntitlements.map((ent) => (
                    <div
                      key={ent.id}
                      className="border border-gray-200 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">
                            Product: {ent.productId}
                          </p>
                          <p className="text-sm text-gray-500">
                            Purchased {formatDistanceToNow(new Date(ent.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded ${
                            ent.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {ent.status === 'active' ? 'Lifetime Access' : ent.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Help Section */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
              <div className="flex items-start">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 mr-3" />
                <div>
                  <h3 className="font-medium text-yellow-900">Need help?</h3>
                  <p className="text-sm text-yellow-700 mt-1">
                    For billing questions or subscription changes, please contact support.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
