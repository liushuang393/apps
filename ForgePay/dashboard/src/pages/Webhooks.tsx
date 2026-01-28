import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, WebhookLog } from '../lib/api'
import { Webhook, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export function Webhooks() {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['failedWebhooks'],
    queryFn: () => adminApi.getFailedWebhooks(),
  })

  const retryMutation = useMutation({
    mutationFn: (id: string) => adminApi.retryWebhook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['failedWebhooks'] })
    },
  })

  const webhooks: WebhookLog[] = data?.data?.webhooks || []
  const failedWebhooks = webhooks.filter((w) => w.status === 'failed' || w.status === 'dlq')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
        <p className="text-gray-600 mt-1">Monitor and retry failed webhook events</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Failed Events</p>
              <p className="text-2xl font-bold text-red-600 mt-1">
                {failedWebhooks.filter((w) => w.status === 'failed').length}
              </p>
            </div>
            <div className="p-3 bg-red-50 rounded-lg">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Dead Letter Queue</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">
                {failedWebhooks.filter((w) => w.status === 'dlq').length}
              </p>
            </div>
            <div className="p-3 bg-orange-50 rounded-lg">
              <Webhook className="h-6 w-6 text-orange-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Total Events</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{webhooks.length}</p>
            </div>
            <div className="p-3 bg-gray-100 rounded-lg">
              <Webhook className="h-6 w-6 text-gray-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Webhooks Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Failed Webhooks</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">Failed to load webhooks</div>
        ) : failedWebhooks.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">All webhooks processed</h3>
            <p className="text-gray-500 mt-1">No failed webhooks to display</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Event Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Attempts
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Error
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {failedWebhooks.map((webhook) => (
                <tr key={webhook.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Webhook className="h-5 w-5 text-gray-400 mr-2" />
                      <span className="font-mono text-sm text-gray-900">
                        {webhook.eventType}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded ${
                        webhook.status === 'dlq'
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {webhook.status === 'dlq' ? 'Dead Letter Queue' : 'Failed'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {webhook.attempts}
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-red-600 max-w-xs truncate">
                      {webhook.errorMessage || 'Unknown error'}
                    </p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDistanceToNow(new Date(webhook.createdAt), { addSuffix: true })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    <button
                      onClick={() => retryMutation.mutate(webhook.id)}
                      disabled={retryMutation.isPending}
                      className="inline-flex items-center px-3 py-1 border border-primary-600 text-primary-600 rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-1 ${
                          retryMutation.isPending ? 'animate-spin' : ''
                        }`}
                      />
                      Retry
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
