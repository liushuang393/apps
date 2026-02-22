interface UpgradeButtonProps {
  checkoutUrl?: string
  remainingFree: number
  freeLimit: number
  isPaid: boolean
}

export function UpgradeButton({
  checkoutUrl,
  remainingFree,
  freeLimit,
  isPaid,
}: UpgradeButtonProps) {
  if (isPaid) {
    // 有料ユーザーにはプレミアムバッジを表示
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                      bg-chatgpt-accent bg-opacity-20 border border-chatgpt-accent
                      text-chatgpt-accent text-xs font-medium">
        <span>⭐</span>
        <span>Premium</span>
      </div>
    )
  }

  const isAtLimit = remainingFree === 0

  return (
    <div className="space-y-2">
      {/* 無料残り回数のインジケーター */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {Array.from({ length: freeLimit }, (_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i < (freeLimit - remainingFree)
                  ? 'bg-chatgpt-muted'
                  : 'bg-chatgpt-accent'
              }`}
            />
          ))}
        </div>
        <span className="text-xs text-chatgpt-muted">
          {remainingFree > 0
            ? `${remainingFree} free ${remainingFree === 1 ? 'question' : 'questions'} left`
            : 'Free limit reached'}
        </span>
      </div>

      {/* 無料上限に達した場合のアップグレードバナー */}
      {isAtLimit && checkoutUrl && (
        <div className="rounded-xl bg-gradient-to-r from-chatgpt-accent to-teal-500
                        p-0.5">
          <div className="rounded-[10px] bg-chatgpt-bg px-3 py-2.5 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-chatgpt-text">
                Unlock Unlimited Access
              </p>
              <p className="text-xs text-chatgpt-muted">
                Get detailed answers, examples & more
              </p>
            </div>
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-chatgpt-accent text-white
                         text-xs font-semibold hover:bg-chatgpt-accentHover transition-colors"
            >
              Upgrade →
            </a>
          </div>
        </div>
      )}

      {/* 上限に達したが URL がない場合の案内 */}
      {isAtLimit && !checkoutUrl && (
        <p className="text-xs text-chatgpt-muted">
          Free limit reached. Type "upgrade" to get the payment link.
        </p>
      )}
    </div>
  )
}
