/**
 * Migration: Create checkout_sessions table
 * 
 * Checkout sessions track Stripe Checkout Session instances and map them
 * to OpenAI's purchase_intent_id for ChatGPT App integration.
 */

exports.up = (pgm) => {
  pgm.createTable('checkout_sessions', {
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
    stripe_session_id: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    purchase_intent_id: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    product_id: {
      type: 'uuid',
      notNull: true,
      references: 'products(id)',
      onDelete: 'RESTRICT',
    },
    price_id: {
      type: 'uuid',
      notNull: true,
      references: 'prices(id)',
      onDelete: 'RESTRICT',
    },
    customer_id: {
      type: 'uuid',
      references: 'customers(id)',
      onDelete: 'SET NULL',
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
    },
    success_url: {
      type: 'text',
      notNull: true,
    },
    cancel_url: {
      type: 'text',
      notNull: true,
    },
    expires_at: {
      type: 'timestamp',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE checkout_sessions IS 'Stripe Checkout Session instances mapped to OpenAI purchase_intent_id';
    COMMENT ON COLUMN checkout_sessions.stripe_session_id IS 'Stripe Checkout Session ID';
    COMMENT ON COLUMN checkout_sessions.purchase_intent_id IS 'OpenAI purchase intent ID for ChatGPT App integration';
    COMMENT ON COLUMN checkout_sessions.status IS 'Session status (open, complete, expired)';
    COMMENT ON COLUMN checkout_sessions.expires_at IS 'Session expiration timestamp (24 hours from creation)';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('checkout_sessions');
};
