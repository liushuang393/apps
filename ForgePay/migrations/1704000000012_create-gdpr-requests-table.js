/**
 * Migration: Create GDPR requests table
 * 
 * Tracks data export and deletion requests for GDPR compliance.
 */

exports.up = (pgm) => {
  // Create enum for request types
  pgm.createType('gdpr_request_type', ['data_export', 'data_deletion', 'data_rectification']);
  pgm.createType('gdpr_request_status', ['pending', 'processing', 'completed', 'failed', 'cancelled']);

  // Create GDPR requests table
  pgm.createTable('gdpr_requests', {
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
    customer_id: {
      type: 'uuid',
      references: 'customers(id)',
      onDelete: 'SET NULL',
    },
    customer_email: {
      type: 'varchar(255)',
      notNull: true,
    },
    request_type: {
      type: 'gdpr_request_type',
      notNull: true,
    },
    status: {
      type: 'gdpr_request_status',
      notNull: true,
      default: 'pending',
    },
    requested_by: {
      type: 'varchar(255)',
      notNull: true,
    },
    reason: {
      type: 'text',
    },
    data_categories: {
      type: 'text[]',
    },
    export_file_url: {
      type: 'text',
    },
    export_file_expires_at: {
      type: 'timestamptz',
    },
    processed_at: {
      type: 'timestamptz',
    },
    completed_at: {
      type: 'timestamptz',
    },
    error_message: {
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
  pgm.createIndex('gdpr_requests', 'developer_id');
  pgm.createIndex('gdpr_requests', 'customer_id');
  pgm.createIndex('gdpr_requests', 'customer_email');
  pgm.createIndex('gdpr_requests', 'status');
  pgm.createIndex('gdpr_requests', 'request_type');
  pgm.createIndex('gdpr_requests', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('gdpr_requests');
  pgm.dropType('gdpr_request_status');
  pgm.dropType('gdpr_request_type');
};
