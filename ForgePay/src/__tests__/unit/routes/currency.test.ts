import express, { Express } from 'express';
import request from 'supertest';
import currencyRouter from '../../../routes/currency';

// Mock dependencies
jest.mock('../../../services/CurrencyService', () => {
  const mockCurrencyService = {
    getSupportedCurrencies: jest.fn(),
    getAllExchangeRates: jest.fn(),
    isSupportedCurrency: jest.fn(),
    convertAmount: jest.fn(),
    getExchangeRateDisplay: jest.fn(),
    formatAmount: jest.fn(),
    convertToAllCurrencies: jest.fn(),
    getCurrencyConfig: jest.fn(),
    getExchangeRate: jest.fn(),
    formatAmountLocalized: jest.fn(),
    validateMinimumCharge: jest.fn(),
  };

  return {
    currencyService: mockCurrencyService,
    SupportedCurrency: {},
  };
});

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { currencyService } from '../../../services/CurrencyService';

const mockCurrencyService = currencyService as jest.Mocked<typeof currencyService>;

describe('Currency Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/currencies', currencyRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /currencies', () => {
    const mockCurrencies = [
      {
        code: 'usd',
        symbol: '$',
        name: 'US Dollar',
        nameChinese: '美元',
        decimalPlaces: 2,
      },
      {
        code: 'cny',
        symbol: '¥',
        name: 'Chinese Yuan',
        nameChinese: '人民币',
        decimalPlaces: 2,
      },
      {
        code: 'jpy',
        symbol: '¥',
        name: 'Japanese Yen',
        nameChinese: '日元',
        decimalPlaces: 0,
      },
      {
        code: 'eur',
        symbol: '€',
        name: 'Euro',
        nameChinese: '欧元',
        decimalPlaces: 2,
      },
    ];

    it('should return all supported currencies', async () => {
      mockCurrencyService.getSupportedCurrencies.mockReturnValue(mockCurrencies as any);

      const response = await request(app).get('/currencies');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('currencies');
      expect(response.body.currencies).toHaveLength(4);
      expect(response.body.currencies[0]).toEqual({
        code: 'usd',
        symbol: '$',
        name: 'US Dollar',
        nameChinese: '美元',
        decimalPlaces: 2,
      });
    });

    it('should return currencies with all expected fields', async () => {
      mockCurrencyService.getSupportedCurrencies.mockReturnValue(mockCurrencies as any);

      const response = await request(app).get('/currencies');

      expect(response.status).toBe(200);
      response.body.currencies.forEach((currency: any) => {
        expect(currency).toHaveProperty('code');
        expect(currency).toHaveProperty('symbol');
        expect(currency).toHaveProperty('name');
        expect(currency).toHaveProperty('nameChinese');
        expect(currency).toHaveProperty('decimalPlaces');
      });
    });

    it('should return empty array when no currencies configured', async () => {
      mockCurrencyService.getSupportedCurrencies.mockReturnValue([]);

      const response = await request(app).get('/currencies');

      expect(response.status).toBe(200);
      expect(response.body.currencies).toEqual([]);
    });

    it('should return 500 when service throws error', async () => {
      mockCurrencyService.getSupportedCurrencies.mockImplementation(() => {
        throw new Error('Service error');
      });

      const response = await request(app).get('/currencies');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get currencies' });
    });
  });

  describe('GET /currencies/rates', () => {
    const mockRates = [
      {
        currency: 'usd',
        rateFromUSD: 1.0,
        lastUpdated: new Date('2024-01-01T00:00:00.000Z'),
      },
      {
        currency: 'cny',
        rateFromUSD: 7.25,
        lastUpdated: new Date('2024-01-01T00:00:00.000Z'),
      },
      {
        currency: 'jpy',
        rateFromUSD: 149.5,
        lastUpdated: new Date('2024-01-01T00:00:00.000Z'),
      },
      {
        currency: 'eur',
        rateFromUSD: 0.92,
        lastUpdated: new Date('2024-01-01T00:00:00.000Z'),
      },
    ];

    it('should return all exchange rates', async () => {
      mockCurrencyService.getAllExchangeRates.mockReturnValue(mockRates as any);

      const response = await request(app).get('/currencies/rates');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('baseCurrency', 'usd');
      expect(response.body).toHaveProperty('rates');
      expect(response.body.rates).toHaveLength(4);
    });

    it('should return rates with expected fields', async () => {
      mockCurrencyService.getAllExchangeRates.mockReturnValue(mockRates as any);

      const response = await request(app).get('/currencies/rates');

      expect(response.status).toBe(200);
      response.body.rates.forEach((rate: any) => {
        expect(rate).toHaveProperty('currency');
        expect(rate).toHaveProperty('rateFromUSD');
        expect(rate).toHaveProperty('lastUpdated');
      });
    });

    it('should return correct rate values', async () => {
      mockCurrencyService.getAllExchangeRates.mockReturnValue(mockRates as any);

      const response = await request(app).get('/currencies/rates');

      const usdRate = response.body.rates.find((r: any) => r.currency === 'usd');
      expect(usdRate.rateFromUSD).toBe(1.0);

      const cnyRate = response.body.rates.find((r: any) => r.currency === 'cny');
      expect(cnyRate.rateFromUSD).toBe(7.25);
    });

    it('should return empty rates array when no rates available', async () => {
      mockCurrencyService.getAllExchangeRates.mockReturnValue([]);

      const response = await request(app).get('/currencies/rates');

      expect(response.status).toBe(200);
      expect(response.body.baseCurrency).toBe('usd');
      expect(response.body.rates).toEqual([]);
    });

    it('should return 500 when service throws error', async () => {
      mockCurrencyService.getAllExchangeRates.mockImplementation(() => {
        throw new Error('Service error');
      });

      const response = await request(app).get('/currencies/rates');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get exchange rates' });
    });
  });

  describe('POST /currencies/convert', () => {
    const mockConversionResult = {
      rate: 7.25,
      display: '1 $ = 7.2500 ¥',
      lastUpdated: new Date('2024-01-01T00:00:00.000Z'),
    };

    beforeEach(() => {
      mockCurrencyService.isSupportedCurrency.mockImplementation(
        (currency: string) => ['usd', 'cny', 'jpy', 'eur'].includes(currency?.toLowerCase())
      );
      mockCurrencyService.convertAmount.mockReturnValue(72500);
      mockCurrencyService.getExchangeRateDisplay.mockReturnValue(mockConversionResult as any);
      mockCurrencyService.formatAmount.mockImplementation((amount: number, currency: string) => {
        if (currency === 'usd') return `$${(amount / 100).toFixed(2)}`;
        if (currency === 'cny') return `¥${(amount / 100).toFixed(2)}`;
        return `${amount}`;
      });
    });

    it('should convert amount between currencies successfully', async () => {
      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 10000,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('originalAmount', 10000);
      expect(response.body).toHaveProperty('originalCurrency', 'usd');
      expect(response.body).toHaveProperty('convertedAmount', 72500);
      expect(response.body).toHaveProperty('convertedCurrency', 'cny');
      expect(response.body).toHaveProperty('exchangeRate', 7.25);
    });

    it('should include formatted amounts in response', async () => {
      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 10000,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('originalFormatted');
      expect(response.body).toHaveProperty('convertedFormatted');
      expect(response.body).toHaveProperty('exchangeRateDisplay');
    });

    it('should return 400 for invalid amount (string)', async () => {
      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 'invalid',
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount' });
    });

    it('should return 400 for negative amount', async () => {
      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: -100,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount' });
    });

    it('should return 400 for null amount', async () => {
      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: null,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount' });
    });

    it('should return 400 for unsupported fromCurrency', async () => {
      mockCurrencyService.isSupportedCurrency.mockImplementation(
        (currency: string) => currency === 'cny'
      );

      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 10000,
          fromCurrency: 'xxx',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Unsupported currency: xxx' });
    });

    it('should return 400 for unsupported toCurrency', async () => {
      mockCurrencyService.isSupportedCurrency
        .mockReturnValueOnce(true)  // fromCurrency check
        .mockReturnValueOnce(false); // toCurrency check

      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 10000,
          fromCurrency: 'usd',
          toCurrency: 'xxx',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Unsupported currency: xxx' });
    });

    it('should handle zero amount', async () => {
      mockCurrencyService.convertAmount.mockReturnValue(0);

      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 0,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(200);
      expect(response.body.convertedAmount).toBe(0);
    });

    it('should handle same currency conversion', async () => {
      mockCurrencyService.convertAmount.mockReturnValue(10000);

      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 10000,
          fromCurrency: 'usd',
          toCurrency: 'usd',
        });

      expect(response.status).toBe(200);
      expect(mockCurrencyService.convertAmount).toHaveBeenCalledWith(10000, 'usd', 'usd');
    });

    it('should return 500 when service throws error', async () => {
      mockCurrencyService.convertAmount.mockImplementation(() => {
        throw new Error('Conversion error');
      });

      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 10000,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to convert currency' });
    });

    it('should handle null exchange rate display', async () => {
      mockCurrencyService.getExchangeRateDisplay.mockReturnValue(null);

      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 10000,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(200);
      expect(response.body.exchangeRate).toBeUndefined();
      expect(response.body.exchangeRateDisplay).toBeUndefined();
    });
  });

  describe('POST /currencies/convert-all', () => {
    const mockPrices = {
      usd: 10000,
      cny: 72500,
      jpy: 14950,
      eur: 9200,
    };

    beforeEach(() => {
      mockCurrencyService.convertToAllCurrencies.mockReturnValue(mockPrices);
      mockCurrencyService.formatAmount.mockImplementation((amount: number, currency: string) => {
        const formats: Record<string, string> = {
          usd: `$${(amount / 100).toFixed(2)}`,
          cny: `¥${(amount / 100).toFixed(2)}`,
          jpy: `¥${amount}`,
          eur: `€${(amount / 100).toFixed(2)}`,
        };
        return formats[currency] || `${amount}`;
      });
    });

    it('should convert USD amount to all currencies', async () => {
      const response = await request(app)
        .post('/currencies/convert-all')
        .send({ amount: 10000 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('originalAmount', 10000);
      expect(response.body).toHaveProperty('originalCurrency', 'usd');
      expect(response.body).toHaveProperty('prices');
    });

    it('should return prices for all currencies', async () => {
      const response = await request(app)
        .post('/currencies/convert-all')
        .send({ amount: 10000 });

      expect(response.status).toBe(200);
      expect(response.body.prices).toHaveProperty('usd');
      expect(response.body.prices).toHaveProperty('cny');
      expect(response.body.prices).toHaveProperty('jpy');
      expect(response.body.prices).toHaveProperty('eur');
    });

    it('should include amount and formatted for each currency', async () => {
      const response = await request(app)
        .post('/currencies/convert-all')
        .send({ amount: 10000 });

      expect(response.status).toBe(200);
      expect(response.body.prices.usd).toHaveProperty('amount', 10000);
      expect(response.body.prices.usd).toHaveProperty('formatted');
      expect(response.body.prices.cny).toHaveProperty('amount', 72500);
      expect(response.body.prices.cny).toHaveProperty('formatted');
    });

    it('should return 400 for invalid amount', async () => {
      const response = await request(app)
        .post('/currencies/convert-all')
        .send({ amount: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount (must be positive number in USD cents)' });
    });

    it('should return 400 for negative amount', async () => {
      const response = await request(app)
        .post('/currencies/convert-all')
        .send({ amount: -100 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount (must be positive number in USD cents)' });
    });

    it('should return 400 for missing amount', async () => {
      const response = await request(app)
        .post('/currencies/convert-all')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount (must be positive number in USD cents)' });
    });

    it('should handle zero amount', async () => {
      mockCurrencyService.convertToAllCurrencies.mockReturnValue({
        usd: 0,
        cny: 0,
        jpy: 0,
        eur: 0,
      });

      const response = await request(app)
        .post('/currencies/convert-all')
        .send({ amount: 0 });

      expect(response.status).toBe(200);
      expect(response.body.prices.usd.amount).toBe(0);
    });

    it('should handle large amounts', async () => {
      mockCurrencyService.convertToAllCurrencies.mockReturnValue({
        usd: 100000000,
        cny: 725000000,
        jpy: 1495000000,
        eur: 92000000,
      });

      const response = await request(app)
        .post('/currencies/convert-all')
        .send({ amount: 100000000 });

      expect(response.status).toBe(200);
      expect(response.body.prices.usd.amount).toBe(100000000);
    });

    it('should return 500 when service throws error', async () => {
      mockCurrencyService.convertToAllCurrencies.mockImplementation(() => {
        throw new Error('Conversion error');
      });

      const response = await request(app)
        .post('/currencies/convert-all')
        .send({ amount: 10000 });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to convert currencies' });
    });
  });

  describe('GET /currencies/:code', () => {
    const mockCurrencyConfig = {
      code: 'usd',
      symbol: '$',
      name: 'US Dollar',
      nameChinese: '美元',
      decimalPlaces: 2,
      symbolPosition: 'before',
      stripeMinimumCharge: 50,
    };

    const mockExchangeRate = {
      currency: 'usd',
      rateFromUSD: 1.0,
      rateToUSD: 1.0,
      lastUpdated: new Date('2024-01-01T00:00:00.000Z'),
    };

    beforeEach(() => {
      mockCurrencyService.isSupportedCurrency.mockImplementation(
        (currency: string) => ['usd', 'cny', 'jpy', 'eur'].includes(currency?.toLowerCase())
      );
      mockCurrencyService.getCurrencyConfig.mockReturnValue(mockCurrencyConfig as any);
      mockCurrencyService.getExchangeRate.mockReturnValue(mockExchangeRate as any);
      mockCurrencyService.formatAmount.mockReturnValue('$0.50');
    });

    it('should return currency details for valid currency code', async () => {
      const response = await request(app).get('/currencies/usd');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('code', 'usd');
      expect(response.body).toHaveProperty('symbol', '$');
      expect(response.body).toHaveProperty('name', 'US Dollar');
      expect(response.body).toHaveProperty('nameChinese', '美元');
      expect(response.body).toHaveProperty('decimalPlaces', 2);
      expect(response.body).toHaveProperty('symbolPosition', 'before');
    });

    it('should return minimum charge info', async () => {
      const response = await request(app).get('/currencies/usd');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('minimumCharge', 50);
      expect(response.body).toHaveProperty('minimumChargeFormatted', '$0.50');
    });

    it('should return exchange rate info', async () => {
      const response = await request(app).get('/currencies/usd');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('exchangeRate');
      expect(response.body.exchangeRate).toHaveProperty('rateFromUSD', 1.0);
      expect(response.body.exchangeRate).toHaveProperty('rateToUSD', 1.0);
      expect(response.body.exchangeRate).toHaveProperty('lastUpdated');
    });

    it('should handle uppercase currency code', async () => {
      const response = await request(app).get('/currencies/USD');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('code', 'usd');
    });

    it('should handle mixed case currency code', async () => {
      const response = await request(app).get('/currencies/UsD');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('code', 'usd');
    });

    it('should return 404 for unsupported currency', async () => {
      mockCurrencyService.isSupportedCurrency.mockReturnValue(false);

      const response = await request(app).get('/currencies/xxx');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Currency not supported: xxx' });
    });

    it('should handle null exchange rate', async () => {
      mockCurrencyService.getExchangeRate.mockReturnValue(null);

      const response = await request(app).get('/currencies/usd');

      expect(response.status).toBe(200);
      expect(response.body.exchangeRate).toBeNull();
    });

    it('should return CNY currency details', async () => {
      mockCurrencyService.getCurrencyConfig.mockReturnValue({
        code: 'cny',
        symbol: '¥',
        name: 'Chinese Yuan',
        nameChinese: '人民币',
        decimalPlaces: 2,
        symbolPosition: 'before',
        stripeMinimumCharge: 400,
      } as any);
      mockCurrencyService.getExchangeRate.mockReturnValue({
        currency: 'cny',
        rateFromUSD: 7.25,
        rateToUSD: 0.138,
        lastUpdated: new Date('2024-01-01T00:00:00.000Z'),
      } as any);
      mockCurrencyService.formatAmount.mockReturnValue('¥4.00');

      const response = await request(app).get('/currencies/cny');

      expect(response.status).toBe(200);
      expect(response.body.code).toBe('cny');
      expect(response.body.symbol).toBe('¥');
      expect(response.body.exchangeRate.rateFromUSD).toBe(7.25);
    });

    it('should return JPY currency details with 0 decimal places', async () => {
      mockCurrencyService.getCurrencyConfig.mockReturnValue({
        code: 'jpy',
        symbol: '¥',
        name: 'Japanese Yen',
        nameChinese: '日元',
        decimalPlaces: 0,
        symbolPosition: 'before',
        stripeMinimumCharge: 50,
      } as any);
      mockCurrencyService.formatAmount.mockReturnValue('¥50');

      const response = await request(app).get('/currencies/jpy');

      expect(response.status).toBe(200);
      expect(response.body.decimalPlaces).toBe(0);
    });

    it('should return 500 when service throws error', async () => {
      mockCurrencyService.getCurrencyConfig.mockImplementation(() => {
        throw new Error('Service error');
      });

      const response = await request(app).get('/currencies/usd');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get currency details' });
    });
  });

  describe('POST /currencies/format', () => {
    beforeEach(() => {
      mockCurrencyService.isSupportedCurrency.mockImplementation(
        (currency: string) => ['usd', 'cny', 'jpy', 'eur'].includes(currency?.toLowerCase())
      );
      mockCurrencyService.formatAmount.mockReturnValue('$100.00');
      mockCurrencyService.formatAmountLocalized.mockReturnValue('$100.00');
    });

    it('should format amount successfully', async () => {
      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 10000,
          currency: 'usd',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('amount', 10000);
      expect(response.body).toHaveProperty('currency', 'usd');
      expect(response.body).toHaveProperty('formatted');
      expect(response.body).toHaveProperty('localizedFormatted');
    });

    it('should use default locale when not provided', async () => {
      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 10000,
          currency: 'usd',
        });

      expect(response.status).toBe(200);
      expect(mockCurrencyService.formatAmountLocalized).toHaveBeenCalledWith(10000, 'usd', 'en-US');
    });

    it('should use provided locale', async () => {
      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 10000,
          currency: 'usd',
          locale: 'zh-CN',
        });

      expect(response.status).toBe(200);
      expect(mockCurrencyService.formatAmountLocalized).toHaveBeenCalledWith(10000, 'usd', 'zh-CN');
    });

    it('should format CNY amounts correctly', async () => {
      mockCurrencyService.formatAmount.mockReturnValue('¥725.00');
      mockCurrencyService.formatAmountLocalized.mockReturnValue('¥725.00');

      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 72500,
          currency: 'cny',
        });

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe('cny');
    });

    it('should format JPY amounts without decimals', async () => {
      mockCurrencyService.formatAmount.mockReturnValue('¥1,495');
      mockCurrencyService.formatAmountLocalized.mockReturnValue('¥1,495');

      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 1495,
          currency: 'jpy',
        });

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe('jpy');
    });

    it('should return 400 for invalid amount', async () => {
      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 'invalid',
          currency: 'usd',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount' });
    });

    it('should return 400 for null amount', async () => {
      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: null,
          currency: 'usd',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount' });
    });

    it('should return 400 for unsupported currency', async () => {
      mockCurrencyService.isSupportedCurrency.mockReturnValue(false);

      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 10000,
          currency: 'xxx',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Unsupported currency: xxx' });
    });

    it('should handle negative amounts', async () => {
      mockCurrencyService.formatAmount.mockReturnValue('-$100.00');
      mockCurrencyService.formatAmountLocalized.mockReturnValue('-$100.00');

      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: -10000,
          currency: 'usd',
        });

      expect(response.status).toBe(200);
      expect(response.body.amount).toBe(-10000);
    });

    it('should handle zero amount', async () => {
      mockCurrencyService.formatAmount.mockReturnValue('$0.00');
      mockCurrencyService.formatAmountLocalized.mockReturnValue('$0.00');

      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 0,
          currency: 'usd',
        });

      expect(response.status).toBe(200);
      expect(response.body.amount).toBe(0);
    });

    it('should handle uppercase currency code', async () => {
      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 10000,
          currency: 'USD',
        });

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe('usd');
    });

    it('should return 500 when service throws error', async () => {
      mockCurrencyService.formatAmount.mockImplementation(() => {
        throw new Error('Format error');
      });

      const response = await request(app)
        .post('/currencies/format')
        .send({
          amount: 10000,
          currency: 'usd',
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to format amount' });
    });
  });

  describe('POST /currencies/validate-minimum', () => {
    beforeEach(() => {
      mockCurrencyService.isSupportedCurrency.mockImplementation(
        (currency: string) => ['usd', 'cny', 'jpy', 'eur'].includes(currency?.toLowerCase())
      );
    });

    it('should validate valid amount meets minimum', async () => {
      mockCurrencyService.validateMinimumCharge.mockReturnValue({
        valid: true,
        minimumAmount: 50,
        formattedMinimum: '$0.50',
      });

      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 100,
          currency: 'usd',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('valid', true);
      expect(response.body).toHaveProperty('minimumAmount', 50);
      expect(response.body).toHaveProperty('minimumFormatted', '$0.50');
      expect(response.body).toHaveProperty('message', 'Amount meets minimum requirement');
    });

    it('should validate invalid amount below minimum', async () => {
      mockCurrencyService.validateMinimumCharge.mockReturnValue({
        valid: false,
        minimumAmount: 50,
        formattedMinimum: '$0.50',
      });

      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 10,
          currency: 'usd',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('valid', false);
      expect(response.body).toHaveProperty('message', 'Amount must be at least $0.50');
    });

    it('should validate exactly minimum amount', async () => {
      mockCurrencyService.validateMinimumCharge.mockReturnValue({
        valid: true,
        minimumAmount: 50,
        formattedMinimum: '$0.50',
      });

      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 50,
          currency: 'usd',
        });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
    });

    it('should validate CNY minimum charge', async () => {
      mockCurrencyService.validateMinimumCharge.mockReturnValue({
        valid: false,
        minimumAmount: 400,
        formattedMinimum: '¥4.00',
      });

      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 100,
          currency: 'cny',
        });

      expect(response.status).toBe(200);
      expect(response.body.minimumAmount).toBe(400);
      expect(response.body.minimumFormatted).toBe('¥4.00');
    });

    it('should validate JPY minimum charge', async () => {
      mockCurrencyService.validateMinimumCharge.mockReturnValue({
        valid: true,
        minimumAmount: 50,
        formattedMinimum: '¥50',
      });

      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 100,
          currency: 'jpy',
        });

      expect(response.status).toBe(200);
      expect(response.body.minimumAmount).toBe(50);
    });

    it('should return 400 for invalid amount', async () => {
      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 'invalid',
          currency: 'usd',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount' });
    });

    it('should return 400 for null amount', async () => {
      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: null,
          currency: 'usd',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount' });
    });

    it('should return 400 for missing amount', async () => {
      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          currency: 'usd',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid amount' });
    });

    it('should return 400 for unsupported currency', async () => {
      mockCurrencyService.isSupportedCurrency.mockReturnValue(false);

      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 100,
          currency: 'xxx',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Unsupported currency: xxx' });
    });

    it('should handle uppercase currency code', async () => {
      mockCurrencyService.validateMinimumCharge.mockReturnValue({
        valid: true,
        minimumAmount: 50,
        formattedMinimum: '$0.50',
      });

      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 100,
          currency: 'USD',
        });

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe('usd');
    });

    it('should handle zero amount', async () => {
      mockCurrencyService.validateMinimumCharge.mockReturnValue({
        valid: false,
        minimumAmount: 50,
        formattedMinimum: '$0.50',
      });

      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 0,
          currency: 'usd',
        });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
    });

    it('should return 500 when service throws error', async () => {
      mockCurrencyService.validateMinimumCharge.mockImplementation(() => {
        throw new Error('Validation error');
      });

      const response = await request(app)
        .post('/currencies/validate-minimum')
        .send({
          amount: 100,
          currency: 'usd',
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to validate minimum charge' });
    });
  });

  describe('Content-Type and Headers', () => {
    beforeEach(() => {
      mockCurrencyService.getSupportedCurrencies.mockReturnValue([]);
      mockCurrencyService.getAllExchangeRates.mockReturnValue([]);
    });

    it('should return JSON content type for GET endpoints', async () => {
      const response = await request(app).get('/currencies');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return JSON content type for POST endpoints', async () => {
      mockCurrencyService.isSupportedCurrency.mockReturnValue(true);
      mockCurrencyService.convertAmount.mockReturnValue(100);
      mockCurrencyService.getExchangeRateDisplay.mockReturnValue(null);
      mockCurrencyService.formatAmount.mockReturnValue('$1.00');

      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 100,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large numbers in convert', async () => {
      mockCurrencyService.isSupportedCurrency.mockReturnValue(true);
      mockCurrencyService.convertAmount.mockReturnValue(Number.MAX_SAFE_INTEGER);
      mockCurrencyService.getExchangeRateDisplay.mockReturnValue(null);
      mockCurrencyService.formatAmount.mockReturnValue('$999,999,999.99');

      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: Number.MAX_SAFE_INTEGER,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(200);
    });

    it('should handle decimal amounts in convert', async () => {
      mockCurrencyService.isSupportedCurrency.mockReturnValue(true);
      mockCurrencyService.convertAmount.mockReturnValue(72.5);
      mockCurrencyService.getExchangeRateDisplay.mockReturnValue(null);
      mockCurrencyService.formatAmount.mockReturnValue('$0.73');

      const response = await request(app)
        .post('/currencies/convert')
        .send({
          amount: 10.5,
          fromCurrency: 'usd',
          toCurrency: 'cny',
        });

      expect(response.status).toBe(200);
      expect(response.body.convertedAmount).toBe(72.5);
    });

    it('should handle empty request body for POST', async () => {
      const response = await request(app)
        .post('/currencies/convert')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should handle missing request body for POST', async () => {
      const response = await request(app)
        .post('/currencies/convert');

      expect(response.status).toBe(400);
    });
  });
});
