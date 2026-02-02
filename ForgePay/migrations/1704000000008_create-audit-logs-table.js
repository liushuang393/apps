/**
 * Migration: Create audit_logs table with indexes
 * 
 * Audit logs record all system actions for compliance, debugging, and security.
 * This includes API requests, admin actions, entitlement changes, and more.
 */

exports.up = (pgm) => {
  pgm.createTable('audit_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    developer_id: {
      type: 'uuid',
      references: 'developers(id)',
      onDelete: 'SET NULL',
    },
    user_id: {
      type: 'uuid',
    },
    action: {
      type: 'varchar(100)',
      notNull: true,
    },
    resource_type: {
      type: 'varchar(50)',
      notNull: true,
    },
    resource_id: {
      type: 'varchar(255)',
      notNull: true,
    },
    changes: {
      type: 'jsonb',
    },
    ip_address: {
      type: 'inet',
    },
    user_agent: {
      type: 'text',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Create indexes for efficient querying
  pgm.createIndex('audit_logs', 'developer_id', {
    name: 'idx_audit_logs_developer',
  });

  pgm.createIndex('audit_logs', 'created_at', {
    name: 'idx_audit_logs_created',
  });

  pgm.createIndex('audit_logs', ['resource_type', 'resource_id'], {
    name: 'idx_audit_logs_resource',
  });

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE audit_logs IS 'System action logs for compliance and debugging';
    COMMENT ON COLUMN audit_logs.developer_id IS 'Developer who performed the action (if applicable)';
    COMMENT ON COLUMN audit_logs.user_id IS 'User who performed the action (if applicable)';
    COMMENT ON COLUMN audit_logs.action IS 'Action performed (e.g., product.created, refund.processed)';
    COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource affected (e.g., product, entitlement)';
    COMMENT ON COLUMN audit_logs.resource_id IS 'ID of the affected resource';
    COMMENT ON COLUMN audit_logs.changes IS 'JSON object containing before/after values';
    COMMENT ON COLUMN audit_logs.ip_address IS 'IP address of the requester';
    COMMENT ON COLUMN audit_logs.user_agent IS 'User agent string of the requester';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('audit_logs');
};
