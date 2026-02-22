import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, UpdateSettingsData } from '../lib/api'
import {
  Save, Globe, CreditCard, Bell, Building2, Key,
  CheckCircle, AlertCircle, ExternalLink, Loader2,
  ShieldCheck, Server, ArrowRight,
} from 'lucide-react'

interface EnvStripeInfo {
  has_secret_key: boolean
  has_publishable_key: boolean
  has_webhook_secret: boolean
  secret_key_masked: string | null
  publishable_key_masked: string | null
  webhook_secret_masked: string | null
  mode: 'test' | 'live'
}

/**
 * 設定ページ（単一企業デプロイモデル）
 *
 * Stripe キーは .env のシステムデフォルトを基本とし、
 * ダッシュボードから上書き設定も可能。
 */
export function Settings() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => adminApi.getSettings(),
  })

  const settings = data?.data?.settings || {}
  const envStripe: EnvStripeInfo | null = data?.data?.env_stripe || null

  // stripe_source: "developer" = DB上書き済み, "env" = .envから, "none" = 未設定
  const stripeSource: string = settings.stripe_source || 'none'
  const stripeMode: string = settings.stripe_mode || envStripe?.mode || 'test'
  const stripeConnected = settings.stripe_configured || false

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

  // Stripe キー上書き用
  const [stripeForm, setStripeForm] = useState({
    stripe_secret_key: '',
    stripe_publishable_key: '',
    stripe_webhook_secret: '',
  })
  const [stripeSaved, setStripeSaved] = useState(false)
  const [stripeError, setStripeError] = useState('')
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; account_email?: string; mode?: string } | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [showOverrideForm, setShowOverrideForm] = useState(false)

  const apiKey = localStorage.getItem('apiKey') || ''

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
      const json = await res.json()
      if (!res.ok) {
        setVerifyResult({ valid: false })
        setStripeError(json.error || '検証に失敗しました')
      } else {
        setVerifyResult(json)
      }
    } catch {
      setStripeError('接続エラーが発生しました')
    } finally {
      setIsVerifying(false)
    }
  }

  const stripeMutation = useMutation({
    mutationFn: async (payload: typeof stripeForm) => {
      const res = await fetch('/api/v1/onboarding/stripe/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(payload),
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
      setShowOverrideForm(false)
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

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">設定</h1>
        <p className="text-gray-600 mt-1">
          決済キーとデフォルト設定を管理します。
        </p>
      </div>

      {/* ========== Stripe 接続ステータス ========== */}
      <section className="bg-white rounded-xl shadow-sm p-6 border-2 border-primary-200">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center space-x-3">
            <Key className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">Stripe 決済キー</h2>
          </div>
          <div className="flex items-center gap-2">
            {/* モードバッジ */}
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              stripeMode === 'live'
                ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}>
              {stripeMode === 'live' ? 'LIVE' : 'TEST'}
            </span>
            {/* 接続ステータス */}
            {stripeConnected ? (
              <span className="flex items-center text-sm text-green-600 bg-green-50 px-3 py-1 rounded-full">
                <CheckCircle className="h-4 w-4 mr-1" />
                接続済み
              </span>
            ) : (
              <span className="flex items-center text-sm text-orange-600 bg-orange-50 px-3 py-1 rounded-full">
                <AlertCircle className="h-4 w-4 mr-1" />
                未接続
              </span>
            )}
          </div>
        </div>

        {/* .env キー状態テーブル */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Server className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">システムデフォルト（.env）</span>
            {stripeSource === 'env' && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">使用中</span>
            )}
          </div>

          <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-200">
                <KeyStatusRow
                  label="Secret Key"
                  maskedValue={envStripe?.secret_key_masked}
                  isSet={envStripe?.has_secret_key ?? false}
                />
                <KeyStatusRow
                  label="Publishable Key"
                  maskedValue={envStripe?.publishable_key_masked}
                  isSet={envStripe?.has_publishable_key ?? false}
                />
                <KeyStatusRow
                  label="Webhook Secret"
                  maskedValue={envStripe?.webhook_secret_masked}
                  isSet={envStripe?.has_webhook_secret ?? false}
                />
              </tbody>
            </table>
          </div>

          {!envStripe?.has_secret_key && (
            <p className="mt-2 text-xs text-gray-500">
              <code className="bg-gray-100 px-1 rounded">.env</code> の{' '}
              <code className="bg-gray-100 px-1 rounded">STRIPE_TEST_SECRET_KEY</code> /
              <code className="bg-gray-100 px-1 rounded">STRIPE_LIVE_SECRET_KEY</code> を設定すると、サーバー起動時に自動で接続されます。
            </p>
          )}
        </div>

        {/* 開発者キー上書き状態 */}
        {stripeSource === 'developer' && (
          <div className="mb-5 bg-indigo-50 rounded-lg p-4 flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-indigo-800">ダッシュボードから設定されたキーで接続中</p>
              <p className="text-xs text-indigo-600 mt-1">
                Publishable Key: <code className="bg-indigo-100 px-1 rounded">{settings.stripe_publishable_key || '(未設定)'}</code>
              </p>
              <p className="text-xs text-indigo-500 mt-1">
                キーは AES-256-GCM で暗号化して保存されています。
              </p>
            </div>
          </div>
        )}

        {/* キーが全く無い場合のガイド */}
        {stripeSource === 'none' && (
          <div className="mb-5 bg-amber-50 rounded-lg p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-800">Stripe キーが設定されていません</p>
            <p className="text-sm text-amber-700">
              決済機能を利用するには、以下のいずれかの方法で Stripe キーを設定してください:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-white rounded-lg p-3 border border-amber-200">
                <p className="text-xs font-semibold text-gray-700 mb-1">方法 1: .env ファイル（推奨）</p>
                <p className="text-xs text-gray-500">
                  <code className="bg-gray-100 px-1 rounded">STRIPE_TEST_SECRET_KEY</code> 等を{' '}
                  <code className="bg-gray-100 px-1 rounded">.env</code> に記入してサーバーを再起動
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-amber-200">
                <p className="text-xs font-semibold text-gray-700 mb-1">方法 2: ダッシュボードから設定</p>
                <p className="text-xs text-gray-500">
                  下の「キーを設定する」ボタンから入力（暗号化して DB に保存）
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Stripe アカウント取得ガイド */}
        {stripeSource === 'none' && (
          <div className="mb-5 bg-indigo-50 rounded-lg p-4 space-y-3">
            <p className="text-sm font-semibold text-indigo-800">Stripe アカウントをお持ちでない方:</p>
            <ol className="text-sm text-indigo-700 space-y-2">
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center font-bold">1</span>
                <span>
                  <a href="https://dashboard.stripe.com/register" target="_blank" rel="noopener noreferrer" className="underline font-medium inline-flex items-center gap-1">
                    Stripe でアカウント作成 <ExternalLink className="h-3 w-3" />
                  </a>
                  （無料）
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center font-bold">2</span>
                <span>
                  <a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener noreferrer" className="underline font-medium inline-flex items-center gap-1">
                    API キーを取得 <ExternalLink className="h-3 w-3" />
                  </a>
                  <ArrowRight className="inline h-3 w-3 mx-1" />
                  <code className="bg-indigo-100 px-1 rounded text-xs">Developers → API keys</code>
                </span>
              </li>
            </ol>
          </div>
        )}

        {/* 上書きフォーム トグル */}
        {!showOverrideForm ? (
          <button
            type="button"
            onClick={() => setShowOverrideForm(true)}
            className="flex items-center text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
          >
            <Key className="h-4 w-4 mr-1.5" />
            {stripeSource === 'none' ? 'キーを設定する' : 'キーを変更する'}
          </button>
        ) : (
          <form onSubmit={handleStripeSubmit} className="space-y-4 border-t border-gray-200 pt-5">
            <p className="text-sm text-gray-500">
              ここで設定したキーは <strong>AES-256-GCM</strong> で暗号化して DB に保存されます。
              空欄の場合は .env のデフォルト値が使われます。
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Secret Key <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={stripeForm.stripe_secret_key}
                onChange={(e) => {
                  setStripeForm({ ...stripeForm, stripe_secret_key: e.target.value })
                  setVerifyResult(null)
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none font-mono text-sm"
                placeholder="sk_test_... or sk_live_..."
              />
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
                      接続テスト成功 — {verifyResult.mode === 'live' ? 'LIVE モード' : 'TEST モード'}
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

            {stripeSaved && (
              <div className="text-sm text-green-600 bg-green-50 p-3 rounded-lg flex items-center gap-2">
                <CheckCircle className="h-4 w-4 flex-shrink-0" />
                Stripe キーを保存しました
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
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

              <button
                type="submit"
                disabled={stripeMutation.isPending || !stripeForm.stripe_secret_key}
                className="flex items-center px-5 py-2 rounded-lg text-white font-medium bg-primary-600 hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {stripeMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />保存中...</>
                ) : (
                  <><Key className="h-4 w-4 mr-2" />保存</>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowOverrideForm(false)
                  setStripeError('')
                  setVerifyResult(null)
                  setStripeForm({ stripe_secret_key: '', stripe_publishable_key: '', stripe_webhook_secret: '' })
                }}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ========== 一般設定 ========== */}
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Company Info */}
        <section className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Building2 className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">会社情報</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Stripe の決済画面に表示される名前です。お客さんが「どこに払っているか」を確認する時に見えます。
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">会社名 / サービス名</label>
            <input
              type="text"
              value={form.company_name || ''}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="例: 株式会社サンプル / English Teacher Pro"
            />
          </div>
        </section>

        {/* Redirect URLs */}
        <section className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Globe className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">決済後の遷移先</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            お客さんが決済した後に自動で飛ばすページの URL です。
            空欄にすると ForgePay のデフォルト完了ページが表示されます。
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">成功時の遷移先</label>
              <input
                type="url"
                value={form.default_success_url || ''}
                onChange={(e) => setForm({ ...form, default_success_url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="例: https://myapp.com/thanks"
              />
              <p className="text-xs text-gray-400 mt-1">
                支払いが成功したらこの URL に飛ばします。「ありがとう」ページなどを指定してください。
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">キャンセル時の遷移先</label>
              <input
                type="url"
                value={form.default_cancel_url || ''}
                onChange={(e) => setForm({ ...form, default_cancel_url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="例: https://myapp.com/pricing"
              />
              <p className="text-xs text-gray-400 mt-1">
                お客さんが途中で「やめる」を押した時に戻るページです。料金ページなどが一般的です。
              </p>
            </div>
          </div>
        </section>

        {/* Payment Methods */}
        <section className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center space-x-3 mb-4">
            <CreditCard className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">決済方法</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            お客さんがチェックアウト画面で使える支払い方法です。複数選択可。
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
            <h2 className="text-lg font-semibold text-gray-900">言語 & 通貨</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Stripe チェックアウト画面の表示言語と、商品価格のデフォルト通貨です。
            個別の決済リンク作成時に上書きも可能です。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">デフォルト言語</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">デフォルト通貨</label>
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
            <h2 className="text-lg font-semibold text-gray-900">決済イベント通知</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            あなたのアプリが「誰が何を買ったか」をリアルタイムで知るための仕組みです。
            ここに URL を入れると、支払い完了・返金などの時に ForgePay がその URL に JSON を POST します。
            <strong className="text-gray-700">使わない場合は空欄でOK</strong>です。
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">通知先 URL（オプション）</label>
            <input
              type="url"
              value={form.callback_url || ''}
              onChange={(e) => setForm({ ...form, callback_url: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="例: https://myapp.com/api/payment-callback"
            />
            <p className="text-xs text-gray-400 mt-1">
              送信されるイベント: payment.completed（支払い完了）, subscription.created（サブスク開始）, refund.completed（返金完了）など
            </p>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={mutation.isPending}
            className={`flex items-center px-6 py-2.5 rounded-lg text-white font-medium transition-colors ${
              saved ? 'bg-green-500' : 'bg-primary-600 hover:bg-primary-700'
            } disabled:opacity-50`}
          >
            {saved ? (
              <><Save className="h-4 w-4 mr-2" />保存しました</>
            ) : mutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />保存中...</>
            ) : (
              <><Save className="h-4 w-4 mr-2" />設定を保存</>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

/** キー状態行コンポーネント */
function KeyStatusRow({ label, maskedValue, isSet }: {
  label: string
  maskedValue: string | null | undefined
  isSet: boolean
}) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-gray-600 font-medium w-44">{label}</td>
      <td className="px-4 py-2.5">
        {isSet ? (
          <span className="font-mono text-sm text-gray-800">{maskedValue}</span>
        ) : (
          <span className="text-gray-400 text-sm">未設定</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {isSet ? (
          <span className="inline-flex items-center text-xs text-green-600">
            <CheckCircle className="h-3.5 w-3.5 mr-1" />
            設定済み
          </span>
        ) : (
          <span className="inline-flex items-center text-xs text-gray-400">
            <AlertCircle className="h-3.5 w-3.5 mr-1" />
            未設定
          </span>
        )}
      </td>
    </tr>
  )
}
