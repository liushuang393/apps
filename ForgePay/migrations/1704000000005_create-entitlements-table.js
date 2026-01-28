/**
 * Migration: Create entitlements table with indexes
 * 
 * Entitlements represent granted access rights to products or services.
 * They track the lifecycle of customer access (active, suspended, expired, revoked).
 */

exports.up = (pgm) => {
  pgm.createTable('entitlements', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    customer_id: {
      type: 'uuid',
      notNull: true,
      references: 'customers(id)',
      onDelete: 'CASCADE',
    },
    product_id: {
      type: 'uuid',
      notNull: true,
      references: 'products(id)',
      onDelete: 'RESTRICT',
    },
    purchase_intent_id: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    payment_id: {
      type: 'varchar(255)',
      notNull: true,
    },
    subscription_id: {
      type: 'varchar(255)',
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      check: "status IN ('active', 'suspended', 'expired', 'revoked')",
    },
    expires_at: {
      type: 'timestamp',
    },
    revoked_reason: {
      type: 'varchar(255)',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Create indexes for efficient querying
  pgm.createIndex('entitlements', 'customer_id', {
    name: 'idx_entitlements_customer',
  });

  pgm.createIndex('entitlements', 'status', {
    name: 'idx_entitlements_status',
  });

  pgm.createIndex('entitlements', 'purchase_intent_id', {
    name: 'idx_entitlements_purchase_intent',
  });

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE entitlements IS 'Granted access rights to products or services';
    COMMENT ON COLUMN entitlements.purchase_intent_id IS 'OpenAI purchase intent ID (unique)';
    COMMENT ON COLUMN entitlements.payment_id IS 'Stripe Payment Intent ID';
    COMMENT ON COLUMN entitlements.subscription_id IS 'Stripe Subscription ID (for recurring payments)';
    COMMENT ON COLUMN entitlements.status IS 'Entitlement status: active, suspended, expired, or revoked';
    COMMENT ON COLUMN entitlements.expires_at IS 'Expiration timestamp (null for lifetime access)';
    COMMENT ON COLUMN entitlements.revoked_reason IS 'Reason for revocation (refund, chargeback, etc.)';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('entitlements');
};
