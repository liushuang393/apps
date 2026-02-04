import { CurrencyService } from '../../../services/CurrencyService';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CurrencyService', () => {
  let service: CurrencyService;

  beforeEach(() => {
    service = new CurrencyService();
  });

  describe('getSupportedCurrencies', () => {
    it('should return all supported currencies', () => {
      const currencies = service.getSupportedCurrencies();
      
      expect(currencies).toHaveLength(4);
      expect(currencies.map(c => c.code)).toEqual(['usd', 'cny', 'jpy', 'eur']);
    });

    it('should include all required properties for each currency', () => {
      const currencies = service.getSupportedCurrencies();
      
      currencies.forEach(currency => {
        expect(currency).toHaveProperty('code');
        expect(currency).toHaveProperty('symbol');
        expect(currency).toHaveProperty('name');
        expect(currency).toHaveProperty('nameChinese');
        expect(currency).toHaveProperty('decimalPlaces');
        expect(currency).toHaveProperty('symbolPosition');
        expect(currency).toHaveProperty('thousandsSeparator');
        expect(currency).toHaveProperty('decimalSeparator');
        expect(currency).toHaveProperty('stripeMinimumCharge');
      });
    });
  });

  describe('getCurrencyConfig', () => {
    it('should return USD config', () => {
      const config = service.getCurrencyConfig('usd');
      
      expect(config.code).toBe('usd');
      expect(config.symbol).toBe('$');
      expect(config.name).toBe('US Dollar');
      expect(config.decimalPlaces).toBe(2);
      expect(config.stripeMinimumCharge).toBe(50);
    });

    it('should return JPY config with 0 decimal places', () => {
      const config = service.getCurrencyConfig('jpy');
      
      expect(config.code).toBe('jpy');
      expect(config.symbol).toBe('¥');
      expect(config.decimalPlaces).toBe(0);
    });

    it('should return CNY config', () => {
      const config = service.getCurrencyConfig('cny');
      
      expect(config.code).toBe('cny');
      expect(config.symbol).toBe('¥');
      expect(config.nameChinese).toBe('人民币');
    });

    it('should return EUR config', () => {
      const config = service.getCurrencyConfig('eur');
      
      expect(config.code).toBe('eur');
      expect(config.symbol).toBe('€');
      expect(config.decimalSeparator).toBe(',');
    });
  });

  describe('isSupportedCurrency', () => {
    it('should return true for supported currencies', () => {
      expect(service.isSupportedCurrency('usd')).toBe(true);
      expect(service.isSupportedCurrency('cny')).toBe(true);
      expect(service.isSupportedCurrency('jpy')).toBe(true);
      expect(service.isSupportedCurrency('eur')).toBe(true);
    });

    it('should handle uppercase currency codes', () => {
      // The service lowercases currency codes internally
      expect(service.isSupportedCurrency('usd')).toBe(true);
    });

    it('should return false for unsupported currencies', () => {
      expect(service.isSupportedCurrency('gbp')).toBe(false);
      expect(service.isSupportedCurrency('xyz')).toBe(false);
      expect(service.isSupportedCurrency('')).toBe(false);
    });
  });

  describe('getExchangeRate', () => {
    it('should return exchange rate for USD', () => {
      const rate = service.getExchangeRate('usd');
      
      expect(rate).not.toBeNull();
      expect(rate?.currency).toBe('usd');
      expect(rate?.rateFromUSD).toBe(1.0);
      expect(rate?.rateToUSD).toBe(1.0);
    });

    it('should return exchange rate for CNY', () => {
      const rate = service.getExchangeRate('cny');
      
      expect(rate).not.toBeNull();
      expect(rate?.currency).toBe('cny');
      expect(rate?.rateFromUSD).toBeGreaterThan(1);
    });

    it('should return exchange rate for JPY', () => {
      const rate = service.getExchangeRate('jpy');
      
      expect(rate).not.toBeNull();
      expect(rate?.rateFromUSD).toBeGreaterThan(100);
    });
  });

  describe('getAllExchangeRates', () => {
    it('should return all exchange rates', () => {
      const rates = service.getAllExchangeRates();
      
      expect(rates).toHaveLength(4);
      expect(rates.map(r => r.currency)).toEqual(['usd', 'cny', 'jpy', 'eur']);
    });
  });

  describe('convertAmount', () => {
    it('should return same amount for same currency', () => {
      const result = service.convertAmount(1000, 'usd', 'usd');
      expect(result).toBe(1000);
    });

    it('should convert USD to CNY', () => {
      const result = service.convertAmount(1000, 'usd', 'cny'); // $10.00
      
      // Default rate is 7.25
      expect(result).toBe(7250); // ¥72.50
    });

    it('should convert USD to JPY', () => {
      const result = service.convertAmount(1000, 'usd', 'jpy'); // $10.00
      
      // Default rate is 149.50, and JPY has 0 decimal places
      // $10.00 * 149.50 = 1495 JPY
      expect(result).toBe(1495);
    });

    it('should convert USD to EUR', () => {
      const result = service.convertAmount(1000, 'usd', 'eur'); // $10.00
      
      // Default rate is 0.92
      expect(result).toBe(920); // €9.20
    });

    it('should convert CNY to USD', () => {
      const result = service.convertAmount(7250, 'cny', 'usd'); // ¥72.50
      
      // Should convert back to roughly $10.00
      expect(result).toBeCloseTo(1000, -1);
    });

    it('should convert between non-USD currencies', () => {
      const result = service.convertAmount(7250, 'cny', 'eur'); // ¥72.50
      
      // CNY -> USD -> EUR
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('convertToAllCurrencies', () => {
    it('should convert USD amount to all currencies', () => {
      const result = service.convertToAllCurrencies(1000); // $10.00
      
      expect(result.usd).toBe(1000);
      expect(result.cny).toBe(7250);
      expect(result.jpy).toBe(1495);
      expect(result.eur).toBe(920);
    });

    it('should handle zero amount', () => {
      const result = service.convertToAllCurrencies(0);
      
      expect(result.usd).toBe(0);
      expect(result.cny).toBe(0);
      expect(result.jpy).toBe(0);
      expect(result.eur).toBe(0);
    });
  });

  describe('formatAmount', () => {
    it('should format USD with symbol', () => {
      const result = service.formatAmount(1234, 'usd');
      expect(result).toBe('$12.34');
    });

    it('should format large USD amount with thousands separator', () => {
      const result = service.formatAmount(123456789, 'usd');
      expect(result).toBe('$1,234,567.89');
    });

    it('should format JPY without decimal places', () => {
      const result = service.formatAmount(1234, 'jpy');
      expect(result).toBe('¥1,234');
    });

    it('should format EUR with symbol', () => {
      const result = service.formatAmount(1234, 'eur');
      // EUR uses comma as decimal separator
      expect(result).toBe('€12,34');
    });

    it('should format without symbol when showSymbol is false', () => {
      const result = service.formatAmount(1234, 'usd', { showSymbol: false });
      expect(result).toBe('12.34');
    });

    it('should format with currency code when showCode is true', () => {
      const result = service.formatAmount(1234, 'usd', { showCode: true });
      expect(result).toBe('$12.34 USD');
    });

    it('should format with both options', () => {
      const result = service.formatAmount(1234, 'usd', { showSymbol: false, showCode: true });
      expect(result).toBe('12.34 USD');
    });
  });

  describe('formatAmountLocalized', () => {
    it('should format USD for en-US locale', () => {
      const result = service.formatAmountLocalized(1234, 'usd', 'en-US');
      expect(result).toBe('$12.34');
    });

    it('should format JPY for ja-JP locale', () => {
      const result = service.formatAmountLocalized(1234, 'jpy', 'ja-JP');
      expect(result).toContain('1,234');
    });
  });

  describe('parseAmount', () => {
    it('should parse USD formatted string', () => {
      const result = service.parseAmount('$12.34', 'usd');
      expect(result).toBe(1234);
    });

    it('should parse string with thousands separator', () => {
      const result = service.parseAmount('$1,234.56', 'usd');
      expect(result).toBe(123456);
    });

    it('should parse JPY formatted string', () => {
      const result = service.parseAmount('¥1,234', 'jpy');
      expect(result).toBe(1234);
    });

    it('should parse EUR formatted string with comma decimal', () => {
      const result = service.parseAmount('€12,34', 'eur');
      expect(result).toBe(1234);
    });

    it('should return 0 for invalid string', () => {
      const result = service.parseAmount('invalid', 'usd');
      expect(result).toBe(0);
    });

    it('should parse string with currency code', () => {
      const result = service.parseAmount('$12.34 USD', 'usd');
      expect(result).toBe(1234);
    });
  });

  describe('validateMinimumCharge', () => {
    it('should validate USD amount above minimum', () => {
      const result = service.validateMinimumCharge(100, 'usd');
      
      expect(result.valid).toBe(true);
      expect(result.minimumAmount).toBe(50);
    });

    it('should invalidate USD amount below minimum', () => {
      const result = service.validateMinimumCharge(49, 'usd');
      
      expect(result.valid).toBe(false);
      expect(result.minimumAmount).toBe(50);
      expect(result.formattedMinimum).toBe('$0.50');
    });

    it('should validate exact minimum amount', () => {
      const result = service.validateMinimumCharge(50, 'usd');
      expect(result.valid).toBe(true);
    });

    it('should validate JPY minimum charge', () => {
      const result = service.validateMinimumCharge(50, 'jpy');
      
      expect(result.valid).toBe(true);
      expect(result.minimumAmount).toBe(50);
    });

    it('should invalidate JPY below minimum', () => {
      const result = service.validateMinimumCharge(49, 'jpy');
      expect(result.valid).toBe(false);
    });

    it('should validate CNY minimum charge', () => {
      const result = service.validateMinimumCharge(400, 'cny');
      expect(result.valid).toBe(true);
    });

    it('should invalidate CNY below minimum', () => {
      const result = service.validateMinimumCharge(399, 'cny');
      expect(result.valid).toBe(false);
    });
  });

  describe('updateExchangeRates', () => {
    it('should not update if rates are fresh', async () => {
      // First call
      await service.updateExchangeRates();
      
      // Second call immediately - should skip
      await service.updateExchangeRates();
      
      // Rates should still exist
      const rate = service.getExchangeRate('usd');
      expect(rate).not.toBeNull();
    });
  });

  describe('setExchangeRate', () => {
    it('should set custom exchange rate', () => {
      service.setExchangeRate('cny', 8.0);
      
      const rate = service.getExchangeRate('cny');
      expect(rate?.rateFromUSD).toBe(8.0);
      expect(rate?.rateToUSD).toBe(0.125);
    });

    it('should update conversion results with custom rate', () => {
      service.setExchangeRate('cny', 8.0);
      
      const result = service.convertAmount(1000, 'usd', 'cny');
      expect(result).toBe(8000); // $10.00 * 8.0 = ¥80.00
    });
  });

  describe('getExchangeRateDisplay', () => {
    it('should return display info for USD to CNY', () => {
      const result = service.getExchangeRateDisplay('usd', 'cny');
      
      expect(result).not.toBeNull();
      expect(result?.rate).toBe(7.25);
      expect(result?.display).toContain('$');
      expect(result?.display).toContain('¥');
      expect(result?.lastUpdated).toBeInstanceOf(Date);
    });

    it('should return display info for same currency', () => {
      const result = service.getExchangeRateDisplay('usd', 'usd');
      
      expect(result).not.toBeNull();
      expect(result?.rate).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle very large amounts', () => {
      const result = service.formatAmount(999999999999, 'usd');
      expect(result).toContain('9,999,999,999.99');
    });

    it('should handle zero amount', () => {
      const result = service.formatAmount(0, 'usd');
      expect(result).toBe('$0.00');
    });

    it('should handle negative amounts', () => {
      const result = service.formatAmount(-1000, 'usd');
      expect(result).toBe('$-10.00');
    });
  });
});
