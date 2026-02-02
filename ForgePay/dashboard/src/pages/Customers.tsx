import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi, Customer, Entitlement } from '../lib/api'
import { Users, Search, ChevronRight, X } from 'lucide-react'

export function Customers() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['customers'],
    queryFn: () => adminApi.getCustomers(),
  })

  const customers: Customer[] = data?.data?.customers || []

  const filteredCustomers = customers.filter(
    (customer) =>
      customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.name?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <p className="text-gray-600 mt-1">View and manage your customers</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search customers by email or name..."
          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
      </div>

      {/* Customers List */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">Failed to load customers</div>
        ) : filteredCustomers.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">
              {searchTerm ? 'No customers found' : 'No customers yet'}
            </h3>
            <p className="text-gray-500 mt-1">
              {searchTerm
                ? 'Try adjusting your search'
                : 'Customers will appear here after their first purchase'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredCustomers.map((customer) => (
              <div
                key={customer.id}
                className="flex items-center justify-between p-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => setSelectedCustomer(customer)}
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-primary-600 font-medium">
                      {(customer.name || customer.email)[0].toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {customer.name || 'No name'}
                    </p>
                    <p className="text-sm text-gray-500">{customer.email}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-gray-500">
                    {new Date(customer.createdAt).toLocaleDateString()}
                  </span>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Customer Detail Modal */}
      {selectedCustomer && (
        <CustomerDetailModal
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
        />
      )}
    </div>
  )
}

interface CustomerDetailModalProps {
  customer: Customer
  onClose: () => void
}

function CustomerDetailModal({ customer, onClose }: CustomerDetailModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer', customer.id],
    queryFn: () => adminApi.getCustomer(customer.id),
  })

  const entitlements: Entitlement[] = data?.data?.entitlements || []

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Customer Details</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* Customer Info */}
          <div className="mb-6">
            <div className="flex items-center space-x-4 mb-4">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
                <span className="text-2xl text-primary-600 font-medium">
                  {(customer.name || customer.email)[0].toUpperCase()}
                </span>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900">
                  {customer.name || 'No name'}
                </h3>
                <p className="text-gray-500">{customer.email}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Customer ID</p>
                <p className="font-mono text-gray-900">{customer.id}</p>
              </div>
              <div>
                <p className="text-gray-500">Stripe Customer</p>
                <p className="font-mono text-gray-900">{customer.stripeCustomerId}</p>
              </div>
              <div>
                <p className="text-gray-500">Created</p>
                <p className="text-gray-900">
                  {new Date(customer.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* Entitlements */}
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">Entitlements</h4>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : entitlements.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No entitlements</p>
            ) : (
              <div className="space-y-2">
                {entitlements.map((entitlement) => (
                  <div
                    key={entitlement.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        Product: {entitlement.productId}
                      </p>
                      <p className="text-sm text-gray-500">
                        {entitlement.expiresAt
                          ? `Expires: ${new Date(entitlement.expiresAt).toLocaleDateString()}`
                          : 'Lifetime access'}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded ${
                        entitlement.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : entitlement.status === 'suspended'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {entitlement.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
