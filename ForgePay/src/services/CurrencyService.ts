import { logger } from '../utils/logger';

/**
 * Supported currency codes
 */
export type SupportedCurrency = 'usd' | 'cny' | 'jpy' | 'eur';

/**
 * Currency configuration
 */
export interface CurrencyConfig {
  code: SupportedCurrency;
  symbol: string;
  name: string;
  nameChinese: string;
  decimalPlaces: number;
  symbolPosition: 'before' | 'after';
  thousandsSeparator: string;
  decimalSeparator: string;
  stripeMinimumCharge: number; // Minimum charge in smallest currency unit
}

/**
 * Exchange rate (relative to USD)
 */
export interface ExchangeRate {
  currency: SupportedCurrency;
  rateToUSD: number;
  rateFromUSD: number;
  lastUpdated: Date;
}

/**
 * Price in multiple currencies
 */
export interface MultiCurrencyPrice {
  usd: number;
  cny: number;
  jpy: number;
  eur: number;
}

/**
 * Currency configurations
 */
const CURRENCY_CONFIGS: Record<SupportedCurrency, CurrencyConfig> = {
  usd: {
    code: 'usd',
    symbol: '$',
    name: 'US Dollar',
    nameChinese: '美元',
    decimalPlaces: 2,
    symbolPosition: 'before',
    thousandsSeparator: ',',
    decimalSeparator: '.',
    stripeMinimumCharge: 50, // $0.50
  },
  cny: {
    code: 'cny',
    symbol: '¥',
    name: 'Chinese Yuan',
    nameChinese: '人民币',
    decimalPlaces: 2,
    symbolPosition: 'before',
    thousandsSeparator: ',',
    decimalSeparator: '.',
    stripeMinimumCharge: 400, // ¥4.00
  },
  jpy: {
    code: 'jpy',
    symbol: '¥',
    name: 'Japanese Yen',
    nameChinese: '日元',
    decimalPlaces: 0, // JPY has no decimal places
    symbolPosition: 'before',
    thousandsSeparator: ',',
    decimalSeparator: '.',
    stripeMinimumCharge: 50, // ¥50
  },
  eur: {
    code: 'eur',
    symbol: '€',
    name: 'Euro',
    nameChinese: '欧元',
    decimalPlaces: 2,
    symbolPosition: 'before',
    thousandsSeparator: '.',
    decimalSeparator: ',',
    stripeMinimumCharge: 50, // €0.50
  },
};

/**
 * Default exchange rates (fallback when API unavailable)
 * These should be updated regularly in production
 */
const DEFAULT_EXCHANGE_RATES: Record<SupportedCurrency, number> = {
  usd: 1.0,
  cny: 7.25,    // 1 USD = 7.25 CNY
  jpy: 149.50,  // 1 USD = 149.50 JPY
  eur: 0.92,    // 1 USD = 0.92 EUR
};

/**
 * CurrencyService handles multi-currency support
 * 
 * Responsibilities:
 * - Currency configuration and metadata
 * - Exchange rate management
 * - Price conversion between currencies
 * - Currency formatting for display
 * 
 * Requirements: 6.1, 6.2, 6.4
 */
export class CurrencyService {
  private exchangeRates: Map<SupportedCurrency, ExchangeRate>;
  private lastFetchTime: Date | null = null;
  private readonly RATE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor() {
    this.exchangeRates = new Map();
    this.initializeDefaultRates();
  }

  /**
   * Initialize with default exchange rates
   */
  private initializeDefaultRates(): void {
    const now = new Date();
    
    for (const [currency, rate] of Object.entries(DEFAULT_EXCHANGE_RATES)) {
      this.exchangeRates.set(currency as SupportedCurrency, {
        currency: currency as SupportedCurrency,
        rateToUSD: 1 / rate,
        rateFromUSD: rate,
        lastUpdated: now,
      });
    }
  }

  /**
   * Get all supported currencies
   */
  getSupportedCurrencies(): CurrencyConfig[] {
    return Object.values(CURRENCY_CONFIGS);
  }

  /**
   * Get configuration for a specific currency
   */
  getCurrencyConfig(currency: SupportedCurrency): CurrencyConfig {
    return CURRENCY_CONFIGS[currency];
  }

