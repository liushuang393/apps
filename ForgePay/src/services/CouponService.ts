/**
 * Coupon Service
 * 
 * Business logic for coupon management and validation
 * Requirements: 5.4 - Discount/Coupon System
 */

import {
  couponRepository,
  Coupon,
  CouponRedemption,
  CreateCouponParams,
  UpdateCouponParams,
  DiscountType,
} from '../repositories/CouponRepository';
import { productRepository } from '../repositories';
import { stripeClient } from './StripeClient';
import { logger } from '../utils/logger';

export interface CouponValidationResult {
  valid: boolean;
  coupon?: Coupon;
  errorCode?: string;
  errorMessage?: string;
  discountAmount?: number;
  discountType?: DiscountType;
}

export interface ApplyCouponParams {
  code: string;
  developerId: string;
  productId?: string;
  amount: number;
  currency: string;
  customerId?: string;
}

export interface CalculatedDiscount {
  discountAmount: number;
  finalAmount: number;
  discountType: DiscountType;
  discountValue: number;
}

export class CouponService {
  /**
   * Create a new coupon
   */
  async createCoupon(params: CreateCouponParams): Promise<Coupon> {
    // Validate percentage discounts are between 0 and 100
    if (params.discountType === 'percentage' && (params.discountValue <= 0 || params.discountValue > 100)) {
      throw new Error('Percentage discount must be between 1 and 100');
    }

    // Validate fixed amount discounts have a currency
    if (params.discountType === 'fixed_amount' && !params.currency) {
      throw new Error('Currency is required for fixed amount discounts');
    }

    // Validate that applies_to_products are valid product IDs
    if (params.appliesToProducts && params.appliesToProducts.length > 0) {
      for (const productId of params.appliesToProducts) {
        const product = await productRepository.findById(productId);
        if (!product || product.developerId !== params.developerId) {
          throw new Error(`Invalid product ID: ${productId}`);
        }
      }
    }

    // Check if code already exists for this developer
    const existing = await couponRepository.findByCode(params.developerId, params.code);
    if (existing) {
      throw new Error(`Coupon code already exists: ${params.code}`);
    }

    // Optionally create coupon in Stripe
    let stripeCouponId: string | undefined;
    try {
      const stripeCoupon = await stripeClient.createCoupon({
        id: `${params.developerId}_${params.code}`,
        name: params.name,
        percent_off: params.discountType === 'percentage' ? params.discountValue : undefined,
        amount_off: params.discountType === 'fixed_amount' ? params.discountValue : undefined,
        currency: params.discountType === 'fixed_amount' ? params.currency : undefined,
        max_redemptions: params.maxRedemptions || undefined,
        redeem_by: params.expiresAt ? Math.floor(params.expiresAt.getTime() / 1000) : undefined,
        metadata: {
          developer_id: params.developerId,
          ...params.metadata,
        },
      });
      stripeCouponId = stripeCoupon.id;
    } catch (error) {
      logger.warn('Failed to create Stripe coupon, proceeding without Stripe sync', { error });
    }

    const coupon = await couponRepository.create({
      ...params,
      stripeCouponId,
    });

    logger.info('Coupon created', {
      couponId: coupon.id,
      code: coupon.code,
      developerId: params.developerId,
    });

    return coupon;
  }

  /**
   * Validate a coupon code
   */
  async validateCoupon(params: ApplyCouponParams): Promise<CouponValidationResult> {
    const { code, developerId, productId, amount, currency, customerId } = params;

    // Find the coupon
    const coupon = await couponRepository.findByCode(developerId, code);
    if (!coupon) {
      return {
        valid: false,
        errorCode: 'coupon_not_found',
        errorMessage: 'Coupon not found',
      };
    }

    // Check if coupon is active
    if (!coupon.active) {
      return {
        valid: false,
        errorCode: 'coupon_inactive',
        errorMessage: 'This coupon is no longer active',
      };
    }

    // Check if coupon has expired
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return {
        valid: false,
        errorCode: 'coupon_expired',
        errorMessage: 'This coupon has expired',
      };
    }

    // Check max redemptions
    if (coupon.maxRedemptions && coupon.redemptionCount >= coupon.maxRedemptions) {
      return {
        valid: false,
        errorCode: 'coupon_max_redemptions',
        errorMessage: 'This coupon has reached its maximum number of redemptions',
      };
    }

    // Check minimum purchase amount
    if (coupon.minPurchaseAmount && amount < coupon.minPurchaseAmount) {
      return {
        valid: false,
        errorCode: 'coupon_min_purchase',
        errorMessage: `Minimum purchase amount of ${coupon.minPurchaseAmount / 100} ${coupon.currency || currency} required`,
      };
    }

    // Check if coupon applies to this product
    if (coupon.appliesToProducts && coupon.appliesToProducts.length > 0 && productId) {
      if (!coupon.appliesToProducts.includes(productId)) {
        return {
          valid: false,
          errorCode: 'coupon_product_mismatch',
          errorMessage: 'This coupon does not apply to the selected product',
        };
      }
    }

    // Check currency for fixed amount discounts
    if (coupon.discountType === 'fixed_amount' && coupon.currency !== currency) {
      return {
        valid: false,
        errorCode: 'coupon_currency_mismatch',
        errorMessage: `This coupon is only valid for ${coupon.currency} purchases`,
      };
    }

    // Check if customer has already redeemed this coupon (if customerId provided)
    if (customerId) {
      const hasRedeemed = await couponRepository.hasCustomerRedeemedCoupon(coupon.id, customerId);
      if (hasRedeemed) {
        return {
          valid: false,
          errorCode: 'coupon_already_redeemed',
          errorMessage: 'You have already used this coupon',
        };
      }
    }

