import Stripe from 'stripe';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Address for tax calculation
 */
export interface TaxAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country: string; // ISO 3166-1 alpha-2 country code
}

/**
 * Line item for tax calculation
 */
export interface TaxLineItem {
  amount: number; // Amount in cents
  reference?: string; // Product reference
  taxCode?: string; // Stripe tax code
}

/**
 * Tax calculation parameters
 */
export interface TaxCalculationParams {
  currency: string;
  lineItems: TaxLineItem[];
  customerAddress: TaxAddress;
  shippingCost?: number;
  customerTaxId?: string; // VAT number for B2B
}

/**
 * Tax calculation result
 */
export interface TaxCalculationResult {
  taxAmountExclusive: number;
  taxAmountInclusive: number;
  totalAmount: number;
  taxBreakdown: TaxBreakdownItem[];
  reverseCharge: boolean;
}

/**
 * Tax breakdown item
 */
export interface TaxBreakdownItem {
  amount: number;
  inclusive: boolean;
  taxRate: {
    displayName: string;
    percentage: number;
    taxType: string;
    country: string;
    state?: string;
  };
}

/**
 * VAT validation result
 */
export interface VATValidationResult {
  valid: boolean;
  countryCode?: string;
  vatNumber?: string;
  name?: string;
  address?: string;
  error?: string;
}

/**
 * EU VAT rates by country (standard rates as of 2024)
 */
const EU_VAT_RATES: Record<string, number> = {
  AT: 20, // Austria
  BE: 21, // Belgium
  BG: 20, // Bulgaria
  HR: 25, // Croatia
  CY: 19, // Cyprus
  CZ: 21, // Czech Republic
  DK: 25, // Denmark
  EE: 22, // Estonia
  FI: 24, // Finland
  FR: 20, // France
  DE: 19, // Germany
  GR: 24, // Greece
  HU: 27, // Hungary
  IE: 23, // Ireland
  IT: 22, // Italy
  LV: 21, // Latvia
  LT: 21, // Lithuania
  LU: 17, // Luxembourg
  MT: 18, // Malta
  NL: 21, // Netherlands
  PL: 23, // Poland
  PT: 23, // Portugal
  RO: 19, // Romania
  SK: 20, // Slovakia
  SI: 22, // Slovenia
  ES: 21, // Spain
  SE: 25, // Sweden
};

/**
 * EU country codes
 */
const EU_COUNTRIES = Object.keys(EU_VAT_RATES);

/**
 * TaxService handles tax calculation and VAT validation
 * 
 * Responsibilities:
 * - Calculate taxes using Stripe Tax API
 * - Validate EU VAT numbers via VIES API
 * - Apply reverse charge for valid B2B EU transactions
 * 
 * Requirements: 7.1, 7.3, 7.4
 */
export class TaxService {
  private stripe: Stripe;