  /**
   * Check if a currency is supported
   */
  isSupportedCurrency(currency: string): currency is SupportedCurrency {
    return currency.toLowerCase() in CURRENCY_CONFIGS;
  }

  /**
   * Get current exchange rate for a currency
   */
  getExchangeRate(currency: SupportedCurrency): ExchangeRate | null {
    return this.exchangeRates.get(currency) || null;
  }

  /**
   * Get all current exchange rates
   */
  getAllExchangeRates(): ExchangeRate[] {
    return Array.from(this.exchangeRates.values());
  }

  /**
   * Convert amount from one currency to another
   * 
   * @param amount - Amount in smallest currency unit (cents, yen, etc.)
   * @param fromCurrency - Source currency
   * @param toCurrency - Target currency
   * @returns Converted amount in smallest currency unit
   */
  convertAmount(
    amount: number,
    fromCurrency: SupportedCurrency,
    toCurrency: SupportedCurrency
  ): number {
    if (fromCurrency === toCurrency) {
      return amount;
    }

    const fromRate = this.exchangeRates.get(fromCurrency);
    const toRate = this.exchangeRates.get(toCurrency);

    if (!fromRate || !toRate) {
      logger.warn('Exchange rate not found', { fromCurrency, toCurrency });
      return amount;
    }

    // Convert to USD first, then to target currency
    const fromConfig = CURRENCY_CONFIGS[fromCurrency];
    const toConfig = CURRENCY_CONFIGS[toCurrency];

    // Convert from smallest unit to major unit
    const majorAmount = amount / Math.pow(10, fromConfig.decimalPlaces);
    
    // Convert to USD
    const usdAmount = majorAmount * fromRate.rateToUSD;
    
    // Convert to target currency
    const targetMajorAmount = usdAmount * toRate.rateFromUSD;
    
    // Convert back to smallest unit
    const targetAmount = Math.round(targetMajorAmount * Math.pow(10, toConfig.decimalPlaces));

    return targetAmount;
  }

  /**
   * Convert a USD amount to all supported currencies
   * 
   * @param usdAmount - Amount in USD cents
   * @returns Prices in all currencies (in smallest units)
   */
  convertToAllCurrencies(usdAmount: number): MultiCurrencyPrice {
    return {
      usd: usdAmount,
      cny: this.convertAmount(usdAmount, 'usd', 'cny'),
      jpy: this.convertAmount(usdAmount, 'usd', 'jpy'),
      eur: this.convertAmount(usdAmount, 'usd', 'eur'),
    };
  }

  /**
   * Format amount for display
   * 
   * @param amount - Amount in smallest currency unit
   * @param currency - Currency code
   * @param options - Formatting options
   * @returns Formatted string
   */
  formatAmount(
    amount: number,
    currency: SupportedCurrency,
    options: {
      showSymbol?: boolean;
      showCode?: boolean;
    } = {}
  ): string {
    const { showSymbol = true, showCode = false } = options;
    const config = CURRENCY_CONFIGS[currency];

    // Convert from smallest unit to major unit
    const majorAmount = amount / Math.pow(10, config.decimalPlaces);

    // Format number
    let formatted: string;
    if (config.decimalPlaces === 0) {
      formatted = Math.round(majorAmount).toLocaleString('en-US');
    } else {
      formatted = majorAmount.toLocaleString('en-US', {
        minimumFractionDigits: config.decimalPlaces,
        maximumFractionDigits: config.decimalPlaces,
      });
    }

    // Replace separators based on currency config
    if (config.thousandsSeparator !== ',') {
      formatted = formatted.replace(/,/g, config.thousandsSeparator);
    }
    if (config.decimalSeparator !== '.') {
      formatted = formatted.replace(/\./g, config.decimalSeparator);
    }

    // Add symbol and/or code
    let result = formatted;
    if (showSymbol) {
      result = config.symbolPosition === 'before'
        ? `${config.symbol}${result}`
        : `${result}${config.symbol}`;
    }
    if (showCode) {
      result = `${result} ${currency.toUpperCase()}`;
    }

    return result;
  }

