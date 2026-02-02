/**
 * Migration: Create coupons table
 * 
 * Implements discount and coupon functionality
 * Requirements: 5.4 - Discount/Coupon System
 */

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create discount type enum
  pgm.createType('discount_type', ['percentage', 'fixed_amount']);

  // Create coupons table
  pgm.createTable('coupons', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    developer_id: {
      type: 'uuid',
      notNull: true,
      references: 'developers(id)',
      onDelete: 'CASCADE',
    },
    code: {
      type: 'varchar(50)',
      notNull: true,
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    discount_type: {
      type: 'discount_type',
      notNull: true,
    },
    discount_value: {
      type: 'integer',
      notNull: true,
    },
    currency: {
      type: 'varchar(3)',
      comment: 'Required for fixed_amount discounts',
    },
    min_purchase_amount: {
      type: 'integer',
      comment: 'Minimum purchase amount to apply coupon',
    },
    max_redemptions: {
      type: 'integer',
      comment: 'Maximum total redemptions allowed',
    },
    redemption_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    applies_to_products: {
      type: 'uuid[]',
      comment: 'Array of product IDs this coupon applies to (null = all products)',
    },
    active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    expires_at: {
      type: 'timestamptz',
    },
    stripe_coupon_id: {
      type: 'varchar(255)',
      comment: 'Stripe coupon ID if synced with Stripe',
    },
    metadata: {
      type: 'jsonb',
      default: '{}',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Create unique index on developer_id + code
  pgm.createIndex('coupons', ['developer_id', 'code'], {
    unique: true,
    name: 'coupons_developer_id_code_unique_idx',
  });

  // Index for active coupons
  pgm.createIndex('coupons', ['developer_id', 'active'], {
    name: 'coupons_developer_id_active_idx',
  });

  // Index for looking up by Stripe coupon ID
  pgm.createIndex('coupons', ['stripe_coupon_id'], {
    name: 'coupons_stripe_coupon_id_idx',
    where: 'stripe_coupon_id IS NOT NULL',
  });

  // Create coupon_redemptions table to track individual redemptions
  pgm.createTable('coupon_redemptions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    coupon_id: {
      type: 'uuid',
      notNull: true,
      references: 'coupons(id)',
      onDelete: 'CASCADE',
    },
    customer_id: {
      type: 'uuid',
      notNull: true,
      references: 'customers(id)',
      onDelete: 'CASCADE',
    },
    checkout_session_id: {
      type: 'uuid',
      references: 'checkout_sessions(id)',
      onDelete: 'SET NULL',
    },
    discount_amount: {
      type: 'integer',
      notNull: true,
      comment: 'Amount discounted in smallest currency unit',
    },
    original_amount: {
      type: 'integer',
      notNull: true,
      comment: 'Original amount before discount',
    },
    currency: {
      type: 'varchar(3)',
      notNull: true,
    },
    redeemed_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Index for looking up redemptions by coupon
  pgm.createIndex('coupon_redemptions', ['coupon_id'], {
    name: 'coupon_redemptions_coupon_id_idx',
  });

  // Index for looking up redemptions by customer
  pgm.createIndex('coupon_redemptions', ['customer_id'], {
    name: 'coupon_redemptions_customer_id_idx',
  });

  // Unique index to prevent duplicate redemptions per customer per coupon (optional, depends on business rules)
  // Uncomment if you want each customer to only use a coupon once
  // pgm.createIndex('coupon_redemptions', ['coupon_id', 'customer_id'], {
  //   unique: true,
  //   name: 'coupon_redemptions_coupon_customer_unique_idx',
  // });

  // Create trigger to update updated_at on coupons
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_coupons_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER coupons_updated_at_trigger
    BEFORE UPDATE ON coupons
    FOR EACH ROW
    EXECUTE FUNCTION update_coupons_updated_at();
  `);
};

exports.down = (pgm) => {
  // Drop trigger
  pgm.sql(`
    DROP TRIGGER IF EXISTS coupons_updated_at_trigger ON coupons;
    DROP FUNCTION IF EXISTS update_coupons_updated_at();
  `);

  // Drop tables
  pgm.dropTable('coupon_redemptions');
  pgm.dropTable('coupons');

  // Drop enum type
  pgm.dropType('discount_type');
};