    // Calculate discount amount
    const discount = this.calculateDiscount(coupon, amount);

    return {
      valid: true,
      coupon,
      discountAmount: discount.discountAmount,
      discountType: coupon.discountType,
    };
  }

  /**
   * Calculate discount amount based on coupon type
   */
  calculateDiscount(coupon: Coupon, amount: number): CalculatedDiscount {
    let discountAmount: number;

    if (coupon.discountType === 'percentage') {
      discountAmount = Math.floor(amount * (coupon.discountValue / 100));
    } else {
      // Fixed amount discount
      discountAmount = Math.min(coupon.discountValue, amount);
    }

    const finalAmount = Math.max(0, amount - discountAmount);

    return {
      discountAmount,
      finalAmount,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    };
  }

  /**
   * Apply a coupon and record the redemption
   */
  async applyCoupon(params: ApplyCouponParams & { checkoutSessionId?: string }): Promise<{
    coupon: Coupon;
    redemption: CouponRedemption;
    discount: CalculatedDiscount;
  }> {
    const { amount, currency, customerId, checkoutSessionId } = params;

    // Validate the coupon first
    const validation = await this.validateCoupon(params);
    if (!validation.valid || !validation.coupon) {
      throw new Error(validation.errorMessage || 'Invalid coupon');
    }

    const coupon = validation.coupon;
    const discount = this.calculateDiscount(coupon, amount);

    // Record the redemption (requires customerId)
    if (!customerId) {
      throw new Error('Customer ID is required to apply coupon');
    }

    const redemption = await couponRepository.recordRedemption({
      couponId: coupon.id,
      customerId,
      checkoutSessionId,
      discountAmount: discount.discountAmount,
      originalAmount: amount,
      currency,
    });

    logger.info('Coupon applied', {
      couponId: coupon.id,
      code: coupon.code,
      customerId,
      discountAmount: discount.discountAmount,
      originalAmount: amount,
    });

    return { coupon, redemption, discount };
  }

  /**
   * Get a coupon by ID
   */
  async getCoupon(id: string): Promise<Coupon | null> {
    return couponRepository.findById(id);
  }

  /**
   * Get a coupon by code
   */
  async getCouponByCode(developerId: string, code: string): Promise<Coupon | null> {
    return couponRepository.findByCode(developerId, code);
  }

  /**
   * List coupons for a developer
   */
  async listCoupons(
    developerId: string,
    options?: { activeOnly?: boolean; limit?: number; offset?: number }
  ): Promise<{ coupons: Coupon[]; total: number }> {
    return couponRepository.findByDeveloperId(developerId, options);
  }

  /**
   * Update a coupon
   */
  async updateCoupon(id: string, params: UpdateCouponParams): Promise<Coupon | null> {
    const coupon = await couponRepository.findById(id);
    if (!coupon) {
      return null;
    }

    // Update in Stripe if synced
    if (coupon.stripeCouponId) {
      try {
        // Stripe coupons are immutable, so we can only update metadata
        // Other changes would require creating a new coupon
        await stripeClient.updateCoupon(coupon.stripeCouponId, {
          name: params.name,
          metadata: params.metadata,
        });
      } catch (error) {
        logger.warn('Failed to update Stripe coupon', { error, couponId: id });
      }
    }

    const updated = await couponRepository.update(id, params);

    if (updated) {
      logger.info('Coupon updated', { couponId: id, updates: params });
    }

    return updated;
  }

  /**
   * Deactivate a coupon
   */
  async deactivateCoupon(id: string): Promise<Coupon | null> {
    const coupon = await couponRepository.findById(id);
    if (!coupon) {
      return null;
    }

    // Delete from Stripe if synced
    if (coupon.stripeCouponId) {
      try {
        await stripeClient.deleteCoupon(coupon.stripeCouponId);
      } catch (error) {
        logger.warn('Failed to delete Stripe coupon', { error, couponId: id });
      }
    }

    const updated = await couponRepository.deactivate(id);

    if (updated) {
      logger.info('Coupon deactivated', { couponId: id });
    }

    return updated;
  }

  /**
   * Delete a coupon
   */
  async deleteCoupon(id: string): Promise<boolean> {
    const coupon = await couponRepository.findById(id);
    if (!coupon) {
      return false;
    }

    // Delete from Stripe if synced
    if (coupon.stripeCouponId) {
      try {
        await stripeClient.deleteCoupon(coupon.stripeCouponId);
      } catch (error) {
        logger.warn('Failed to delete Stripe coupon', { error, couponId: id });
      }
    }

    const deleted = await couponRepository.delete(id);

    if (deleted) {
      logger.info('Coupon deleted', { couponId: id });
    }

    return deleted;
  }

  /**
   * Get redemption statistics for a coupon
   */
  async getCouponStats(id: string): Promise<{
    totalRedemptions: number;
    totalDiscountAmount: number;
    uniqueCustomers: number;
    averageDiscount: number;
  } | null> {
    const coupon = await couponRepository.findById(id);
    if (!coupon) {
      return null;
    }

    const redemptions = await couponRepository.getRedemptions(id);

    const uniqueCustomers = new Set(redemptions.map((r) => r.customerId)).size;
    const totalDiscountAmount = redemptions.reduce((sum, r) => sum + r.discountAmount, 0);

    return {
      totalRedemptions: redemptions.length,
      totalDiscountAmount,
      uniqueCustomers,
      averageDiscount: redemptions.length > 0 ? Math.floor(totalDiscountAmount / redemptions.length) : 0,
    };
  }

  /**
   * Get customer's coupon redemption history
   */
  async getCustomerRedemptions(customerId: string): Promise<CouponRedemption[]> {
    return couponRepository.getCustomerRedemptions(customerId);
  }
}

export const couponService = new CouponService();
