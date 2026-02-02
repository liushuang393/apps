import { SupportedCurrency } from '../lib/api'
import { useCurrency, CURRENCY_CONFIGS } from '../hooks/useCurrency'

interface CurrencySelectorProps {
  value: SupportedCurrency
  onChange: (currency: SupportedCurrency) => void
  showName?: boolean
  className?: string
}

export function CurrencySelector({
  value,
  onChange,
  showName = false,
  className = '',
}: CurrencySelectorProps) {
  const { currencies } = useCurrency()

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SupportedCurrency)}
      className={`px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white ${className}`}
    >
      {currencies.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {showName
            ? `${currency.symbol} ${currency.name} (${currency.code.toUpperCase()})`
            : `${currency.symbol} ${currency.code.toUpperCase()}`}
        </option>
      ))}
    </select>
  )
}

interface CurrencyDisplayProps {
  amount: number
  currency: SupportedCurrency
  showCode?: boolean
  className?: string
}

export function CurrencyDisplay({
  amount,
  currency,
  showCode = false,
  className = '',
}: CurrencyDisplayProps) {
  const { formatWithSymbol } = useCurrency()
  const config = CURRENCY_CONFIGS[currency]

  return (
    <span className={className}>
      {formatWithSymbol(amount, currency)}
      {showCode && <span className="text-gray-500 ml-1">{currency.toUpperCase()}</span>}
    </span>
  )
}

interface MultiCurrencyDisplayProps {
  baseAmount: number // Amount in base currency (smallest unit)
  baseCurrency?: SupportedCurrency
  showAll?: boolean
  className?: string
}

export function MultiCurrencyDisplay({
  baseAmount,
  baseCurrency = 'usd',
  showAll = false,
  className = '',
}: MultiCurrencyDisplayProps) {
  const { formatWithSymbol, convertAmount } = useCurrency()

  if (!showAll) {
    return (
      <span className={className}>
        {formatWithSymbol(baseAmount, baseCurrency)}
      </span>
    )
  }

  const currencies: SupportedCurrency[] = ['usd', 'cny', 'jpy', 'eur']

  return (
    <div className={`space-y-1 ${className}`}>
      {currencies.map((currency) => {
        const amount = currency === baseCurrency
          ? baseAmount
          : convertAmount(baseAmount, baseCurrency, currency)
        
        return (
          <div key={currency} className="flex justify-between text-sm">
            <span className="text-gray-500">{CURRENCY_CONFIGS[currency].nameChinese}</span>
            <span className="font-medium">{formatWithSymbol(amount, currency)}</span>
          </div>
        )
      })}
    </div>
  )
}

interface CurrencyInputProps {
  value: number
  currency: SupportedCurrency
  onChange: (amount: number) => void
  onCurrencyChange?: (currency: SupportedCurrency) => void
  showCurrencySelector?: boolean
  placeholder?: string
  className?: string
}

export function CurrencyInput({
  value,
  currency,
  onChange,
  onCurrencyChange,
  showCurrencySelector = false,
  placeholder = '0.00',
  className = '',
}: CurrencyInputProps) {
  const config = CURRENCY_CONFIGS[currency]

  // Convert from smallest unit to display unit
  const displayValue = value / Math.pow(10, config.decimalPlaces)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = parseFloat(e.target.value) || 0
    // Convert to smallest unit
    const smallestUnit = Math.round(inputValue * Math.pow(10, config.decimalPlaces))
    onChange(smallestUnit)
  }

  return (
    <div className={`flex ${className}`}>
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
          {config.symbol}
        </span>
        <input
          type="number"
          value={displayValue || ''}
          onChange={handleChange}
          placeholder={placeholder}
          step={config.decimalPlaces === 0 ? '1' : '0.01'}
          min="0"
          className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
      </div>
      {showCurrencySelector && onCurrencyChange && (
        <CurrencySelector
          value={currency}
          onChange={onCurrencyChange}
          className="ml-2"
        />
      )}
    </div>
  )
}
