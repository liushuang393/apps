interface QandA {
  question: string
  answer: string
  timestamp: Date
  isPaid: boolean
}

interface AnswerDisplayProps {
  history: QandA[]
  isLoading: boolean
  currentQuestion?: string
}

export function AnswerDisplay({ history, isLoading, currentQuestion }: AnswerDisplayProps) {
  if (history.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-chatgpt-muted">
        <div className="text-3xl mb-3">📚</div>
        <p className="text-sm text-center">
          Ask me anything about English!
          <br />
          <span className="text-xs">Grammar, vocabulary, writing, pronunciation...</span>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
      {/* 過去の Q&A 履歴 */}
      {history.map((item, index) => (
        <div key={index} className="fade-in space-y-2">
          {/* 質問 */}
          <div className="flex justify-end">
            <div className="max-w-xs bg-chatgpt-accent text-white text-sm px-3 py-2 rounded-2xl rounded-tr-sm">
              {item.question}
            </div>
          </div>

          {/* 回答 */}
          <div className="flex justify-start gap-2">
            <div className="w-6 h-6 rounded-full bg-chatgpt-surface border border-chatgpt-border
                            flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
              🎓
            </div>
            <div className="max-w-sm bg-chatgpt-surface border border-chatgpt-border
                            text-chatgpt-text text-sm px-3 py-2 rounded-2xl rounded-tl-sm
                            whitespace-pre-wrap leading-relaxed">
              {item.answer}
              {!item.isPaid && (
                <p className="text-xs text-chatgpt-muted mt-2 border-t border-chatgpt-border pt-1">
                  Free tier response
                </p>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* ローディング中の表示 */}
      {isLoading && (
        <div className="fade-in space-y-2">
          {currentQuestion && (
            <div className="flex justify-end">
              <div className="max-w-xs bg-chatgpt-accent text-white text-sm px-3 py-2 rounded-2xl rounded-tr-sm">
                {currentQuestion}
              </div>
            </div>
          )}
          <div className="flex justify-start gap-2">
            <div className="w-6 h-6 rounded-full bg-chatgpt-surface border border-chatgpt-border
                            flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
              🎓
            </div>
            <div className="bg-chatgpt-surface border border-chatgpt-border px-3 py-3 rounded-2xl rounded-tl-sm">
              <span className="flex gap-1 items-center">
                <span className="loading-dot w-2 h-2 rounded-full bg-chatgpt-muted inline-block" />
                <span className="loading-dot w-2 h-2 rounded-full bg-chatgpt-muted inline-block" />
                <span className="loading-dot w-2 h-2 rounded-full bg-chatgpt-muted inline-block" />
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
