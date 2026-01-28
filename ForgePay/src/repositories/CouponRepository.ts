/**
 * Coupon Repository
 * 
 * Handles database operations for coupons and redemptions
 * Requirements: 5.4 - Discount/Coupon System
 */

import { PoolClient } from 'pg';
import { pool } from '../config/database';

export type DiscountType = 'percentage' | 'fixed_amount';

export interface Coupon {
  id: string;
  developerId: string;
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  currency: string | null;
  minPurchaseAmount: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  appliesToProducts: string[] | null;
  active: boolean;
  expiresAt: Date | null;
  stripeCouponId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CouponRedemption {
  id: string;
  couponId: string;
  customerId: string;
  checkoutSessionId: string | null;
  discountAmount: number;
  originalAmount: number;
  currency: string;
  redeemedAt: Date;
}

export interface CreateCouponParams {
  developerId: string;
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  currency?: string;
  minPurchaseAmount?: number;
  maxRedemptions?: number;
  appliesToProducts?: string[];
  expiresAt?: Date;
  stripeCouponId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateCouponParams {
  name?: string;
  active?: boolean;
  maxRedemptions?: number;
  expiresAt?: Date;
  stripeCouponId?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordRedemptionParams {
  couponId: string;
  customerId: string;
  checkoutSessionId?: string;
  discountAmount: number;
  originalAmount: number;
  currency: string;
}

export class CouponRepository {
  /**
   * Create a new coupon
   */
  async create(params: CreateCouponParams, client?: PoolClient): Promise<Coupon> {
    const dbClient = client || pool;

    const result = await dbClient.query(
      `INSERT INTO coupons (
        developer_id, code, name, discount_type, discount_value, currency,
        min_purchase_amount, max_redemptions, applies_to_products,
        expires_at, stripe_coupon_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        params.developerId,
        params.code.toUpperCase(),
        params.name,
        params.discountType,
        params.discountValue,
        params.currency || null,
        params.minPurchaseAmount || null,
        params.maxRedemptions || null,
        params.appliesToProducts || null,
        params.expiresAt || null,
        params.stripeCouponId || null,
        JSON.stringify(params.metadata || {}),
      ]
    );

    return this.mapRowToCoupon(result.rows[0]);
  }

  /**
   * Find coupon by ID
   */
  async findById(id: string, client?: PoolClient): Promise<Coupon | null> {
    const dbClient = client || pool;

    const result = await dbClient.query(
      'SELECT * FROM coupons WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToCoupon(result.rows[0]);
  }

  /**
   * Find coupon by code for a specific developer
   */
  async findByCode(developerId: string, code: string, client?: PoolClient): Promise<Coupon | null> {
    const dbClient = client || pool;

    const result = await dbClient.query(
      'SELECT * FROM coupons WHERE developer_id = $1 AND code = $2',
      [developerId, code.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToCoupon(result.rows[0]);
  }

  /**
   * Find coupons by developer ID
   */
  async findByDeveloperId(
    developerId: string,
    options?: { activeOnly?: boolean; limit?: number; offset?: number },
    client?: PoolClient
  ): Promise<{ coupons: Coupon[]; total: number }> {
    const dbClient = client || pool;
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    let whereClause = 'WHERE developer_id = $1';
    const params: (string | number | boolean)[] = [developerId];

    if (options?.activeOnly) {
      whereClause += ' AND active = true AND (expires_at IS NULL OR expires_at > NOW())';
    }

    // Get total count
    const countResult = await dbClient.query(
      `SELECT COUNT(*) as total FROM coupons ${whereClause}`,
      params
    );

    // Get coupons
    const result = await dbClient.query(
      `SELECT * FROM coupons ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return {
      coupons: result.rows.map((row) => this.mapRowToCoupon(row)),
      total: parseInt(countResult.rows[0].total),
    };
  }

  /**
   * Update a coupon
   */
  async update(id: string, params: UpdateCouponParams, client?: PoolClient): Promise<Coupon | null> {
    const dbClient = client || pool;

    const updates: string[] = [];
    const values: (string | number | boolean | Date | Record<string, unknown> | null)[] = [];
    let paramIndex = 1;

    if (params.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(params.name);
    }

    if (params.active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(params.active);
    }

    if (params.maxRedemptions !== undefined) {
      updates.push(`max_redemptions = $${paramIndex++}`);
      values.push(params.maxRedemptions);
    }

    if (params.expiresAt !== undefined) {
      updates.push(`expires_at = $${paramIndex++}`);
      values.push(params.expiresAt);
    }

    if (params.stripeCouponId !== undefined) {
      updates.push(`stripe_coupon_id = $${paramIndex++}`);
      values.push(params.stripeCouponId);
    }

    if (params.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(params.metadata));
    }

    if (updates.length === 0) {
      return this.findById(id, client);
    }

    values.push(id);

    const result = await dbClient.query(
      `UPDATE coupons SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToCoupon(result.rows[0]);
  }

  /**
   * Deactivate a coupon
   */
  async deactivate(id: string, client?: PoolClient): Promise<Coupon | null> {
    return this.update(id, { active: false }, client);
  }

  /**
   * Delete a coupon (if no redemptions exist)
   */
  async delete(id: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || pool;

    // Check for redemptions
    const redemptionCheck = await dbClient.query(
      'SELECT COUNT(*) as count FROM coupon_redemptions WHERE coupon_id = $1',
      [id]
    );

    if (parseInt(redemptionCheck.rows[0].count) > 0) {
      throw new Error('Cannot delete coupon with existing redemptions');
    }

    const result = await dbClient.query(
      'DELETE FROM coupons WHERE id = $1',
      [id]
    );

    return result.rowCount! > 0;
  }

  /**
   * Increment redemption count
   */
  async incrementRedemptionCount(id: string, client?: PoolClient): Promise<void> {
    const dbClient = client || pool;

    await dbClient.query(
      'UPDATE coupons SET redemption_count = redemption_count + 1 WHERE id = $1',
      [id]
    );
  }

  /**
   * Record a coupon redemption
   */
  async recordRedemption(params: RecordRedemptionParams, client?: PoolClient): Promise<CouponRedemption> {
    const dbClient = client || pool;

    const result = await dbClient.query(
      `INSERT INTO coupon_redemptions (
        coupon_id, customer_id, checkout_session_id,
        discount_amount, original_amount, currency
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        params.couponId,
        params.customerId,
        params.checkoutSessionId || null,
        params.discountAmount,
        params.originalAmount,
        params.currency,
      ]
    );

    // Increment redemption count
    await this.incrementRedemptionCount(params.couponId, client);

    return this.mapRowToRedemption(result.rows[0]);
  }

  /**
   * Get redemptions for a coupon
   */
  async getRedemptions(couponId: string, client?: PoolClient): Promise<CouponRedemption[]> {
    const dbClient = client || pool;

    const result = await dbClient.query(
      'SELECT * FROM coupon_redemptions WHERE coupon_id = $1 ORDER BY redeemed_at DESC',
      [couponId]
    );

    return result.rows.map((row) => this.mapRowToRedemption(row));
  }

  /**
   * Get redemptions for a customer
   */
  async getCustomerRedemptions(customerId: string, client?: PoolClient): Promise<CouponRedemption[]> {
    const dbClient = client || pool;

    const result = await dbClient.query(
      'SELECT * FROM coupon_redemptions WHERE customer_id = $1 ORDER BY redeemed_at DESC',
      [customerId]
    );

    return result.rows.map((row) => this.mapRowToRedemption(row));
  }

  /**
   * Check if a customer has already redeemed a specific coupon
   */
  async hasCustomerRedeemedCoupon(couponId: string, customerId: string, client?: PoolClient): Promise<boolean> {
    const dbClient = client || pool;

    const result = await dbClient.query(
      'SELECT COUNT(*) as count FROM coupon_redemptions WHERE coupon_id = $1 AND customer_id = $2',
      [couponId, customerId]
    );

    return parseInt(result.rows[0].count) > 0;
  }

  /**
   * Map database row to Coupon object
   */
  private mapRowToCoupon(row: Record<string, unknown>): Coupon {
    return {
      id: row.id as string,
      developerId: row.developer_id as string,
      code: row.code as string,
      name: row.name as string,
      discountType: row.discount_type as DiscountType,
      discountValue: row.discount_value as number,
      currency: row.currency as string | null,
      minPurchaseAmount: row.min_purchase_amount as number | null,
      maxRedemptions: row.max_redemptions as number | null,
      redemptionCount: row.redemption_count as number,
      appliesToProducts: row.applies_to_products as string[] | null,
      active: row.active as boolean,
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      stripeCouponId: row.stripe_coupon_id as string | null,
      metadata: (row.metadata || {}) as Record<string, unknown>,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  /**
   * Map database row to CouponRedemption object
   */
  private mapRowToRedemption(row: Record<string, unknown>): CouponRedemption {
    return {
      id: row.id as string,
      couponId: row.coupon_id as string,
      customerId: row.customer_id as string,
      checkoutSessionId: row.checkout_session_id as string | null,
      discountAmount: row.discount_amount as number,
      originalAmount: row.original_amount as number,
      currency: row.currency as string,
      redeemedAt: new Date(row.redeemed_at as string),
    };
  }
}

export const couponRepository = new CouponRepository();
