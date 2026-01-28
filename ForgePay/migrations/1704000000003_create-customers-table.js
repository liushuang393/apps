/**
 * Migration: Create customers table
 * 
 * Customers are end-users who purchase access to ChatGPT Apps.
 * Each customer is associated with a developer and has a Stripe customer ID.
 */

exports.up = (pgm) => {
  pgm.createTable('customers', {
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
    stripe_customer_id: {
      type: 'varchar(255)',
      notNull: true,
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
    },
    name: {
      type: 'varchar(255)',
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

  // Create unique constraint on developer_id and stripe_customer_id
  pgm.addConstraint('customers', 'customers_developer_stripe_unique', {
    unique: ['developer_id', 'stripe_customer_id'],
  });

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE customers IS 'End-users who purchase access to ChatGPT Apps';
    COMMENT ON COLUMN customers.stripe_customer_id IS 'Stripe Customer ID';
    COMMENT ON COLUMN customers.email IS 'Customer email address';
    COMMENT ON COLUMN customers.name IS 'Customer name (optional)';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('customers');
};
