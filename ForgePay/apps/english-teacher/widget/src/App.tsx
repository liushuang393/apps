import { useState, useEffect, useCallback } from 'react'
import { QuestionForm } from './components/QuestionForm'
import { AnswerDisplay } from './components/AnswerDisplay'
import { UpgradeButton } from './components/UpgradeButton'

// MCP ツール呼び出し結果の型定義
interface AskResult {
  answer?: string
  needs_upgrade: boolean
  checkout_url?: string
  remaining_free?: number
  is_paid_user: boolean
  message?: string
}

interface UserStatus {
  paid: boolean
  free_questions_used: number
  free_limit: number
  remaining_free: number
  can_ask: boolean
  plan: 'free' | 'premium'
}

interface QandA {
  question: string
  answer: string
  timestamp: Date
  isPaid: boolean
}

// ChatGPT Apps Bridge 経由でツールを呼び出す
// 開発環境では REST API にフォールバックする
async function callMcpTool<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
  // MCP Apps Bridge が利用可能かチェック（ChatGPT 内の場合）
  const win = window as Window & {
    openai?: {
      callTool?: (name: string, args: Record<string, unknown>) => Promise<T>
    }
  }

  if (win.openai?.callTool) {
    return await win.openai.callTool(toolName, args)
  }

  // 開発環境フォールバック: 直接 API を呼び出す
  const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

  // ツール名をエンドポイントにマッピング
  const endpointMap: Record<string, string> = {
    ask_english_teacher: '/api/ask',
    get_subscription_status: '/api/status',
    create_checkout_url: '/checkout/session',
  }

  const endpoint = endpointMap[toolName]
  if (!endpoint) throw new Error(`不明なツール: ${toolName}`)

  const response = await fetch(`${apiBase}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error ?? `API エラー: ${response.status}`)
  }

  return response.json()
}

export default function App() {
  const [userId] = useState<string>(() => {
    // 実際の ChatGPT App では OpenAI が user_id を提供する
    // 開発環境では localStorage で疑似 user_id を管理
    const stored = localStorage.getItem('et_user_id')
    if (stored) return stored
    const newId = `dev_user_${Date.now()}`
    localStorage.setItem('et_user_id', newId)
    return newId
  })

  const [status, setStatus] = useState<UserStatus>({
    paid: false,
    free_questions_used: 0,
    free_limit: 3,
    remaining_free: 3,
    can_ask: true,
    plan: 'free',
  })
  const [history, setHistory] = useState<QandA[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState<string>()
  const [checkoutUrl, setCheckoutUrl] = useState<string>()
  const [error, setError] = useState<string>()

  // 起動時にユーザーステータスを取得
  useEffect(() => {
    fetchStatus()
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const result = await callMcpTool<UserStatus>('get_subscription_status', {
        user_id: userId,
      })
      setStatus(result)
    } catch (err) {
      // ステータス取得失敗はサイレントに処理
      console.error('ステータス取得エラー:', err)
    }
  }, [userId])

  async function handleQuestion(question: string) {
    setIsLoading(true)
    setCurrentQuestion(question)
    setError(undefined)

    try {
      const result = await callMcpTool<AskResult>('ask_english_teacher', {
        user_id: userId,
        question,
      })

      if (result.needs_upgrade) {
        // アップグレードが必要な場合
        if (result.checkout_url) {
          setCheckoutUrl(result.checkout_url)
        }
        setError(result.message)
      } else if (result.answer) {
        // 回答を履歴に追加
        setHistory((prev) => [
          ...prev,
          {
            question,
            answer: result.answer!,
            timestamp: new Date(),
            isPaid: result.is_paid_user,
          },
        ])

        // ステータスを更新
        if (result.remaining_free !== undefined) {
          setStatus((prev) => ({
            ...prev,
            remaining_free: result.remaining_free!,
            free_questions_used: prev.free_limit - result.remaining_free!,
          }))
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
      setError(message)
    } finally {
      setIsLoading(false)
      setCurrentQuestion(undefined)
    }
  }

  return (
    <div className="min-h-screen bg-chatgpt-bg text-chatgpt-text p-3 flex flex-col gap-3">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎓</span>
          <div>
            <h1 className="text-sm font-semibold text-chatgpt-text">AI English Teacher</h1>
            <p className="text-xs text-chatgpt-muted">Grammar · Vocabulary · Writing</p>
          </div>
        </div>
        <UpgradeButton
          checkoutUrl={checkoutUrl}
          remainingFree={status.remaining_free}
          freeLimit={status.free_limit}
          isPaid={status.paid}
        />
      </div>

      {/* 会話エリア */}
      <div className="flex-1">
        <AnswerDisplay
          history={history}
          isLoading={isLoading}
          currentQuestion={currentQuestion}
        />
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="rounded-xl bg-chatgpt-surface border border-chatgpt-border px-3 py-2.5">
          <p className="text-xs text-chatgpt-muted">{error}</p>
          {checkoutUrl && (
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 px-3 py-1.5 rounded-lg bg-chatgpt-accent
                         text-white text-xs font-semibold hover:bg-chatgpt-accentHover transition-colors"
            >
              Upgrade to Premium →
            </a>
          )}
        </div>
      )}

      {/* 入力エリア */}
      <QuestionForm
        onSubmit={handleQuestion}
        isLoading={isLoading}
        disabled={!status.can_ask && !status.paid}
      />

      {/* フッター */}
      <p className="text-center text-xs text-chatgpt-muted">
        Powered by GPT-4o-mini · {status.paid ? 'Premium Plan' : `${status.remaining_free}/${status.free_limit} free questions`}
      </p>
    </div>
  )
}
