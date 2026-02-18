import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, UpdateSettingsData } from '../lib/api'
import { Save, Globe, CreditCard, Bell, Building2, Key, CheckCircle, AlertCircle, ExternalLink, Loader2, ShieldCheck } from 'lucide-react'

/**
 * 開発者設定ページ
 * ノーコード決済リンクのデフォルト設定を管理
 */
export function Settings() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => adminApi.getSettings(),
  })

  const settings = data?.data?.settings || {}

  const [form, setForm] = useState<UpdateSettingsData>({
    default_success_url: '',
    default_cancel_url: '',
    default_locale: 'auto',
    default_currency: 'usd',
    default_payment_methods: ['card'],
    callback_url: '',
    company_name: '',
  })

  const [saved, setSaved] = useState(false)

  // 設定が読み込まれたらフォームを更新
  useEffect(() => {
    if (settings) {
      setForm({
        default_success_url: settings.default_success_url || '',
        default_cancel_url: settings.default_cancel_url || '',
        default_locale: settings.default_locale || 'auto',
        default_currency: settings.default_currency || 'usd',
        default_payment_methods: settings.default_payment_methods || ['card'],
        callback_url: settings.callback_url || '',
        company_name: settings.company_name || '',
      })
    }
  }, [data])

  const mutation = useMutation({
    mutationFn: (data: UpdateSettingsData) => adminApi.updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate(form)
  }

  const handlePaymentMethodToggle = (method: string) => {
    const methods = form.default_payment_methods || []
    if (methods.includes(method)) {
      setForm({ ...form, default_payment_methods: methods.filter(m => m !== method) })
    } else {
      setForm({ ...form, default_payment_methods: [...methods, method] })
    }
  }

  const paymentMethods = [
    { id: 'card', label: 'Credit Card', desc: 'Visa, Mastercard, AMEX' },
    { id: 'konbini', label: 'Convenience Store', desc: 'Japan (7-Eleven, Lawson, FamilyMart)' },
    { id: 'customer_balance', label: 'Bank Transfer', desc: 'Direct bank payment' },
    { id: 'link', label: 'Stripe Link', desc: 'One-click checkout' },
  ]

  const locales = [
    { value: 'auto', label: 'Auto-detect' },
    { value: 'ja', label: 'Japanese' },
    { value: 'en', label: 'English' },
    { value: 'zh', label: 'Chinese' },
    { value: 'ko', label: 'Korean' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'es', label: 'Spanish' },
  ]

  const currencies = [
    { value: 'usd', label: 'USD - US Dollar' },
    { value: 'jpy', label: 'JPY - Japanese Yen' },
    { value: 'eur', label: 'EUR - Euro' },
    { value: 'cny', label: 'CNY - Chinese Yuan' },
    { value: 'gbp', label: 'GBP - British Pound' },
    { value: 'aud', label: 'AUD - Australian Dollar' },
    { value: 'cad', label: 'CAD - Canadian Dollar' },
    { value: 'krw', label: 'KRW - Korean Won' },
  ]

  // Stripe キー設定用の state
  const [stripeForm, setStripeForm] = useState({
    stripe_secret_key: '',
    stripe_publishable_key: '',
    stripe_webhook_secret: '',
  })
  const [stripeSaved, setStripeSaved] = useState(false)
  const [stripeError, setStripeError] = useState('')

  // Stripe キー検証用の state
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; account_email?: string; mode?: string } | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)

  const apiKey = localStorage.getItem('apiKey') || ''

  /** Stripe キー接続テスト（保存しない） */
  const handleVerifyStripe = async () => {
    if (!stripeForm.stripe_secret_key) return
    setIsVerifying(true)
    setVerifyResult(null)
    setStripeError('')
    try {
      const res = await fetch('/api/v1/onboarding/stripe/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ stripe_secret_key: stripeForm.stripe_secret_key }),
      })
      const data = await res.json()
      if (!res.ok) {
        setVerifyResult({ valid: false })
        setStripeError(data.error || '検証に失敗しました')
      } else {
        setVerifyResult(data)
      }
    } catch {
      setStripeError('接続エラーが発生しました')
    } finally {
      setIsVerifying(false)
    }
  }

  const stripeMutation = useMutation({
    mutationFn: async (data: typeof stripeForm) => {
      const res = await fetch('/api/v1/onboarding/stripe/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to set Stripe keys')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setStripeSaved(true)
      setStripeError('')
      setVerifyResult(null)
      setStripeForm(prev => ({ ...prev, stripe_secret_key: '' }))
      setTimeout(() => setStripeSaved(false), 3000)
    },
    onError: (err: Error) => {
      setStripeError(err.message)
    },
  })

  const handleStripeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setStripeError('')
    stripeMutation.mutate(stripeForm)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  const stripeConfigured = settings.stripe_configured || false

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">
          Configure defaults for your payment links. No coding required.
        </p>
      </div>

      {/* Stripe API Keys - 最重要セクション */}
      <section className="bg-white rounded-xl shadow-sm p-6 border-2 border-primary-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Key className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">Stripe API Keys</h2>
          </div>
          {stripeConfigured ? (
            <span className="flex items-center text-sm text-green-600 bg-green-50 px-3 py-1 rounded-full">
              <CheckCircle className="h-4 w-4 mr-1" />
              Connected
            </span>
          ) : (
            <span className="flex items-center text-sm text-orange-600 bg-orange-50 px-3 py-1 rounded-full">
              <AlertCircle className="h-4 w-4 mr-1" />
              Not configured
            </span>
          )}
        </div>

        {/* Stripe アカウント取得ガイド */}
        {!stripeConfigured && (
          <div className="mb-5 bg-indigo-50 rounded-lg p-4 space-y-3">
            <p className="text-sm font-semibold text-indigo-800">Stripe アカウントをお持ちでない方はこちら:</p>
            <ol className="text-sm text-indigo-700 space-y-2">
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center font-bold">1</span>
                <span>
                  <a href="https://dashboard.stripe.com/register" target="_blank" rel="noopener noreferrer" className="underline font-medium inline-flex items-center gap-1">
                    Stripe でアカウント作成 <ExternalLink className="h-3 w-3" />
                  </a>
                  （登録は無料）
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center font-bold">2</span>
                <span>
                  <a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener noreferrer" className="underline font-medium inline-flex items-center gap-1">
                    API キーを取得 <ExternalLink className="h-3 w-3" />
                  </a>
                  → <code className="bg-indigo-100 px-1 rounded text-xs">Developers → API keys</code>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center font-bold">3</span>
                <span><strong>Secret key</strong> と <strong>Publishable key</strong> を下のフォームに入力して保存</span>
              </li>
            </ol>
          </div>
        )}

        <p className="text-sm text-gray-500 mb-4">
          自分の Stripe アカウントを接続すると、決済は直接あなたの口座に入金されます。
          キーは <strong>AES-256-GCM</strong> で暗号化して保存されます。
        </p>

        <form onSubmit={handleStripeSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Secret Key <span className="text-red-500">*</span></label>
            <input
              type="password"
              value={stripeForm.stripe_secret_key}
              onChange={(e) => {
                setStripeForm({ ...stripeForm, stripe_secret_key: e.target.value })
                setVerifyResult(null)
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none font-mono text-sm"
              placeholder={stripeConfigured ? '新しいキーを入力して更新（変更しない場合は空欄）' : 'sk_test_... or sk_live_...'}
            />
            <p className="text-xs text-gray-400 mt-1">暗号化して安全に保管されます（AES-256-GCM）</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Publishable Key</label>
            <input
              type="text"
              value={stripeForm.stripe_publishable_key}
              onChange={(e) => setStripeForm({ ...stripeForm, stripe_publishable_key: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none font-mono text-sm"
              placeholder="pk_test_... or pk_live_..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Webhook Signing Secret
              <span className="ml-1 text-xs text-gray-400">(オプション)</span>
            </label>
            <input
              type="password"
              value={stripeForm.stripe_webhook_secret}
              onChange={(e) => setStripeForm({ ...stripeForm, stripe_webhook_secret: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none font-mono text-sm"
              placeholder="whsec_..."
            />
            <p className="text-xs text-gray-400 mt-1">
              Stripe CLI: <code className="bg-gray-100 px-1 rounded">stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe</code>
            </p>
          </div>

          {/* 接続テスト結果 */}
          {verifyResult && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
              verifyResult.valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {verifyResult.valid ? (
                <>
                  <ShieldCheck className="h-4 w-4 flex-shrink-0" />
                  <span>
                    接続テスト成功 — {verifyResult.mode === 'live' ? '🔴 本番モード' : '🟡 テストモード'}
                    {verifyResult.account_email && <> (<strong>{verifyResult.account_email}</strong>)</>}
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>接続テスト失敗</span>
                </>
              )}
            </div>
          )}

          {stripeError && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {stripeError}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            {/* 接続テストボタン */}
            <button
              type="button"
              onClick={handleVerifyStripe}
              disabled={isVerifying || !stripeForm.stripe_secret_key}
              className="flex items-center px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {isVerifying ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />テスト中...</>
              ) : (
                <><ShieldCheck className="h-4 w-4 mr-2" />接続テスト</>
              )}
            </button>

            {/* 保存ボタン */}
            <button
              type="submit"
              disabled={stripeMutation.isPending || !stripeForm.stripe_secret_key}
              className={`flex items-center px-5 py-2 rounded-lg text-white font-medium transition-colors ${
                stripeSaved ? 'bg-green-500' : 'bg-primary-600 hover:bg-primary-700'
              } disabled:opacity-50`}
            >
              {stripeSaved ? (
                <><CheckCircle className="h-4 w-4 mr-2" />Stripe Connected!</>
              ) : stripeMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />保存中...</>
              ) : (
                <><Key className="h-4 w-4 mr-2" />{stripeConfigured ? 'Stripe キーを更新' : 'Stripe を接続'}</>
              )}
            </button>
          </div>
        </form>
      </section>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Company Info */}
        <section className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Building2 className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Company Info</h2>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company / Service Name</label>
            <input
              type="text"
              value={form.company_name || ''}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="Your Company Name"
            />
          </div>
        </section>

        {/* Redirect URLs */}
        <section className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Globe className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Redirect URLs</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Where to redirect customers after payment. Leave empty to use ForgePay default pages.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Success URL</label>
              <input
                type="url"
                value={form.default_success_url || ''}
                onChange={(e) => setForm({ ...form, default_success_url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="https://your-app.com/payment/success"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cancel URL</label>
              <input
                type="url"
                value={form.default_cancel_url || ''}
                onChange={(e) => setForm({ ...form, default_cancel_url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="https://your-app.com/payment/cancel"
              />
            </div>
          </div>
        </section>

        {/* Payment Methods */}
        <section className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center space-x-3 mb-4">
            <CreditCard className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Payment Methods</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Select which payment methods are available on your checkout pages.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {paymentMethods.map((method) => (
              <label
                key={method.id}
                className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
                  (form.default_payment_methods || []).includes(method.id)
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={(form.default_payment_methods || []).includes(method.id)}
                  onChange={() => handlePaymentMethodToggle(method.id)}
                  className="mt-0.5 mr-3 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <div>
                  <div className="font-medium text-gray-900 text-sm">{method.label}</div>
                  <div className="text-xs text-gray-500">{method.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Locale & Currency */}
        <section className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Globe className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Locale & Currency</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Language</label>
              <select
                value={form.default_locale || 'auto'}
                onChange={(e) => setForm({ ...form, default_locale: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                {locales.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Currency</label>
              <select
                value={form.default_currency || 'usd'}
                onChange={(e) => setForm({ ...form, default_currency: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                {currencies.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Callback URL */}
        <section className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Bell className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Payment Notifications</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Receive simple JSON notifications when payments are completed, refunded, etc.
            No Stripe webhook setup required.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Callback URL (optional)</label>
            <input
              type="url"
              value={form.callback_url || ''}
              onChange={(e) => setForm({ ...form, callback_url: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="https://your-app.com/api/payment-webhook"
            />
            <p className="text-xs text-gray-400 mt-1">
              We'll POST simple JSON events to this URL (payment.completed, subscription.created, refund.completed, etc.)
            </p>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={mutation.isPending}
            className={`flex items-center px-6 py-2.5 rounded-lg text-white font-medium transition-colors ${
              saved
                ? 'bg-green-500'
                : 'bg-primary-600 hover:bg-primary-700'
            } disabled:opacity-50`}
          >
            {saved ? (
              <>
                <Save className="h-4 w-4 mr-2" />
                Saved!
              </>
            ) : mutation.isPending ? (
              'Saving...'
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Settings
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
