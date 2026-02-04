// Mock config first (before imports)
jest.mock('../../../config', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_123',
    },
    tax: {
      sellerCountry: 'US',
    },
  },
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Create the mock function at module scope
const mockStripeCreate = jest.fn();

// Mock Stripe with hoisted mock function
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    tax: {
      calculations: {
        create: (...args: unknown[]) => mockStripeCreate(...args),
      },
    },
  }));
});

// Import after mocks are set up
import { TaxService, TaxCalculationParams, TaxAddress, TaxLineItem } from '../../../services/TaxService';

// Mock global fetch for VIES API
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('TaxService', () => {
  let service: TaxService;

  const mockAddress: TaxAddress = {
    line1: '123 Main St',
    city: 'Berlin',
    postalCode: '10115',
    country: 'DE',
  };

  const mockLineItems: TaxLineItem[] = [
    { amount: 10000, reference: 'prod_123', taxCode: 'txcd_10000000' },
  ];

  const mockTaxParams: TaxCalculationParams = {
    currency: 'EUR',
    lineItems: mockLineItems,
    customerAddress: mockAddress,
  };

  beforeEach(() => {
    service = new TaxService('sk_test_123');
    jest.clearAllMocks();
  });

  describe('calculateTax', () => {
    it('should calculate tax using Stripe Tax API', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 1900,
        tax_amount_inclusive: 0,
        amount_total: 11900,
        tax_breakdown: [
          {
            amount: 1900,
            inclusive: false,
            tax_rate_details: {
              display_name: 'VAT',
              percentage_decimal: '19',
              tax_type: 'vat',
              country: 'DE',
            },
          },
        ],
      });

      const result = await service.calculateTax(mockTaxParams);

      expect(result.taxAmountExclusive).toBe(1900);
      expect(result.taxAmountInclusive).toBe(0);
      expect(result.totalAmount).toBe(11900);
      expect(result.reverseCharge).toBe(false);
      expect(result.taxBreakdown).toHaveLength(1);
      expect(result.taxBreakdown[0].taxRate.displayName).toBe('VAT');
      expect(result.taxBreakdown[0].taxRate.percentage).toBe(19);
    });

    it('should include shipping cost in tax calculation', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 2280,
        tax_amount_inclusive: 0,
        amount_total: 14280,
        tax_breakdown: [],
      });

      const paramsWithShipping: TaxCalculationParams = {
        ...mockTaxParams,
        shippingCost: 2000,
      };

      await service.calculateTax(paramsWithShipping);

      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          shipping_cost: { amount: 2000 },
        })
      );
    });

    it('should convert currency to lowercase', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 0,
        tax_amount_inclusive: 0,
        amount_total: 10000,
        tax_breakdown: [],
      });

      await service.calculateTax(mockTaxParams);

      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'eur',
        })
      );
    });

    it('should use default tax code if not provided', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 0,
        tax_amount_inclusive: 0,
        amount_total: 10000,
        tax_breakdown: [],
      });

      const paramsWithoutTaxCode: TaxCalculationParams = {
        ...mockTaxParams,
        lineItems: [{ amount: 10000 }],
      };

      await service.calculateTax(paramsWithoutTaxCode);

      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            expect.objectContaining({
              tax_code: 'txcd_10000000',
            }),
          ],
        })
      );
    });

    it('should generate reference for line items without reference', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 0,
        tax_amount_inclusive: 0,
        amount_total: 10000,
        tax_breakdown: [],
      });

      const paramsWithoutRef: TaxCalculationParams = {
        ...mockTaxParams,
        lineItems: [{ amount: 10000 }],
      };

      await service.calculateTax(paramsWithoutRef);

      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            expect.objectContaining({
              reference: 'item_0',
            }),
          ],
        })
      );
    });

    it('should handle null tax_breakdown from Stripe', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 0,
        tax_amount_inclusive: 0,
        amount_total: 10000,
        tax_breakdown: null,
      });

      const result = await service.calculateTax(mockTaxParams);

      expect(result.taxBreakdown).toEqual([]);
    });

    it('should handle missing tax_rate_details properties', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 1900,
        tax_amount_inclusive: 0,
        amount_total: 11900,
        tax_breakdown: [
          {
            amount: 1900,
            inclusive: false,
            tax_rate_details: {},
          },
        ],
      });

      const result = await service.calculateTax(mockTaxParams);

      expect(result.taxBreakdown[0].taxRate.displayName).toBe('Tax');
      expect(result.taxBreakdown[0].taxRate.percentage).toBe(0);
      expect(result.taxBreakdown[0].taxRate.taxType).toBe('unknown');
      expect(result.taxBreakdown[0].taxRate.country).toBe('DE');
    });

    it('should handle null tax_rate_details', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 1900,
        tax_amount_inclusive: 0,
        amount_total: 11900,
        tax_breakdown: [
          {
            amount: 1900,
            inclusive: false,
            tax_rate_details: null,
          },
        ],
      });

      const result = await service.calculateTax(mockTaxParams);

      expect(result.taxBreakdown[0].taxRate.displayName).toBe('Tax');
      expect(result.taxBreakdown[0].taxRate.percentage).toBe(0);
    });

    describe('Reverse Charge', () => {
      it('should return zero tax with reverse charge for valid EU B2B', async () => {
        // Mock VIES API returning valid VAT
        mockFetch.mockResolvedValue({
          text: () => Promise.resolve('<valid>true</valid><name>Test Company</name>'),
        });

        const paramsWithVat: TaxCalculationParams = {
          ...mockTaxParams,
          customerTaxId: 'DE123456789',
        };

        const result = await service.calculateTax(paramsWithVat);

        expect(result.reverseCharge).toBe(true);
        expect(result.taxAmountExclusive).toBe(0);
        expect(result.taxAmountInclusive).toBe(0);
        expect(result.totalAmount).toBe(10000);
        expect(result.taxBreakdown[0].taxRate.displayName).toBe('Reverse Charge');
      });

      it('should calculate tax normally if VAT number invalid', async () => {
        mockFetch.mockResolvedValue({
          text: () => Promise.resolve('<valid>false</valid>'),
        });

        mockStripeCreate.mockResolvedValue({
          tax_amount_exclusive: 1900,
          tax_amount_inclusive: 0,
          amount_total: 11900,
          tax_breakdown: [],
        });

        const paramsWithInvalidVat: TaxCalculationParams = {
          ...mockTaxParams,
          customerTaxId: 'DE000000000',
        };

        const result = await service.calculateTax(paramsWithInvalidVat);

        expect(result.reverseCharge).toBe(false);
        expect(mockStripeCreate).toHaveBeenCalled();
      });

      it('should not apply reverse charge if no VAT number provided', async () => {
        mockStripeCreate.mockResolvedValue({
          tax_amount_exclusive: 1900,
          tax_amount_inclusive: 0,
          amount_total: 11900,
          tax_breakdown: [],
        });

        const result = await service.calculateTax(mockTaxParams);

        expect(result.reverseCharge).toBe(false);
        expect(mockStripeCreate).toHaveBeenCalled();
      });

      it('should not apply reverse charge for non-EU countries', async () => {
        mockStripeCreate.mockResolvedValue({
          tax_amount_exclusive: 0,
          tax_amount_inclusive: 0,
          amount_total: 10000,
          tax_breakdown: [],
        });

        const paramsNonEU: TaxCalculationParams = {
          ...mockTaxParams,
          customerAddress: { ...mockAddress, country: 'US' },
          customerTaxId: 'US123456789',
        };

        const result = await service.calculateTax(paramsNonEU);

        expect(result.reverseCharge).toBe(false);
      });

      it('should calculate total correctly for multiple line items with reverse charge', async () => {
        mockFetch.mockResolvedValue({
          text: () => Promise.resolve('<valid>true</valid>'),
        });

        const paramsMultipleItems: TaxCalculationParams = {
          currency: 'EUR',
          lineItems: [
            { amount: 5000 },
            { amount: 3000 },
            { amount: 2000 },
          ],
          customerAddress: mockAddress,
          customerTaxId: 'DE123456789',
        };

        const result = await service.calculateTax(paramsMultipleItems);

        expect(result.reverseCharge).toBe(true);
        expect(result.totalAmount).toBe(10000);
      });
    });

    describe('Fallback Manual Calculation', () => {
      beforeEach(() => {
        mockStripeCreate.mockRejectedValue(new Error('Stripe API error'));
      });

      it('should fallback to manual calculation when Stripe fails', async () => {
        const result = await service.calculateTax(mockTaxParams);

        expect(result.reverseCharge).toBe(false);
        expect(result.taxAmountExclusive).toBe(1900); // 19% of 10000
        expect(result.totalAmount).toBe(11900);
      });

      it('should calculate UK VAT correctly', async () => {
        const paramsUK: TaxCalculationParams = {
          ...mockTaxParams,
          customerAddress: { country: 'GB' },
        };

        const result = await service.calculateTax(paramsUK);

        expect(result.taxAmountExclusive).toBe(2000); // 20%
        expect(result.taxBreakdown[0].taxRate.displayName).toBe('UK VAT 20%');
        expect(result.taxBreakdown[0].taxRate.taxType).toBe('vat');
      });

      it('should calculate Australian GST correctly', async () => {
        const paramsAU: TaxCalculationParams = {
          ...mockTaxParams,
          customerAddress: { country: 'AU' },
        };

        const result = await service.calculateTax(paramsAU);

        expect(result.taxAmountExclusive).toBe(1000); // 10%
        expect(result.taxBreakdown[0].taxRate.displayName).toBe('Australian GST 10%');
        expect(result.taxBreakdown[0].taxRate.taxType).toBe('gst');
      });

      it('should calculate New Zealand GST correctly', async () => {
        const paramsNZ: TaxCalculationParams = {
          ...mockTaxParams,
          customerAddress: { country: 'NZ' },
        };

        const result = await service.calculateTax(paramsNZ);

        expect(result.taxAmountExclusive).toBe(1500); // 15%
        expect(result.taxBreakdown[0].taxRate.displayName).toBe('NZ GST 15%');
      });

      it('should calculate Canadian GST correctly', async () => {
        const paramsCA: TaxCalculationParams = {
          ...mockTaxParams,
          customerAddress: { country: 'CA' },
        };

        const result = await service.calculateTax(paramsCA);

        expect(result.taxAmountExclusive).toBe(500); // 5%
        expect(result.taxBreakdown[0].taxRate.displayName).toBe('Canadian GST 5%');
      });

      it('should calculate Japan Consumption Tax correctly', async () => {
        const paramsJP: TaxCalculationParams = {
          ...mockTaxParams,
          customerAddress: { country: 'JP' },
        };

        const result = await service.calculateTax(paramsJP);

        expect(result.taxAmountExclusive).toBe(1000); // 10%
        expect(result.taxBreakdown[0].taxRate.displayName).toBe('Japan Consumption Tax 10%');
        expect(result.taxBreakdown[0].taxRate.taxType).toBe('jct');
      });

      it('should return zero tax for US', async () => {
        const paramsUS: TaxCalculationParams = {
          ...mockTaxParams,
          customerAddress: { country: 'US' },
        };

        const result = await service.calculateTax(paramsUS);

        expect(result.taxAmountExclusive).toBe(0);
        expect(result.taxBreakdown).toEqual([]);
      });

      it('should handle lowercase country codes', async () => {
        const paramsLowercase: TaxCalculationParams = {
          ...mockTaxParams,
          customerAddress: { country: 'de' },
        };

        const result = await service.calculateTax(paramsLowercase);

        expect(result.taxAmountExclusive).toBe(1900); // 19% German VAT
      });

      it('should calculate tax for all EU countries', async () => {
        const euCountries = [
          { country: 'AT', rate: 20 },
          { country: 'BE', rate: 21 },
          { country: 'BG', rate: 20 },
          { country: 'HR', rate: 25 },
          { country: 'CY', rate: 19 },
          { country: 'CZ', rate: 21 },
          { country: 'DK', rate: 25 },
          { country: 'EE', rate: 22 },
          { country: 'FI', rate: 24 },
          { country: 'FR', rate: 20 },
          { country: 'DE', rate: 19 },
          { country: 'GR', rate: 24 },
          { country: 'HU', rate: 27 },
          { country: 'IE', rate: 23 },
          { country: 'IT', rate: 22 },
          { country: 'LV', rate: 21 },
          { country: 'LT', rate: 21 },
          { country: 'LU', rate: 17 },
          { country: 'MT', rate: 18 },
          { country: 'NL', rate: 21 },
          { country: 'PL', rate: 23 },
          { country: 'PT', rate: 23 },
          { country: 'RO', rate: 19 },
          { country: 'SK', rate: 20 },
          { country: 'SI', rate: 22 },
          { country: 'ES', rate: 21 },
          { country: 'SE', rate: 25 },
        ];

        for (const { country, rate } of euCountries) {
          const params: TaxCalculationParams = {
            ...mockTaxParams,
            customerAddress: { country },
          };

          const result = await service.calculateTax(params);

          expect(result.taxAmountExclusive).toBe(rate * 100);
          expect(result.taxBreakdown[0].taxRate.percentage).toBe(rate);
        }
      });

      it('should round tax amount correctly', async () => {
        const paramsOddAmount: TaxCalculationParams = {
          ...mockTaxParams,
          lineItems: [{ amount: 9999 }], // 19% = 1899.81, should round to 1900
        };

        const result = await service.calculateTax(paramsOddAmount);

        expect(result.taxAmountExclusive).toBe(1900);
      });

      it('should sum multiple line items', async () => {
        const paramsMultiple: TaxCalculationParams = {
          ...mockTaxParams,
          lineItems: [
            { amount: 5000 },
            { amount: 3000 },
            { amount: 2000 },
          ],
        };

        const result = await service.calculateTax(paramsMultiple);

        expect(result.taxAmountExclusive).toBe(1900); // 19% of 10000
        expect(result.totalAmount).toBe(11900);
      });
    });
  });

  describe('validateVATNumber', () => {
    it('should validate correct VAT number via VIES', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve(`
          <valid>true</valid>
          <name>Test Company GmbH</name>
          <address>Berlin, Germany</address>
        `),
      });

      const result = await service.validateVATNumber('DE123456789');

      expect(result.valid).toBe(true);
      expect(result.countryCode).toBe('DE');
      expect(result.vatNumber).toBe('DE123456789');
      expect(result.name).toBe('Test Company GmbH');
      expect(result.address).toBe('Berlin, Germany');
    });

    it('should return invalid for incorrect VAT number', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve('<valid>false</valid>'),
      });

      const result = await service.validateVATNumber('DE000000000');

      expect(result.valid).toBe(false);
    });

    it('should handle VAT number with spaces', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve('<valid>true</valid>'),
      });

      const result = await service.validateVATNumber('DE 123 456 789');

      expect(result.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('<urn:vatNumber>123456789</urn:vatNumber>'),
        })
      );
    });

    it('should handle lowercase VAT number', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve('<valid>true</valid>'),
      });

      const result = await service.validateVATNumber('de123456789');

      expect(result.valid).toBe(true);
      expect(result.countryCode).toBe('DE');
    });

    it('should return error for VAT number too short', async () => {
      const result = await service.validateVATNumber('DE1');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('VAT number too short');
    });

    it('should return error for invalid country code', async () => {
      const result = await service.validateVATNumber('XX123456789');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid EU country code');
    });

    it('should return error for non-EU country code', async () => {
      const result = await service.validateVATNumber('US123456789');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid EU country code');
    });

    it('should handle VIES API error gracefully', async () => {
      // Reset mock and ensure it rejects
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Use an invalid format VAT number so format validation also fails
      const result = await service.validateVATNumber('DE12345'); // Invalid format

      expect(result.valid).toBe(false);
    });

    describe('VIES API Fallback Format Validation', () => {
      beforeEach(() => {
        mockFetch.mockRejectedValue(new Error('VIES unavailable'));
      });

      it('should fallback to format validation for German VAT', async () => {
        const result = await service.validateVATNumber('DE123456789');

        expect(result.valid).toBe(true);
        expect(result.error).toBe('VIES unavailable - format validation only');
      });

      it('should reject invalid German VAT format', async () => {
        const result = await service.validateVATNumber('DE12345'); // Too short

        expect(result.valid).toBe(false);
      });

      it('should validate Austrian VAT format', async () => {
        const result = await service.validateVATNumber('ATU12345678');

        expect(result.valid).toBe(true);
      });

      it('should validate Belgian VAT format', async () => {
        const result = await service.validateVATNumber('BE0123456789');

        expect(result.valid).toBe(true);
      });

      it('should validate French VAT format', async () => {
        const result = await service.validateVATNumber('FRXX123456789');

        expect(result.valid).toBe(true);
      });

      it('should validate Dutch VAT format', async () => {
        const result = await service.validateVATNumber('NL123456789B01');

        expect(result.valid).toBe(true);
      });

      it('should validate Spanish VAT format', async () => {
        const result = await service.validateVATNumber('ESA12345678');

        expect(result.valid).toBe(true);
      });

      it('should validate Italian VAT format', async () => {
        const result = await service.validateVATNumber('IT12345678901');

        expect(result.valid).toBe(true);
      });

      it('should validate Polish VAT format', async () => {
        const result = await service.validateVATNumber('PL1234567890');

        expect(result.valid).toBe(true);
      });

      it('should validate Swedish VAT format', async () => {
        const result = await service.validateVATNumber('SE123456789012');

        expect(result.valid).toBe(true);
      });

      it('should validate Czech VAT format', async () => {
        const result = await service.validateVATNumber('CZ12345678');

        expect(result.valid).toBe(true);
      });

      it('should validate Hungarian VAT format', async () => {
        const result = await service.validateVATNumber('HU12345678');

        expect(result.valid).toBe(true);
      });

      it('should validate Irish VAT format', async () => {
        const result = await service.validateVATNumber('IE1234567T');

        expect(result.valid).toBe(true);
      });

      it('should validate GB VAT format (9 digits)', async () => {
        // Note: GB is in format patterns but not in EU_COUNTRIES
        // This tests the format validation function
        const result = await service.validateVATNumber('GB123456789');

        // GB is not an EU country, so it should fail country validation
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid EU country code');
      });
    });
  });

  describe('getTaxRate', () => {
    it('should return correct rate for EU countries', () => {
      expect(service.getTaxRate('DE')).toBe(19);
      expect(service.getTaxRate('FR')).toBe(20);
      expect(service.getTaxRate('HU')).toBe(27);
      expect(service.getTaxRate('LU')).toBe(17);
    });

    it('should return correct rate for UK', () => {
      expect(service.getTaxRate('GB')).toBe(20);
    });

    it('should return correct rate for Australia', () => {
      expect(service.getTaxRate('AU')).toBe(10);
    });

    it('should return correct rate for New Zealand', () => {
      expect(service.getTaxRate('NZ')).toBe(15);
    });

    it('should return correct rate for Japan', () => {
      expect(service.getTaxRate('JP')).toBe(10);
    });

    it('should return correct rate for Canada', () => {
      expect(service.getTaxRate('CA')).toBe(5);
    });

    it('should return 0 for unsupported countries', () => {
      expect(service.getTaxRate('US')).toBe(0);
      expect(service.getTaxRate('CN')).toBe(0);
      expect(service.getTaxRate('BR')).toBe(0);
    });

    it('should handle lowercase country codes', () => {
      expect(service.getTaxRate('de')).toBe(19);
      expect(service.getTaxRate('gb')).toBe(20);
    });

    it('should handle mixed case country codes', () => {
      expect(service.getTaxRate('De')).toBe(19);
      expect(service.getTaxRate('gB')).toBe(20);
    });
  });

  describe('isEUCountry', () => {
    it('should return true for EU countries', () => {
      expect(service.isEUCountry('DE')).toBe(true);
      expect(service.isEUCountry('FR')).toBe(true);
      expect(service.isEUCountry('IT')).toBe(true);
      expect(service.isEUCountry('ES')).toBe(true);
      expect(service.isEUCountry('PL')).toBe(true);
    });

    it('should return false for non-EU countries', () => {
      expect(service.isEUCountry('GB')).toBe(false);
      expect(service.isEUCountry('US')).toBe(false);
      expect(service.isEUCountry('CA')).toBe(false);
      expect(service.isEUCountry('AU')).toBe(false);
      expect(service.isEUCountry('JP')).toBe(false);
    });

    it('should handle lowercase country codes', () => {
      expect(service.isEUCountry('de')).toBe(true);
      expect(service.isEUCountry('gb')).toBe(false);
    });

    it('should return false for invalid country codes', () => {
      expect(service.isEUCountry('XX')).toBe(false);
      expect(service.isEUCountry('')).toBe(false);
    });
  });

  describe('getSupportedJurisdictions', () => {
    it('should return array of supported jurisdictions', () => {
      const jurisdictions = service.getSupportedJurisdictions();

      expect(jurisdictions).toBeInstanceOf(Array);
      expect(jurisdictions.length).toBeGreaterThan(0);
    });

    it('should include all EU countries', () => {
      const jurisdictions = service.getSupportedJurisdictions();

      expect(jurisdictions).toContain('DE');
      expect(jurisdictions).toContain('FR');
      expect(jurisdictions).toContain('IT');
      expect(jurisdictions).toContain('ES');
      expect(jurisdictions).toContain('PL');
    });

    it('should include UK', () => {
      const jurisdictions = service.getSupportedJurisdictions();

      expect(jurisdictions).toContain('GB');
    });

    it('should include other major jurisdictions', () => {
      const jurisdictions = service.getSupportedJurisdictions();

      expect(jurisdictions).toContain('AU');
      expect(jurisdictions).toContain('NZ');
      expect(jurisdictions).toContain('CA');
      expect(jurisdictions).toContain('JP');
      expect(jurisdictions).toContain('US');
    });

    it('should return correct total count', () => {
      const jurisdictions = service.getSupportedJurisdictions();

      // 27 EU countries + 6 other (GB, AU, NZ, CA, JP, US)
      expect(jurisdictions.length).toBe(33);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty line items array', async () => {
      mockStripeCreate.mockRejectedValue(new Error('Stripe error'));

      const params: TaxCalculationParams = {
        ...mockTaxParams,
        lineItems: [],
      };

      const result = await service.calculateTax(params);

      expect(result.totalAmount).toBe(0);
      expect(result.taxAmountExclusive).toBe(0);
    });

    it('should handle zero amount line items', async () => {
      mockStripeCreate.mockRejectedValue(new Error('Stripe error'));

      const params: TaxCalculationParams = {
        ...mockTaxParams,
        lineItems: [{ amount: 0 }],
      };

      const result = await service.calculateTax(params);

      expect(result.totalAmount).toBe(0);
      expect(result.taxAmountExclusive).toBe(0);
    });

    it('should handle very large amounts', async () => {
      mockStripeCreate.mockRejectedValue(new Error('Stripe error'));

      const params: TaxCalculationParams = {
        ...mockTaxParams,
        lineItems: [{ amount: 999999999 }], // ~10M in currency
      };

      const result = await service.calculateTax(params);

      // 999999999 * 0.19 = 189999999.81, Math.round = 190000000
      expect(result.taxAmountExclusive).toBe(190000000);
      expect(result.totalAmount).toBe(1189999999);
    });

    it('should handle customer address with only country', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 1900,
        tax_amount_inclusive: 0,
        amount_total: 11900,
        tax_breakdown: [],
      });

      const params: TaxCalculationParams = {
        ...mockTaxParams,
        customerAddress: { country: 'DE' },
      };

      await service.calculateTax(params);

      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_details: expect.objectContaining({
            address: expect.objectContaining({
              line1: '',
              city: '',
              postal_code: '',
              country: 'DE',
            }),
          }),
        })
      );
    });

    it('should handle undefined optional address fields', async () => {
      mockStripeCreate.mockResolvedValue({
        tax_amount_exclusive: 1900,
        tax_amount_inclusive: 0,
        amount_total: 11900,
        tax_breakdown: [],
      });

      const params: TaxCalculationParams = {
        ...mockTaxParams,
        customerAddress: {
          country: 'DE',
          line1: undefined,
          line2: undefined,
          city: undefined,
          state: undefined,
          postalCode: undefined,
        },
      };

      await service.calculateTax(params);

      expect(mockStripeCreate).toHaveBeenCalled();
    });
  });

  describe('Constructor', () => {
    it('should create instance with default API key from config', () => {
      const defaultService = new TaxService();
      expect(defaultService).toBeInstanceOf(TaxService);
    });

    it('should create instance with custom API key', () => {
      const customService = new TaxService('sk_custom_key');
      expect(customService).toBeInstanceOf(TaxService);
    });
  });

  describe('VIES API Response Parsing', () => {
    it('should handle response with missing name field', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve('<valid>true</valid><address>Test Address</address>'),
      });

      const result = await service.validateVATNumber('DE123456789');

      expect(result.valid).toBe(true);
      expect(result.name).toBeUndefined();
      expect(result.address).toBe('Test Address');
    });

    it('should handle response with missing address field', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve('<valid>true</valid><name>Test Company</name>'),
      });

      const result = await service.validateVATNumber('DE123456789');

      expect(result.valid).toBe(true);
      expect(result.name).toBe('Test Company');
      expect(result.address).toBeUndefined();
    });

    it('should handle response with empty values', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve('<valid>true</valid><name></name><address></address>'),
      });

      const result = await service.validateVATNumber('DE123456789');

      expect(result.valid).toBe(true);
      expect(result.name).toBe('');
      expect(result.address).toBe('');
    });

    it('should handle malformed XML gracefully', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve('not valid xml'),
      });

      const result = await service.validateVATNumber('DE123456789');

      // No <valid>true</valid> match means invalid
      expect(result.valid).toBe(false);
    });

    it('should handle <valid>TRUE</valid> (case insensitive)', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve('<valid>TRUE</valid>'),
      });

      const result = await service.validateVATNumber('DE123456789');

      expect(result.valid).toBe(true);
    });

    it('should handle <valid>True</valid> (mixed case)', async () => {
      mockFetch.mockResolvedValue({
        text: () => Promise.resolve('<valid>True</valid>'),
      });

      const result = await service.validateVATNumber('DE123456789');

      expect(result.valid).toBe(true);
    });
  });

  describe('Singleton Export', () => {
    it('should export taxService singleton', async () => {
      const { taxService } = await import('../../../services/TaxService');
      expect(taxService).toBeInstanceOf(TaxService);
    });
  });
});
