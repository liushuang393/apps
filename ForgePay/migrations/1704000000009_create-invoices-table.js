/**
 * Migration: Create invoices table
 * 
 * Invoices store payment records with itemized tax breakdown for compliance.
 * Required for tax reporting and customer records (7-year retention).
 */

exports.up = (pgm) => {
  pgm.createTable('invoices', {
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
    stripe_invoice_id: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    amount_subtotal: {
      type: 'integer',
      notNull: true,
    },
    amount_tax: {
      type: 'integer',
      notNull: true,
    },
    amount_total: {
      type: 'integer',
      notNull: true,
    },
    currency: {
      type: 'varchar(3)',
      notNull: true,
    },
    tax_type: {
      type: 'varchar(50)',
    },
    pdf_url: {
      type: 'text',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE invoices IS 'Payment invoices with itemized tax breakdown';
    COMMENT ON COLUMN invoices.stripe_invoice_id IS 'Stripe Invoice ID';
    COMMENT ON COLUMN invoices.amount_subtotal IS 'Subtotal amount in cents (before tax)';
    COMMENT ON COLUMN invoices.amount_tax IS 'Tax amount in cents';
    COMMENT ON COLUMN invoices.amount_total IS 'Total amount in cents (subtotal + tax)';
    COMMENT ON COLUMN invoices.currency IS 'ISO 4217 currency code';
    COMMENT ON COLUMN invoices.tax_type IS 'Type of tax applied (VAT, GST, SALES_TAX, etc.)';
    COMMENT ON COLUMN invoices.pdf_url IS 'URL to downloadable PDF invoice';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('invoices');
};
