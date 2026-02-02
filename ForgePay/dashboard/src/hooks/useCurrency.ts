import { useQuery } from '@tanstack/react-query'
import { currencyApi, SupportedCurrency, CurrencyInfo, ExchangeRate } from '../lib/api'

// Currency configurations (client-side fallback)
const CURRENCY_CONFIGS: Record<SupportedCurrency, CurrencyInfo> = {
  usd: {
    code: 'usd',
    symbol: '$',
    name: 'US Dollar',
    nameChinese: '美元',
    decimalPlaces: 2,
  },
  cny: {
    code: 'cny',
    symbol: '¥',
    name: 'Chinese Yuan',
    nameChinese: '人民币',
    decimalPlaces: 2,
  },
  jpy: {
    code: 'jpy',
    symbol: '¥',
    name: 'Japanese Yen',
    nameChinese: '日元',
    decimalPlaces: 0,
  },
  eur: {
    code: 'eur',
    symbol: '€',
    name: 'Euro',
    nameChinese: '欧元',
    decimalPlaces: 2,
  },
}

export function useCurrencies() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['currencies'],
    queryFn: () => currencyApi.getCurrencies(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const currencies = data?.data?.currencies || Object.values(CURRENCY_CONFIGS)

  return { currencies, isLoading, error }
}

export function useExchangeRates() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['exchangeRates'],
    queryFn: () => currencyApi.getRates(),
    staleTime: 60 * 60 * 1000, // 1 hour
  })

  const rates = data?.data?.rates || []

  return { rates, isLoading, error }
}

export function useCurrency() {
  const { currencies, isLoading: currenciesLoading } = useCurrencies()
  const { rates, isLoading: ratesLoading } = useExchangeRates()

  /**
   * Format amount for display
   */
  const formatAmount = (amount: number, currency: SupportedCurrency): string => {
    const config = CURRENCY_CONFIGS[currency]
    const majorAmount = amount / Math.pow(10, config.decimalPlaces)

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: config.decimalPlaces,
      maximumFractionDigits: config.decimalPlaces,
    }).format(majorAmount)
  }

  /**
   * Format amount with symbol only
   */
  const formatWithSymbol = (amount: number, currency: SupportedCurrency): string => {
    const config = CURRENCY_CONFIGS[currency]
    const majorAmount = amount / Math.pow(10, config.decimalPlaces)

    let formatted: string
    if (config.decimalPlaces === 0) {
      formatted = Math.round(majorAmount).toLocaleString()
    } else {
      formatted = majorAmount.toLocaleString('en-US', {
        minimumFractionDigits: config.decimalPlaces,
        maximumFractionDigits: config.decimalPlaces,
      })
    }

    return `${config.symbol}${formatted}`
  }

  /**
   * Get currency config
   */
  const getCurrencyConfig = (currency: SupportedCurrency): CurrencyInfo => {
    return CURRENCY_CONFIGS[currency]
  }

  /**
   * Convert amount between currencies
   */
  const convertAmount = (
    amount: number,
    fromCurrency: SupportedCurrency,
    toCurrency: SupportedCurrency
  ): number => {
    if (fromCurrency === toCurrency) return amount

    const fromRate = rates.find((r: ExchangeRate) => r.currency === fromCurrency)
    const toRate = rates.find((r: ExchangeRate) => r.currency === toCurrency)

    if (!fromRate || !toRate) return amount

    // Convert to USD first
    const usdAmount = amount / fromRate.rateFromUSD
    // Then to target currency
    return Math.round(usdAmount * toRate.rateFromUSD)
  }

  return {
    currencies,
    rates,
    isLoading: currenciesLoading || ratesLoading,
    formatAmount,
    formatWithSymbol,
    getCurrencyConfig,
    convertAmount,
  }
}

export { CURRENCY_CONFIGS }
