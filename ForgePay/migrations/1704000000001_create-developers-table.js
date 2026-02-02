/**
 * Migration: Create developers table
 * 
 * This table stores platform users (ChatGPT App developers) who use ForgePayBridge
 * to monetize their applications.
 */

exports.up = (pgm) => {
  pgm.createTable('developers', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    stripe_account_id: {
      type: 'varchar(255)',
      unique: true,
    },
    api_key_hash: {
      type: 'varchar(255)',
      notNull: true,
    },
    webhook_secret: {
      type: 'varchar(255)',
    },
    test_mode: {
      type: 'boolean',
      default: true,
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

  // Add comment to table
  pgm.sql(`
    COMMENT ON TABLE developers IS 'Platform users (ChatGPT App developers) who use ForgePayBridge';
    COMMENT ON COLUMN developers.email IS 'Developer email address (unique)';
    COMMENT ON COLUMN developers.stripe_account_id IS 'Connected Stripe account ID';
    COMMENT ON COLUMN developers.api_key_hash IS 'Hashed API key for authentication';
    COMMENT ON COLUMN developers.webhook_secret IS 'Stripe webhook signing secret';
    COMMENT ON COLUMN developers.test_mode IS 'Whether developer is in test mode';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('developers');
};
