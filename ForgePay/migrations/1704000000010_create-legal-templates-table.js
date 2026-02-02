/**
 * Migration: Create legal_templates table
 * 
 * Stores legal document templates (ToS, Privacy Policy, Refund Policy)
 * with versioning support for compliance tracking.
 */

exports.up = (pgm) => {
  // Create enum for template types
  pgm.createType('legal_template_type', ['terms_of_service', 'privacy_policy', 'refund_policy']);

  // Create legal_templates table
  pgm.createTable('legal_templates', {
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
    type: {
      type: 'legal_template_type',
      notNull: true,
    },
    version: {
      type: 'integer',
      notNull: true,
      default: 1,
    },
    title: {
      type: 'varchar(255)',
      notNull: true,
    },
    content: {
      type: 'text',
      notNull: true,
    },
    content_html: {
      type: 'text',
      notNull: false,
    },
    language: {
      type: 'varchar(10)',
      notNull: true,
      default: 'en',
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    is_default: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    effective_date: {
      type: 'timestamptz',
      notNull: false,
    },
    metadata: {
      type: 'jsonb',
      notNull: false,
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
  pgm.createIndex('legal_templates', ['developer_id', 'type']);
  pgm.createIndex('legal_templates', ['developer_id', 'type', 'version']);
  pgm.createIndex('legal_templates', ['developer_id', 'is_active']);
  pgm.createIndex('legal_templates', 'language');

  // Create unique constraint for active template per type per developer
  pgm.createIndex('legal_templates', ['developer_id', 'type'], {
    unique: true,
    where: 'is_active = true',
    name: 'legal_templates_unique_active_per_type',
  });

  // Create customer_legal_acceptances table to track which version customers accepted
  pgm.createTable('customer_legal_acceptances', {
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
    template_id: {
      type: 'uuid',
      notNull: true,
      references: 'legal_templates(id)',
      onDelete: 'RESTRICT',
    },
    template_type: {
      type: 'legal_template_type',
      notNull: true,
    },
    template_version: {
      type: 'integer',
      notNull: true,
    },
    accepted_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    ip_address: {
      type: 'inet',
      notNull: false,
    },
    user_agent: {
      type: 'text',
      notNull: false,
    },
  });

  // Create indexes for acceptances
  pgm.createIndex('customer_legal_acceptances', 'customer_id');
  pgm.createIndex('customer_legal_acceptances', 'template_id');
  pgm.createIndex('customer_legal_acceptances', ['customer_id', 'template_type']);
};

exports.down = (pgm) => {
  pgm.dropTable('customer_legal_acceptances');
  pgm.dropTable('legal_templates');
  pgm.dropType('legal_template_type');
};
