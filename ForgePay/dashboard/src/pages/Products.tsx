import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, Product, Price, CreateProductData, CreatePriceData } from '../lib/api'
import { Plus, Edit, Trash2, Package, X, Link, Copy, Check, DollarSign } from 'lucide-react'

export function Products() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [selectedProductForPrice, setSelectedProductForPrice] = useState<Product | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['products'],
    queryFn: () => adminApi.getProducts(),
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateProductData) => adminApi.createProduct(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setIsModalOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  // バックエンドは { data: [...] } を返す（axios ラップで response.data.data）
  const products: Product[] = data?.data?.data || []

  const handleDelete = (product: Product) => {
    if (confirm(`Are you sure you want to archive "${product.name}"?`)) {
      deleteMutation.mutate(product.id)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-600 mt-1">Manage your products, pricing, and payment links</p>
        </div>
        <button
          onClick={() => {
            setEditingProduct(null)
            setIsModalOpen(true)
          }}
          className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="h-5 w-5 mr-2" />
          Add Product
        </button>
      </div>

      {/* 商品テーブル */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">Failed to load products</div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No products yet</h3>
            <p className="text-gray-500 mt-1">Get started by creating your first product</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              Create Product
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                onEdit={() => {
                  setEditingProduct(product)
                  setIsModalOpen(true)
                }}
                onDelete={() => handleDelete(product)}
                onAddPrice={() => {
                  setSelectedProductForPrice(product)
                  setIsPriceModalOpen(true)
                }}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* 商品作成/編集モーダル */}
      {isModalOpen && (
        <ProductModal
          product={editingProduct}
          onClose={() => setIsModalOpen(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      )}

      {/* 価格設定モーダル */}
      {isPriceModalOpen && selectedProductForPrice && (
        <PriceModal
          product={selectedProductForPrice}
          onClose={() => {
            setIsPriceModalOpen(false)
            setSelectedProductForPrice(null)
          }}
        />
      )}
    </div>
  )
}

// ============================
// 商品行コンポーネント
// ============================
interface ProductRowProps {
  product: Product
  onEdit: () => void
  onDelete: () => void
  onAddPrice: () => void
  isDeleting: boolean
}

function ProductRow({ product, onEdit, onDelete, onAddPrice, isDeleting }: ProductRowProps) {
  return (
    <div className="p-6 hover:bg-gray-50">
      <div className="flex items-start justify-between">
        {/* 商品情報 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-3 mb-1">
            <h3 className="font-semibold text-gray-900">{product.name}</h3>
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">
              {product.type === 'one_time' ? 'One-time' : 'Subscription'}
            </span>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded ${
                product.active
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {product.active ? 'Active' : 'Archived'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mb-3">{product.description || 'No description'}</p>

          {/* 決済リンク（目立つ表示） */}
          {product.payment_link && (
            <div className="mb-2">
              <PaymentLinkDisplay url={product.payment_link} />
            </div>
          )}

          <p className="text-xs text-gray-400">
            Created: {new Date(product.created_at).toLocaleDateString()}
          </p>
        </div>

        {/* アクション */}
        <div className="flex items-center space-x-2 ml-4">
          <button
            onClick={onAddPrice}
            className="flex items-center px-3 py-1.5 text-sm border border-primary-600 text-primary-600 rounded-lg hover:bg-primary-50 transition-colors"
          >
            <DollarSign className="h-4 w-4 mr-1" />
            Price
          </button>
          <button
            onClick={onEdit}
            className="p-2 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Edit"
          >
            <Edit className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            disabled={isDeleting}
            title="Archive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================
// 決済リンク表示（大きく目立つように）
// ============================
function PaymentLinkDisplay({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 max-w-xl">
      <Link className="h-4 w-4 text-blue-500 flex-shrink-0 mr-2" />
      <code className="text-sm text-blue-700 truncate flex-1 select-all" title={url}>
        {url}
      </code>
      <button
        onClick={handleCopy}
        className={`ml-2 flex items-center px-2 py-1 rounded text-xs font-medium transition-colors ${
          copied
            ? 'bg-green-100 text-green-700'
            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
        }`}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 mr-1" />
            Copied!
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

// ============================
// 商品作成/編集モーダル
// ============================
interface ProductModalProps {
  product: Product | null
  onClose: () => void
  onSubmit: (data: CreateProductData) => void
  isLoading: boolean
}

function ProductModal({ product, onClose, onSubmit, isLoading }: ProductModalProps) {
  const [name, setName] = useState(product?.name || '')
  const [description, setDescription] = useState(product?.description || '')
  const [type, setType] = useState<'one_time' | 'subscription'>(product?.type || 'one_time')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({ name, description, type })
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {product ? 'Edit Product' : 'Create Product'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="e.g. Premium Plan"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="Product description"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'one_time' | 'subscription')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            >
              <option value="one_time">One-time payment</option>
              <option value="subscription">Subscription</option>
            </select>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : product ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================
// 価格設定モーダル（新規追加）
// ============================
interface PriceModalProps {
  product: Product
  onClose: () => void
}

function PriceModal({ product, onClose }: PriceModalProps) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('jpy')
  const [interval, setInterval] = useState<'month' | 'year' | ''>('')

  // 既存の価格を取得
  const { data: pricesData, isLoading } = useQuery({
    queryKey: ['prices', product.id],
    queryFn: () => adminApi.getPrices({ product_id: product.id }),
  })

  const prices: Price[] = pricesData?.data?.data || []

  const createPriceMutation = useMutation({
    mutationFn: (data: CreatePriceData) => adminApi.createPrice(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prices', product.id] })
      setAmount('')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const amountNum = parseInt(amount, 10)
    if (isNaN(amountNum) || amountNum <= 0) return

    createPriceMutation.mutate({
      product_id: product.id,
      amount: amountNum,
      currency,
      interval: product.type === 'subscription' && interval ? interval : undefined,
    })
  }

  // 通貨に応じた金額表示
  const formatAmount = (amt: number, cur: string) => {
    const zeroDecimal = ['jpy', 'krw'].includes(cur.toLowerCase())
    if (zeroDecimal) {
      return `${amt.toLocaleString()} ${cur.toUpperCase()}`
    }
    return `${(amt / 100).toFixed(2)} ${cur.toUpperCase()}`
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Pricing</h2>
            <p className="text-sm text-gray-500">{product.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* 既存の価格一覧 */}
          {isLoading ? (
            <div className="h-20 bg-gray-100 animate-pulse rounded-lg mb-4" />
          ) : prices.length > 0 ? (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Current Prices</h3>
              <div className="space-y-2">
                {prices.map((price) => (
                  <div
                    key={price.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {formatAmount(price.amount, price.currency)}
                      </p>
                      {price.interval && (
                        <p className="text-xs text-gray-500">per {price.interval}</p>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        price.active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {price.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 mb-4 bg-yellow-50 rounded-lg">
              <DollarSign className="h-8 w-8 text-yellow-500 mx-auto mb-2" />
              <p className="text-sm text-yellow-700 font-medium">No prices set</p>
              <p className="text-xs text-yellow-600">Add a price to enable payment links</p>
            </div>
          )}

          {/* 新しい価格を追加 */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700">Add New Price</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  placeholder={currency === 'jpy' ? '980' : '9.99'}
                />
                <p className="text-xs text-gray-400 mt-1">
                  {['jpy', 'krw'].includes(currency) ? 'Whole units' : 'In cents (e.g. 999 = $9.99)'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                >
                  <option value="jpy">JPY - Japanese Yen</option>
                  <option value="usd">USD - US Dollar</option>
                  <option value="eur">EUR - Euro</option>
                  <option value="cny">CNY - Chinese Yuan</option>
                  <option value="gbp">GBP - British Pound</option>
                  <option value="krw">KRW - Korean Won</option>
                </select>
              </div>
            </div>

            {product.type === 'subscription' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Billing Interval</label>
                <select
                  value={interval}
                  onChange={(e) => setInterval(e.target.value as 'month' | 'year' | '')}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                >
                  <option value="">Select interval...</option>
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={createPriceMutation.isPending || !amount}
              className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {createPriceMutation.isPending ? 'Adding...' : 'Add Price'}
            </button>

            {createPriceMutation.isSuccess && (
              <p className="text-sm text-green-600 text-center">Price added successfully!</p>
            )}
            {createPriceMutation.isError && (
              <p className="text-sm text-red-600 text-center">Failed to add price</p>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
