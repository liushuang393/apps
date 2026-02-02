/**
 * Migration: Create products and prices tables
 * 
 * Products represent items being sold (e.g., "Pro Plan")
 * Prices represent the cost and billing interval (e.g., "$20/month")
 * One product can have multiple prices (different currencies, intervals)
 */

exports.up = (pgm) => {
  // Create products table
  pgm.createTable('products', {
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
    stripe_product_id: {
      type: 'varchar(255)',
      notNull: true,
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    description: {
      type: 'text',
    },
    type: {
      type: 'varchar(50)',
      notNull: true,
      check: "type IN ('one_time', 'subscription')",
    },
    active: {
      type: 'boolean',
      default: true,
    },
    metadata: {
      type: 'jsonb',
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

  // Create prices table
  pgm.createTable('prices', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    product_id: {
      type: 'uuid',
      notNull: true,
      references: 'products(id)',
      onDelete: 'CASCADE',
    },
    stripe_price_id: {
      type: 'varchar(255)',
      notNull: true,
    },
    amount: {
      type: 'integer',
      notNull: true,
    },
    currency: {
      type: 'varchar(3)',
      notNull: true,
    },
    interval: {
      type: 'varchar(20)',
      check: "interval IN ('month', 'year') OR interval IS NULL",
    },
    active: {
      type: 'boolean',
      default: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE products IS 'Products available for purchase (e.g., Pro Plan)';
    COMMENT ON COLUMN products.stripe_product_id IS 'Stripe Product ID';
    COMMENT ON COLUMN products.type IS 'Product type: one_time or subscription';
    COMMENT ON COLUMN products.active IS 'Whether product is available for purchase';
    
    COMMENT ON TABLE prices IS 'Prices for products with different currencies and intervals';
    COMMENT ON COLUMN prices.amount IS 'Price amount in cents (e.g., 2000 = $20.00)';
    COMMENT ON COLUMN prices.currency IS 'ISO 4217 currency code (e.g., usd, eur, gbp)';
    COMMENT ON COLUMN prices.interval IS 'Billing interval for subscriptions (month or year)';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('prices');
  pgm.dropTable('products');
};
