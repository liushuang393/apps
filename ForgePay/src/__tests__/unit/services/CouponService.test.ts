import { CouponService, ApplyCouponParams } from '../../../services/CouponService';
import { Coupon, CouponRedemption, DiscountType } from '../../../repositories/CouponRepository';

// Mock dependencies
jest.mock('../../../repositories/CouponRepository', () => ({
  couponRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findByCode: jest.fn(),
    findByDeveloperId: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    delete: jest.fn(),
    recordRedemption: jest.fn(),
    hasCustomerRedeemedCoupon: jest.fn(),
    getRedemptions: jest.fn(),
    getCustomerRedemptions: jest.fn(),
  },
}));

jest.mock('../../../repositories', () => ({
  productRepository: {
    findById: jest.fn(),
  },
}));

jest.mock('../../../services/StripeClient', () => ({
  stripeClient: {
    createCoupon: jest.fn(),
    updateCoupon: jest.fn(),
    deleteCoupon: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { couponRepository } from '../../../repositories/CouponRepository';
import { productRepository } from '../../../repositories';
import { stripeClient } from '../../../services/StripeClient';

const mockCouponRepository = couponRepository as jest.Mocked<typeof couponRepository>;
const mockProductRepository = productRepository as jest.Mocked<typeof productRepository>;
const mockStripeClient = stripeClient as jest.Mocked<typeof stripeClient>;

describe('CouponService', () => {
  let service: CouponService;

  const mockCoupon: Coupon = {
    id: 'coupon-123',
    developerId: 'dev-123',
    code: 'SAVE20',
    name: '20% off',
    discountType: 'percentage' as DiscountType,
    discountValue: 20,
    currency: null,
    maxRedemptions: 100,
    redemptionCount: 0,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    minPurchaseAmount: null,
    appliesToProducts: null,
    active: true,
    stripeCouponId: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    service = new CouponService();
    jest.clearAllMocks();
  });

  describe('createCoupon', () => {
    it('should create a percentage coupon successfully', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(null);
      mockCouponRepository.create.mockResolvedValue(mockCoupon);
      mockStripeClient.createCoupon.mockResolvedValue({ id: 'stripe_coupon_123' } as any);

      const result = await service.createCoupon({
        developerId: 'dev-123',
        code: 'SAVE20',
        name: '20% off',
        discountType: 'percentage',
        discountValue: 20,
      });

      expect(result).toEqual(mockCoupon);
      expect(mockCouponRepository.create).toHaveBeenCalled();
    });

    it('should throw error for invalid percentage discount over 100', async () => {
      await expect(
        service.createCoupon({
          developerId: 'dev-123',
          code: 'INVALID',
          name: 'Invalid coupon',
          discountType: 'percentage',
          discountValue: 150,
        })
      ).rejects.toThrow('Percentage discount must be between 1 and 100');
    });

    it('should throw error for percentage discount of 0', async () => {
      await expect(
        service.createCoupon({
          developerId: 'dev-123',
          code: 'INVALID',
          name: 'Invalid coupon',
          discountType: 'percentage',
          discountValue: 0,
        })
      ).rejects.toThrow('Percentage discount must be between 1 and 100');
    });

    it('should throw error for fixed amount without currency', async () => {
      await expect(
        service.createCoupon({
          developerId: 'dev-123',
          code: 'FIXED10',
          name: '$10 off',
          discountType: 'fixed_amount',
          discountValue: 1000,
        })
      ).rejects.toThrow('Currency is required for fixed amount discounts');
    });

    it('should create fixed amount coupon with currency', async () => {
      const fixedCoupon = {
        ...mockCoupon,
        discountType: 'fixed_amount' as DiscountType,
        discountValue: 1000,
        currency: 'usd',
      };
      
      mockCouponRepository.findByCode.mockResolvedValue(null);
      mockCouponRepository.create.mockResolvedValue(fixedCoupon);
      mockStripeClient.createCoupon.mockResolvedValue({ id: 'stripe_coupon_123' } as any);

      const result = await service.createCoupon({
        developerId: 'dev-123',
        code: 'FIXED10',
        name: '$10 off',
        discountType: 'fixed_amount',
        discountValue: 1000,
        currency: 'usd',
      });

      expect(result.discountType).toBe('fixed_amount');
      expect(result.currency).toBe('usd');
    });

    it('should throw error if coupon code already exists', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(mockCoupon);

      await expect(
        service.createCoupon({
          developerId: 'dev-123',
          code: 'SAVE20',
          name: '20% off',
          discountType: 'percentage',
          discountValue: 20,
        })
      ).rejects.toThrow('Coupon code already exists: SAVE20');
    });

    it('should validate product IDs if appliesToProducts is provided', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(null);
      mockProductRepository.findById.mockResolvedValue(null);

      await expect(
        service.createCoupon({
          developerId: 'dev-123',
          code: 'SAVE20',
          name: '20% off',
          discountType: 'percentage',
          discountValue: 20,
          appliesToProducts: ['invalid-product-id'],
        })
      ).rejects.toThrow('Invalid product ID: invalid-product-id');
    });

    it('should continue without Stripe if Stripe fails', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(null);
      mockCouponRepository.create.mockResolvedValue(mockCoupon);
      mockStripeClient.createCoupon.mockRejectedValue(new Error('Stripe error'));

      const result = await service.createCoupon({
        developerId: 'dev-123',
        code: 'SAVE20',
        name: '20% off',
        discountType: 'percentage',
        discountValue: 20,
      });

      expect(result).toEqual(mockCoupon);
    });
  });

  describe('validateCoupon', () => {
    const baseParams: ApplyCouponParams = {
      code: 'SAVE20',
      developerId: 'dev-123',
      amount: 10000,
      currency: 'usd',
    };

    it('should return valid for active coupon', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(mockCoupon);

      const result = await service.validateCoupon(baseParams);

      expect(result.valid).toBe(true);
      expect(result.coupon).toEqual(mockCoupon);
      expect(result.discountAmount).toBe(2000); // 20% of 10000
    });

    it('should return invalid if coupon not found', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(null);

      const result = await service.validateCoupon(baseParams);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('coupon_not_found');
    });

    it('should return invalid if coupon is inactive', async () => {
      mockCouponRepository.findByCode.mockResolvedValue({
        ...mockCoupon,
        active: false,
      });

      const result = await service.validateCoupon(baseParams);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('coupon_inactive');
    });

    it('should return invalid if coupon has expired', async () => {
      mockCouponRepository.findByCode.mockResolvedValue({
        ...mockCoupon,
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.validateCoupon(baseParams);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('coupon_expired');
    });

    it('should return invalid if max redemptions reached', async () => {
      mockCouponRepository.findByCode.mockResolvedValue({
        ...mockCoupon,
        maxRedemptions: 10,
        redemptionCount: 10,
      });

      const result = await service.validateCoupon(baseParams);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('coupon_max_redemptions');
    });

    it('should return invalid if below minimum purchase amount', async () => {
      mockCouponRepository.findByCode.mockResolvedValue({
        ...mockCoupon,
        minPurchaseAmount: 20000,
      });

      const result = await service.validateCoupon({
        ...baseParams,
        amount: 10000,
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('coupon_min_purchase');
    });

    it('should return invalid if product not in allowed list', async () => {
      mockCouponRepository.findByCode.mockResolvedValue({
        ...mockCoupon,
        appliesToProducts: ['prod-1', 'prod-2'],
      });

      const result = await service.validateCoupon({
        ...baseParams,
        productId: 'prod-3',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('coupon_product_mismatch');
    });

    it('should return invalid for currency mismatch with fixed amount', async () => {
      mockCouponRepository.findByCode.mockResolvedValue({
        ...mockCoupon,
        discountType: 'fixed_amount' as DiscountType,
        discountValue: 1000,
        currency: 'eur',
      });

      const result = await service.validateCoupon({
        ...baseParams,
        currency: 'usd',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('coupon_currency_mismatch');
    });

    it('should return invalid if customer already redeemed', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(mockCoupon);
      mockCouponRepository.hasCustomerRedeemedCoupon.mockResolvedValue(true);

      const result = await service.validateCoupon({
        ...baseParams,
        customerId: 'customer-123',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('coupon_already_redeemed');
    });
  });

  describe('calculateDiscount', () => {
    it('should calculate percentage discount correctly', () => {
      const result = service.calculateDiscount(mockCoupon, 10000);

      expect(result.discountAmount).toBe(2000); // 20% of 10000
      expect(result.finalAmount).toBe(8000);
      expect(result.discountType).toBe('percentage');
    });

    it('should calculate fixed amount discount correctly', () => {
      const fixedCoupon = {
        ...mockCoupon,
        discountType: 'fixed_amount' as DiscountType,
        discountValue: 1500,
      };

      const result = service.calculateDiscount(fixedCoupon, 10000);

      expect(result.discountAmount).toBe(1500);
      expect(result.finalAmount).toBe(8500);
    });

    it('should cap fixed discount at original amount', () => {
      const fixedCoupon = {
        ...mockCoupon,
        discountType: 'fixed_amount' as DiscountType,
        discountValue: 15000,
      };

      const result = service.calculateDiscount(fixedCoupon, 10000);

      expect(result.discountAmount).toBe(10000);
      expect(result.finalAmount).toBe(0);
    });

    it('should floor percentage discount for rounding', () => {
      const result = service.calculateDiscount(mockCoupon, 10001);

      // 20% of 10001 = 2000.2, floored to 2000
      expect(result.discountAmount).toBe(2000);
    });
  });

  describe('applyCoupon', () => {
    it('should apply coupon and record redemption', async () => {
      const mockRedemption: CouponRedemption = {
        id: 'redemption-123',
        couponId: mockCoupon.id,
        customerId: 'customer-123',
        checkoutSessionId: 'session-123',
        discountAmount: 2000,
        originalAmount: 10000,
        currency: 'usd',
        redeemedAt: new Date(),
      };

      mockCouponRepository.findByCode.mockResolvedValue(mockCoupon);
      mockCouponRepository.hasCustomerRedeemedCoupon.mockResolvedValue(false);
      mockCouponRepository.recordRedemption.mockResolvedValue(mockRedemption);

      const result = await service.applyCoupon({
        code: 'SAVE20',
        developerId: 'dev-123',
        amount: 10000,
        currency: 'usd',
        customerId: 'customer-123',
        checkoutSessionId: 'session-123',
      });

      expect(result.coupon).toEqual(mockCoupon);
      expect(result.redemption).toEqual(mockRedemption);
      expect(result.discount.discountAmount).toBe(2000);
    });

    it('should throw error if validation fails', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(null);

      await expect(
        service.applyCoupon({
          code: 'INVALID',
          developerId: 'dev-123',
          amount: 10000,
          currency: 'usd',
          customerId: 'customer-123',
        })
      ).rejects.toThrow('Coupon not found');
    });

    it('should throw error if no customerId provided', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(mockCoupon);

      await expect(
        service.applyCoupon({
          code: 'SAVE20',
          developerId: 'dev-123',
          amount: 10000,
          currency: 'usd',
        })
      ).rejects.toThrow('Customer ID is required to apply coupon');
    });
  });

  describe('getCoupon', () => {
    it('should return coupon by ID', async () => {
      mockCouponRepository.findById.mockResolvedValue(mockCoupon);

      const result = await service.getCoupon('coupon-123');

      expect(result).toEqual(mockCoupon);
    });

    it('should return null if not found', async () => {
      mockCouponRepository.findById.mockResolvedValue(null);

      const result = await service.getCoupon('invalid-id');

      expect(result).toBeNull();
    });
  });

  describe('getCouponByCode', () => {
    it('should return coupon by code', async () => {
      mockCouponRepository.findByCode.mockResolvedValue(mockCoupon);

      const result = await service.getCouponByCode('dev-123', 'SAVE20');

      expect(result).toEqual(mockCoupon);
    });
  });

  describe('listCoupons', () => {
    it('should return coupons for developer', async () => {
      mockCouponRepository.findByDeveloperId.mockResolvedValue({
        coupons: [mockCoupon],
        total: 1,
      });

      const result = await service.listCoupons('dev-123');

      expect(result.coupons).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('updateCoupon', () => {
    it('should update coupon successfully', async () => {
      const updatedCoupon = { ...mockCoupon, name: 'Updated name' };
      mockCouponRepository.findById.mockResolvedValue(mockCoupon);
      mockCouponRepository.update.mockResolvedValue(updatedCoupon);

      const result = await service.updateCoupon('coupon-123', { name: 'Updated name' });

      expect(result?.name).toBe('Updated name');
    });

    it('should return null if coupon not found', async () => {
      mockCouponRepository.findById.mockResolvedValue(null);

      const result = await service.updateCoupon('invalid-id', { name: 'Updated' });

      expect(result).toBeNull();
    });

    it('should update Stripe coupon if synced', async () => {
      mockCouponRepository.findById.mockResolvedValue({
        ...mockCoupon,
        stripeCouponId: 'stripe_123',
      });
      mockCouponRepository.update.mockResolvedValue(mockCoupon);

      await service.updateCoupon('coupon-123', { name: 'Updated' });

      expect(mockStripeClient.updateCoupon).toHaveBeenCalled();
    });
  });

  describe('deactivateCoupon', () => {
    it('should deactivate coupon successfully', async () => {
      const deactivatedCoupon = { ...mockCoupon, active: false };
      mockCouponRepository.findById.mockResolvedValue(mockCoupon);
      mockCouponRepository.deactivate.mockResolvedValue(deactivatedCoupon);

      const result = await service.deactivateCoupon('coupon-123');

      expect(result?.active).toBe(false);
    });

    it('should delete Stripe coupon if synced', async () => {
      mockCouponRepository.findById.mockResolvedValue({
        ...mockCoupon,
        stripeCouponId: 'stripe_123',
      });
      mockCouponRepository.deactivate.mockResolvedValue(mockCoupon);

      await service.deactivateCoupon('coupon-123');

      expect(mockStripeClient.deleteCoupon).toHaveBeenCalledWith('stripe_123');
    });
  });

  describe('deleteCoupon', () => {
    it('should delete coupon successfully', async () => {
      mockCouponRepository.findById.mockResolvedValue(mockCoupon);
      mockCouponRepository.delete.mockResolvedValue(true);

      const result = await service.deleteCoupon('coupon-123');

      expect(result).toBe(true);
    });

    it('should return false if coupon not found', async () => {
      mockCouponRepository.findById.mockResolvedValue(null);

      const result = await service.deleteCoupon('invalid-id');

      expect(result).toBe(false);
    });
  });

  describe('getCouponStats', () => {
    it('should return coupon statistics', async () => {
      mockCouponRepository.findById.mockResolvedValue(mockCoupon);
      mockCouponRepository.getRedemptions.mockResolvedValue([
        {
          id: 'r1',
          couponId: mockCoupon.id,
          customerId: 'c1',
          checkoutSessionId: null,
          discountAmount: 1000,
          originalAmount: 5000,
          currency: 'usd',
          redeemedAt: new Date(),
        },
        {
          id: 'r2',
          couponId: mockCoupon.id,
          customerId: 'c2',
          checkoutSessionId: null,
          discountAmount: 2000,
          originalAmount: 10000,
          currency: 'usd',
          redeemedAt: new Date(),
        },
      ]);

      const result = await service.getCouponStats('coupon-123');

      expect(result?.totalRedemptions).toBe(2);
      expect(result?.totalDiscountAmount).toBe(3000);
      expect(result?.uniqueCustomers).toBe(2);
      expect(result?.averageDiscount).toBe(1500);
    });

    it('should return null if coupon not found', async () => {
      mockCouponRepository.findById.mockResolvedValue(null);

      const result = await service.getCouponStats('invalid-id');

      expect(result).toBeNull();
    });

    it('should handle zero redemptions', async () => {
      mockCouponRepository.findById.mockResolvedValue(mockCoupon);
      mockCouponRepository.getRedemptions.mockResolvedValue([]);

      const result = await service.getCouponStats('coupon-123');

      expect(result?.totalRedemptions).toBe(0);
      expect(result?.averageDiscount).toBe(0);
    });
  });

  describe('getCustomerRedemptions', () => {
    it('should return customer redemptions', async () => {
      const redemptions: CouponRedemption[] = [
        {
          id: 'r1',
          couponId: mockCoupon.id,
          customerId: 'c1',
          checkoutSessionId: null,
          discountAmount: 1000,
          originalAmount: 5000,
          currency: 'usd',
          redeemedAt: new Date(),
        },
      ];
      mockCouponRepository.getCustomerRedemptions.mockResolvedValue(redemptions);

      const result = await service.getCustomerRedemptions('c1');

      expect(result).toEqual(redemptions);
    });
  });
});
