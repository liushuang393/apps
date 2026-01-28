import { Router, Request, Response } from 'express';
import { currencyService, SupportedCurrency } from '../services/CurrencyService';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /currencies
 * Get all supported currencies
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const currencies = currencyService.getSupportedCurrencies();
    
    res.json({
      currencies: currencies.map(c => ({
        code: c.code,
        symbol: c.symbol,
        name: c.name,
        nameChinese: c.nameChinese,
        decimalPlaces: c.decimalPlaces,
      })),
    });
  } catch (error) {
    logger.error('Error getting currencies', { error });
    res.status(500).json({ error: 'Failed to get currencies' });
  }
});

/**
 * GET /currencies/rates
 * Get current exchange rates
 */
router.get('/rates', (_req: Request, res: Response) => {
  try {
    const rates = currencyService.getAllExchangeRates();
    
    res.json({
      baseCurrency: 'usd',
      rates: rates.map(r => ({
        currency: r.currency,
        rateFromUSD: r.rateFromUSD,
        lastUpdated: r.lastUpdated,
      })),
    });
  } catch (error) {
    logger.error('Error getting exchange rates', { error });
    res.status(500).json({ error: 'Failed to get exchange rates' });
  }
});

/**
 * POST /currencies/convert
 * Convert amount between currencies
 */
router.post('/convert', (req: Request, res: Response) => {
  try {
    const { amount, fromCurrency, toCurrency } = req.body;

    // Validate input
    if (typeof amount !== 'number' || amount < 0) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    if (!currencyService.isSupportedCurrency(fromCurrency)) {
      res.status(400).json({ error: `Unsupported currency: ${fromCurrency}` });
      return;
    }

    if (!currencyService.isSupportedCurrency(toCurrency)) {
      res.status(400).json({ error: `Unsupported currency: ${toCurrency}` });
      return;
    }

    const convertedAmount = currencyService.convertAmount(
      amount,
      fromCurrency as SupportedCurrency,
      toCurrency as SupportedCurrency
    );

    const rateInfo = currencyService.getExchangeRateDisplay(
      fromCurrency as SupportedCurrency,
      toCurrency as SupportedCurrency
    );

    res.json({
      originalAmount: amount,
      originalCurrency: fromCurrency,
      originalFormatted: currencyService.formatAmount(amount, fromCurrency as SupportedCurrency),
      convertedAmount,
      convertedCurrency: toCurrency,
      convertedFormatted: currencyService.formatAmount(convertedAmount, toCurrency as SupportedCurrency),
      exchangeRate: rateInfo?.rate,
      exchangeRateDisplay: rateInfo?.display,
    });
  } catch (error) {
    logger.error('Error converting currency', { error });
    res.status(500).json({ error: 'Failed to convert currency' });
  }
});

/**
 * POST /currencies/convert-all
 * Convert USD amount to all supported currencies
 */
router.post('/convert-all', (req: Request, res: Response) => {
  try {
    const { amount } = req.body;

    // Validate input
    if (typeof amount !== 'number' || amount < 0) {
      res.status(400).json({ error: 'Invalid amount (must be positive number in USD cents)' });
      return;
    }

    const prices = currencyService.convertToAllCurrencies(amount);

    res.json({
      originalAmount: amount,
      originalCurrency: 'usd',
      prices: {
        usd: {
          amount: prices.usd,
          formatted: currencyService.formatAmount(prices.usd, 'usd'),
        },
        cny: {
          amount: prices.cny,
          formatted: currencyService.formatAmount(prices.cny, 'cny'),
        },
        jpy: {
          amount: prices.jpy,
          formatted: currencyService.formatAmount(prices.jpy, 'jpy'),
        },
        eur: {
          amount: prices.eur,
          formatted: currencyService.formatAmount(prices.eur, 'eur'),
        },
      },
    });
  } catch (error) {
    logger.error('Error converting to all currencies', { error });
    res.status(500).json({ error: 'Failed to convert currencies' });
  }
});

/**
 * GET /currencies/:code
 * Get details for a specific currency
 */
router.get('/:code', (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    if (!currencyService.isSupportedCurrency(code.toLowerCase())) {
      res.status(404).json({ error: `Currency not supported: ${code}` });
      return;
    }

    const currency = code.toLowerCase() as SupportedCurrency;
    const config = currencyService.getCurrencyConfig(currency);
    const rate = currencyService.getExchangeRate(currency);

    res.json({
      code: config.code,
      symbol: config.symbol,
      name: config.name,
      nameChinese: config.nameChinese,
      decimalPlaces: config.decimalPlaces,
      symbolPosition: config.symbolPosition,
      minimumCharge: config.stripeMinimumCharge,
      minimumChargeFormatted: currencyService.formatAmount(config.stripeMinimumCharge, currency),
      exchangeRate: rate ? {
        rateFromUSD: rate.rateFromUSD,
        rateToUSD: rate.rateToUSD,
        lastUpdated: rate.lastUpdated,
      } : null,
    });
  } catch (error) {
    logger.error('Error getting currency details', { error });
    res.status(500).json({ error: 'Failed to get currency details' });
  }
});

/**
 * POST /currencies/format
 * Format an amount for display
 */
router.post('/format', (req: Request, res: Response) => {
  try {
    const { amount, currency, locale } = req.body;

    if (typeof amount !== 'number') {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    if (!currencyService.isSupportedCurrency(currency)) {
      res.status(400).json({ error: `Unsupported currency: ${currency}` });
      return;
    }

    const curr = currency.toLowerCase() as SupportedCurrency;

    res.json({
      amount,
      currency: curr,
      formatted: currencyService.formatAmount(amount, curr),
      localizedFormatted: currencyService.formatAmountLocalized(amount, curr, locale || 'en-US'),
    });
  } catch (error) {
    logger.error('Error formatting amount', { error });
    res.status(500).json({ error: 'Failed to format amount' });
  }
});

/**
 * POST /currencies/validate-minimum
 * Validate if amount meets minimum charge requirement
 */
router.post('/validate-minimum', (req: Request, res: Response) => {
  try {
    const { amount, currency } = req.body;

    if (typeof amount !== 'number') {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    if (!currencyService.isSupportedCurrency(currency)) {
      res.status(400).json({ error: `Unsupported currency: ${currency}` });
      return;
    }

    const curr = currency.toLowerCase() as SupportedCurrency;
    const validation = currencyService.validateMinimumCharge(amount, curr);

    res.json({
      amount,
      currency: curr,
      valid: validation.valid,
      minimumAmount: validation.minimumAmount,
      minimumFormatted: validation.formattedMinimum,
      message: validation.valid 
        ? 'Amount meets minimum requirement' 
        : `Amount must be at least ${validation.formattedMinimum}`,
    });
  } catch (error) {
    logger.error('Error validating minimum charge', { error });
    res.status(500).json({ error: 'Failed to validate minimum charge' });
  }
});

export default router;
