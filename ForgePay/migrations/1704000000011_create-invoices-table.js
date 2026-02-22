/**
 * Migration: Create invoices table
 * 
 * Stores invoice records generated from successful payments.
 */

exports.up = (pgm) => {
  // Create enum for invoice status
  pgm.createType('invoice_status', ['draft', 'issued', 'paid', 'void', 'refunded']);

  // Create invoices table
  pgm.createTable('invoices', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    invoice_number: {
      type: 'varchar(50)',
      notNull: true,
      unique: true,
    },
    developer_id: {
      type: 'uuid',
      notNull: true,
      references: 'developers(id)',
      onDelete: 'CASCADE',
    },
    customer_id: {
      type: 'uuid',
      notNull: true,
      references: 'customers(id)',
      onDelete: 'CASCADE',
    },
    stripe_invoice_id: {
      type: 'varchar(255)',
      unique: true,
    },
    stripe_payment_intent_id: {
      type: 'varchar(255)',
    },
    status: {
      type: 'invoice_status',
      notNull: true,
      default: 'draft',
    },
    currency: {
      type: 'varchar(3)',
      notNull: true,
      default: 'usd',
    },
    subtotal: {
      type: 'integer',
      notNull: true,
    },
    tax_amount: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    total: {
      type: 'integer',
      notNull: true,
    },
    line_items: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    billing_address: {
      type: 'jsonb',
    },
    tax_details: {
      type: 'jsonb',
    },
    pdf_url: {
      type: 'text',
    },
    pdf_generated_at: {
      type: 'timestamptz',
    },
    issued_at: {
      type: 'timestamptz',
    },
    paid_at: {
      type: 'timestamptz',
    },
    due_date: {
      type: 'timestamptz',
    },
    notes: {
      type: 'text',
    },
    metadata: {
      type: 'jsonb',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Create indexes
  pgm.createIndex('invoices', 'developer_id');
  pgm.createIndex('invoices', 'customer_id');
  pgm.createIndex('invoices', 'status');
  pgm.createIndex('invoices', 'stripe_invoice_id');
  pgm.createIndex('invoices', 'issued_at');

  // Create sequence for invoice numbers
  pgm.sql(`
    CREATE SEQUENCE invoice_number_seq START 1000;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP SEQUENCE IF EXISTS invoice_number_seq`);
  pgm.dropTable('invoices');
  pgm.dropType('invoice_status');
};
