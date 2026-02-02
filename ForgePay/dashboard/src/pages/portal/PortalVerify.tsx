import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

export function PortalVerify() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const token = searchParams.get('token')

    if (!token) {
      setStatus('error')
      setError('No token provided')
      return
    }

    const verifyToken = async () => {
      try {
        const response = await fetch(`/api/v1/portal/auth/verify?token=${encodeURIComponent(token)}`, {
          credentials: 'include',
        })

        if (response.ok) {
          setStatus('success')
          // Redirect after a short delay
          setTimeout(() => {
            navigate('/customer')
          }, 2000)
        } else {
          const data = await response.json()
          setStatus('error')
          setError(data.error || 'Failed to verify magic link')
        }
      } catch {
        setStatus('error')
        setError('Network error. Please try again.')
      }
    }

    verifyToken()
  }, [searchParams, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          {status === 'loading' && (
            <>
              <Loader2 className="h-12 w-12 text-primary-600 animate-spin mx-auto mb-4" />
              <h1 className="text-xl font-bold text-gray-900">Verifying...</h1>
              <p className="text-gray-600 mt-2">Please wait while we verify your magic link</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">Success!</h1>
              <p className="text-gray-600 mt-2">
                You're now logged in. Redirecting to your portal...
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <XCircle className="h-8 w-8 text-red-600" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">Verification Failed</h1>
              <p className="text-gray-600 mt-2">{error}</p>
              <button
                onClick={() => navigate('/customer/login')}
                className="mt-6 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                Request New Link
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
