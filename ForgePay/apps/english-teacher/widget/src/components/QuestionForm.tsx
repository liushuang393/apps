import React, { useState } from 'react'

interface QuestionFormProps {
  onSubmit: (question: string) => void
  isLoading: boolean
  disabled: boolean
}

const EXAMPLE_QUESTIONS = [
  'Please correct my grammar: "Yesterday I go to school."',
  'What is the difference between "affect" and "effect"?',
  'How do I use the present perfect tense?',
  'Can you help me write a professional email to my boss?',
]

export function QuestionForm({ onSubmit, isLoading, disabled }: QuestionFormProps) {
  const [question, setQuestion] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || isLoading) return
    onSubmit(trimmed)
    setQuestion('')
  }

  function handleExampleClick(example: string) {
    setQuestion(example)
  }

  return (
    <div className="space-y-3">
      {/* 質問例の提示（入力欄が空の場合のみ表示） */}
      {!question && !isLoading && (
        <div className="space-y-1">
          <p className="text-xs text-chatgpt-muted">Try asking:</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_QUESTIONS.map((example) => (
              <button
                key={example}
                onClick={() => handleExampleClick(example)}
                disabled={disabled}
                className="text-xs px-2.5 py-1 rounded-full border border-chatgpt-border
                           text-chatgpt-muted hover:text-chatgpt-text hover:border-chatgpt-accent
                           transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {example.length > 40 ? example.slice(0, 40) + '…' : example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 質問入力フォーム */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask your English question here..."
          disabled={disabled || isLoading}
          rows={2}
          maxLength={2000}
          className="flex-1 resize-none rounded-xl bg-chatgpt-surface border border-chatgpt-border
                     text-chatgpt-text placeholder-chatgpt-muted text-sm px-3 py-2
                     focus:outline-none focus:ring-1 focus:ring-chatgpt-accent
                     disabled:opacity-40 disabled:cursor-not-allowed"
          onKeyDown={(e) => {
            // Shift+Enter で送信（改行は通常の Enter）
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
        />
        <button
          type="submit"
          disabled={!question.trim() || isLoading || disabled}
          className="self-end px-4 py-2 rounded-xl bg-chatgpt-accent text-white text-sm font-medium
                     hover:bg-chatgpt-accentHover transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="flex gap-1 items-center">
              <span className="loading-dot w-1.5 h-1.5 rounded-full bg-white inline-block" />
              <span className="loading-dot w-1.5 h-1.5 rounded-full bg-white inline-block" />
              <span className="loading-dot w-1.5 h-1.5 rounded-full bg-white inline-block" />
            </span>
          ) : (
            'Ask'
          )}
        </button>
      </form>

      {/* 文字数カウンター */}
      {question.length > 1800 && (
        <p className="text-xs text-right text-chatgpt-muted">
          {question.length}/2000
        </p>
      )}
    </div>
  )
}