  /**
   * Format amount for display in a specific locale
   */
  formatAmountLocalized(
    amount: number,
    currency: SupportedCurrency,
    locale: string = 'en-US'
  ): string {
    const config = CURRENCY_CONFIGS[currency];
    const majorAmount = amount / Math.pow(10, config.decimalPlaces);

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: config.decimalPlaces,
      maximumFractionDigits: config.decimalPlaces,
    }).format(majorAmount);
  }

  /**
   * Parse a formatted amount string back to smallest currency unit
   */
  parseAmount(formattedAmount: string, currency: SupportedCurrency): number {
    const config = CURRENCY_CONFIGS[currency];

    // Remove currency symbol and code
    let cleaned = formattedAmount
      .replace(config.symbol, '')
      .replace(currency.toUpperCase(), '')
      .trim();

    // Normalize separators
    if (config.thousandsSeparator !== ',') {
      cleaned = cleaned.replace(new RegExp(`\\${config.thousandsSeparator}`, 'g'), '');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
    if (config.decimalSeparator !== '.') {
      cleaned = cleaned.replace(config.decimalSeparator, '.');
    }

    const majorAmount = parseFloat(cleaned);
    if (isNaN(majorAmount)) {
      return 0;
    }

    return Math.round(majorAmount * Math.pow(10, config.decimalPlaces));
  }

  /**
   * Validate that an amount meets the minimum charge requirement
   */
  validateMinimumCharge(amount: number, currency: SupportedCurrency): {
    valid: boolean;
    minimumAmount: number;
    formattedMinimum: string;
  } {
    const config = CURRENCY_CONFIGS[currency];
    const valid = amount >= config.stripeMinimumCharge;

    return {
      valid,
      minimumAmount: config.stripeMinimumCharge,
      formattedMinimum: this.formatAmount(config.stripeMinimumCharge, currency),
    };
  }

  /**
   * Update exchange rates from external API
   * This should be called periodically (e.g., every hour)
   */
  async updateExchangeRates(): Promise<void> {
    // Check if rates are still fresh
    if (this.lastFetchTime && 
        Date.now() - this.lastFetchTime.getTime() < this.RATE_CACHE_TTL) {
      return;
    }

    try {
      // In production, you would fetch from an exchange rate API
      // Example: Open Exchange Rates, Fixer.io, or CurrencyLayer
      // For now, we use the default rates
      
      // Simulated API call
      // const response = await fetch(`https://api.exchangerate-api.com/v4/latest/USD`);
      // const data = await response.json();
      
      logger.info('Exchange rates updated (using default rates)');
      this.lastFetchTime = new Date();
      this.initializeDefaultRates();
    } catch (error) {
      logger.error('Failed to update exchange rates', { error });
      // Keep using existing rates on failure
    }
  }

  /**
   * Set custom exchange rates (for testing or manual override)
   */
  setExchangeRate(currency: SupportedCurrency, rateFromUSD: number): void {
    this.exchangeRates.set(currency, {
      currency,
      rateToUSD: 1 / rateFromUSD,
      rateFromUSD,
      lastUpdated: new Date(),
    });

    logger.info('Exchange rate manually updated', { currency, rateFromUSD });
  }

  /**
   * Get exchange rate display info for checkout
   */
  getExchangeRateDisplay(
    fromCurrency: SupportedCurrency,
    toCurrency: SupportedCurrency
  ): {
    rate: number;
    display: string;
    lastUpdated: Date;
  } | null {
    const fromRate = this.exchangeRates.get(fromCurrency);
    const toRate = this.exchangeRates.get(toCurrency);

    if (!fromRate || !toRate) {
      return null;
    }

    const rate = fromRate.rateToUSD * toRate.rateFromUSD;
    const fromConfig = CURRENCY_CONFIGS[fromCurrency];
    const toConfig = CURRENCY_CONFIGS[toCurrency];

    return {
      rate,
      display: `1 ${fromConfig.symbol} = ${rate.toFixed(4)} ${toConfig.symbol}`,
      lastUpdated: fromRate.lastUpdated > toRate.lastUpdated 
        ? fromRate.lastUpdated 
        : toRate.lastUpdated,
    };
  }
}

// Export singleton instance
export const currencyService = new CurrencyService();

// Export types for use in other modules
export { CURRENCY_CONFIGS };