  constructor(apiKey: string = config.stripe.secretKey) {
    this.stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
      typescript: true,
    });
  }

  /**
   * Calculate tax for a transaction using Stripe Tax
   * 
   * @param params - Tax calculation parameters
   * @returns Tax calculation result
   */
  async calculateTax(params: TaxCalculationParams): Promise<TaxCalculationResult> {
    try {
      // Check for reverse charge eligibility first
      const reverseCharge = await this.checkReverseCharge(
        params.customerAddress.country,
        params.customerTaxId
      );

      if (reverseCharge.eligible) {
        // Return 0 tax for reverse charge
        return {
          taxAmountExclusive: 0,
          taxAmountInclusive: 0,
          totalAmount: params.lineItems.reduce((sum, item) => sum + item.amount, 0),
          taxBreakdown: [{
            amount: 0,
            inclusive: false,
            taxRate: {
              displayName: 'Reverse Charge',
              percentage: 0,
              taxType: 'vat',
              country: params.customerAddress.country,
            },
          }],
          reverseCharge: true,
        };
      }

      // Use Stripe Tax API for calculation
      const calculation = await this.stripe.tax.calculations.create({
        currency: params.currency.toLowerCase(),
        line_items: params.lineItems.map((item, index) => ({
          amount: item.amount,
          reference: item.reference || `item_${index}`,
          tax_code: item.taxCode || 'txcd_10000000', // General - Electronically Supplied Services
        })),
        customer_details: {
          address: {
            line1: params.customerAddress.line1 || '',
            line2: params.customerAddress.line2 || undefined,
            city: params.customerAddress.city || '',
            state: params.customerAddress.state || undefined,
            postal_code: params.customerAddress.postalCode || '',
            country: params.customerAddress.country,
          },
          address_source: 'billing',
        },
        shipping_cost: params.shippingCost ? { amount: params.shippingCost } : undefined,
      });

      // Map Stripe response to our format
      const taxBreakdown: TaxBreakdownItem[] = calculation.tax_breakdown?.map((item) => {
        const taxRateDetails = item.tax_rate_details as {
          display_name?: string;
          percentage_decimal?: string;
          tax_type?: string;
          country?: string;
          state?: string;
        } | null;
        
        return {
          amount: item.amount,
          inclusive: item.inclusive,
          taxRate: {
            displayName: taxRateDetails?.display_name || 'Tax',
            percentage: taxRateDetails?.percentage_decimal 
              ? parseFloat(taxRateDetails.percentage_decimal) 
              : 0,
            taxType: taxRateDetails?.tax_type || 'unknown',
            country: taxRateDetails?.country || params.customerAddress.country,
            state: taxRateDetails?.state || undefined,
          },
        };
      }) || [];

      logger.info('Tax calculated', {
        currency: params.currency,
        country: params.customerAddress.country,
        taxAmount: calculation.tax_amount_exclusive,
        totalAmount: calculation.amount_total,
      });

      return {
        taxAmountExclusive: calculation.tax_amount_exclusive,
        taxAmountInclusive: calculation.tax_amount_inclusive,
        totalAmount: calculation.amount_total,
        taxBreakdown,
        reverseCharge: false,
      };
    } catch (error) {
      logger.error('Error calculating tax', { error, params });
      
      // Fallback to manual calculation if Stripe Tax fails
      return this.calculateTaxManually(params);
    }
  }

  /**
   * Fallback manual tax calculation
   * Uses standard VAT rates for EU, GST for AU/NZ, etc.
   */
  private calculateTaxManually(params: TaxCalculationParams): TaxCalculationResult {
    const country = params.customerAddress.country.toUpperCase();
    const subtotal = params.lineItems.reduce((sum, item) => sum + item.amount, 0);
    
    let taxRate = 0;
    let taxType = 'none';
    let displayName = 'No Tax';

    // EU VAT
    if (EU_COUNTRIES.includes(country)) {
      taxRate = EU_VAT_RATES[country] || 20;
      taxType = 'vat';
      displayName = `VAT ${taxRate}%`;
    }
    // UK VAT
    else if (country === 'GB') {
      taxRate = 20;
      taxType = 'vat';
      displayName = 'UK VAT 20%';
    }
    // Australia GST
    else if (country === 'AU') {
      taxRate = 10;
      taxType = 'gst';
      displayName = 'Australian GST 10%';
    }
    // New Zealand GST
    else if (country === 'NZ') {
      taxRate = 15;
      taxType = 'gst';
      displayName = 'NZ GST 15%';
    }
    // Canada (simplified - actual rates vary by province)
    else if (country === 'CA') {
      taxRate = 5; // Federal GST only
      taxType = 'gst';
      displayName = 'Canadian GST 5%';
    }
    // Japan Consumption Tax
    else if (country === 'JP') {
      taxRate = 10;
      taxType = 'jct';
      displayName = 'Japan Consumption Tax 10%';
    }
    // US - typically no federal tax on digital goods, state varies
    // For simplicity, we don't apply tax for US (Stripe Tax handles this properly)

    const taxAmount = Math.round(subtotal * (taxRate / 100));
    const totalAmount = subtotal + taxAmount;

    logger.info('Manual tax calculation', {
      country,
      taxRate,
      subtotal,
      taxAmount,
    });

    return {
      taxAmountExclusive: taxAmount,
      taxAmountInclusive: 0,
      totalAmount,
      taxBreakdown: taxRate > 0 ? [{
        amount: taxAmount,
        inclusive: false,
        taxRate: {
          displayName,
          percentage: taxRate,
          taxType,
          country,
        },
      }] : [],
      reverseCharge: false,
    };
  }

  /**
   * Check if reverse charge is applicable
   * Reverse charge applies for B2B transactions within EU when seller and buyer are in different countries
   */
  private async checkReverseCharge(
    customerCountry: string,
    vatNumber?: string
  ): Promise<{ eligible: boolean; reason?: string }> {
    if (!vatNumber) {
      return { eligible: false, reason: 'No VAT number provided' };
    }

    const country = customerCountry.toUpperCase();

    // Only applicable for EU countries
    if (!EU_COUNTRIES.includes(country)) {
      return { eligible: false, reason: 'Customer not in EU' };
    }

    // Validate VAT number
    const validation = await this.validateVATNumber(vatNumber);

    if (!validation.valid) {
      return { eligible: false, reason: 'Invalid VAT number' };
    }

    // Check if customer is in a different EU country than seller
    // For this, we'd need seller's country from config
    const sellerCountry = config.tax?.sellerCountry || 'US';

    if (sellerCountry === country) {
      return { eligible: false, reason: 'Same country as seller' };
    }

    // Reverse charge applies
    return { eligible: true };
  }

  /**
   * Validate EU VAT number using VIES API
   * 
   * @param vatNumber - Full VAT number including country code (e.g., DE123456789)
   * @returns Validation result
   */
  async validateVATNumber(vatNumber: string): Promise<VATValidationResult> {
    try {
      // Extract country code and number
      const cleanedVat = vatNumber.replace(/\s/g, '').toUpperCase();
      
      if (cleanedVat.length < 4) {
        return { valid: false, error: 'VAT number too short' };
      }

      const countryCode = cleanedVat.substring(0, 2);
      const vatNumberPart = cleanedVat.substring(2);

      // Validate country code
      if (!EU_COUNTRIES.includes(countryCode)) {
        return { valid: false, error: 'Invalid EU country code' };
      }

      // Call VIES API (European Commission VAT validation service)
      const result = await this.callVIESApi(countryCode, vatNumberPart);

      logger.info('VAT number validation', {
        vatNumber: `${countryCode}***`,
        valid: result.valid,
      });

      return result;
    } catch (error) {
      logger.error('Error validating VAT number', { error });
      
      // In case of API error, we can optionally allow the transaction
      // or reject it depending on business requirements
      return {
        valid: false,
        error: 'VAT validation service unavailable',
      };
    }
  }

  /**
   * Call VIES SOAP API for VAT validation
   */
  private async callVIESApi(
    countryCode: string,
    vatNumber: string
  ): Promise<VATValidationResult> {
    const soapEnvelope = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
                        xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
        <soapenv:Header/>
        <soapenv:Body>
          <urn:checkVat>
            <urn:countryCode>${countryCode}</urn:countryCode>
            <urn:vatNumber>${vatNumber}</urn:vatNumber>
          </urn:checkVat>
        </soapenv:Body>
      </soapenv:Envelope>
    `;

    try {
      const response = await fetch(
        'https://ec.europa.eu/taxation_customs/vies/services/checkVatService',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '',
          },
          body: soapEnvelope,
        }
      );

      const responseText = await response.text();

      // Parse SOAP response
      const validMatch = responseText.match(/<valid>(\w+)<\/valid>/);
      const nameMatch = responseText.match(/<name>([^<]*)<\/name>/);
      const addressMatch = responseText.match(/<address>([^<]*)<\/address>/);

      const isValid = validMatch !== null && validMatch[1].toLowerCase() === 'true';

      return {
        valid: isValid,
        countryCode,
        vatNumber: `${countryCode}${vatNumber}`,
        name: nameMatch ? nameMatch[1] : undefined,
        address: addressMatch ? addressMatch[1] : undefined,
      };
    } catch (error) {
      // If VIES is unavailable, we could:
      // 1. Reject (safer for tax compliance)
      // 2. Accept with manual review flag
      // 3. Use cached validation if available
      
      logger.warn('VIES API unavailable, falling back to format validation', { error });
      
      // Fallback: basic format validation only
      const formatValid = this.validateVATFormat(countryCode, vatNumber);
      
      return {
        valid: formatValid,
        countryCode,
        vatNumber: `${countryCode}${vatNumber}`,
        error: 'VIES unavailable - format validation only',
      };
    }
  }

  /**
   * Basic VAT number format validation
   * This is a fallback when VIES is unavailable
   */
  private validateVATFormat(countryCode: string, vatNumber: string): boolean {
    const patterns: Record<string, RegExp> = {
      AT: /^U\d{8}$/,
      BE: /^0\d{9}$/,
      BG: /^\d{9,10}$/,
      CY: /^\d{8}[A-Z]$/,
      CZ: /^\d{8,10}$/,
      DE: /^\d{9}$/,
      DK: /^\d{8}$/,
      EE: /^\d{9}$/,
      ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
      FI: /^\d{8}$/,
      FR: /^[A-Z0-9]{2}\d{9}$/,
      GB: /^\d{9}$|^\d{12}$|^GD\d{3}$|^HA\d{3}$/,
      GR: /^\d{9}$/,
      HR: /^\d{11}$/,
      HU: /^\d{8}$/,
      IE: /^\d{7}[A-Z]{1,2}$|^\d[A-Z]\d{5}[A-Z]$/,
      IT: /^\d{11}$/,
      LT: /^\d{9}$|^\d{12}$/,
      LU: /^\d{8}$/,
      LV: /^\d{11}$/,
      MT: /^\d{8}$/,
      NL: /^\d{9}B\d{2}$/,
      PL: /^\d{10}$/,
      PT: /^\d{9}$/,
      RO: /^\d{2,10}$/,
      SE: /^\d{12}$/,
      SI: /^\d{8}$/,
      SK: /^\d{10}$/,
    };

    const pattern = patterns[countryCode];
    if (!pattern) {
      return false;
    }

    return pattern.test(vatNumber);
  }

  /**
   * Get applicable tax rate for a country
   */
  getTaxRate(country: string): number {
    const countryUpper = country.toUpperCase();
    
    if (EU_COUNTRIES.includes(countryUpper)) {
      return EU_VAT_RATES[countryUpper] || 20;
    }
    
    if (countryUpper === 'GB') return 20;
    if (countryUpper === 'AU') return 10;
    if (countryUpper === 'NZ') return 15;
    if (countryUpper === 'JP') return 10;
    if (countryUpper === 'CA') return 5;
    
    return 0;
  }

  /**
   * Check if a country is in the EU
   */
  isEUCountry(country: string): boolean {
    return EU_COUNTRIES.includes(country.toUpperCase());
  }

  /**
   * Get list of supported tax jurisdictions
   */
  getSupportedJurisdictions(): string[] {
    return [
      ...EU_COUNTRIES,
      'GB', // UK
      'AU', // Australia
      'NZ', // New Zealand
      'CA', // Canada
      'JP', // Japan
      'US', // USA (state-level, handled by Stripe Tax)
    ];
  }
}

// Export singleton instance
export const taxService = new TaxService();
