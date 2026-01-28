/**
 * Migration: Create metrics table
 * 
 * Stores application metrics for monitoring and observability.
 */

exports.up = (pgm) => {
  // Create metrics table for time-series data
  pgm.createTable('metrics', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    developer_id: {
      type: 'uuid',
      references: 'developers(id)',
      onDelete: 'CASCADE',
    },
    metric_name: {
      type: 'varchar(100)',
      notNull: true,
    },
    metric_value: {
      type: 'double precision',
      notNull: true,
    },
    metric_type: {
      type: 'varchar(20)',
      notNull: true,
      default: 'counter',
    },
    labels: {
      type: 'jsonb',
      default: '{}',
    },
    recorded_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Create indexes for efficient querying
  pgm.createIndex('metrics', 'metric_name');
  pgm.createIndex('metrics', 'developer_id');
  pgm.createIndex('metrics', 'recorded_at');
  pgm.createIndex('metrics', ['metric_name', 'recorded_at']);
  pgm.createIndex('metrics', ['developer_id', 'metric_name', 'recorded_at']);

  // Create alerts table
  pgm.createTable('alerts', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    developer_id: {
      type: 'uuid',
      references: 'developers(id)',
      onDelete: 'CASCADE',
    },
    alert_name: {
      type: 'varchar(100)',
      notNull: true,
    },
    severity: {
      type: 'varchar(20)',
      notNull: true,
      default: 'warning',
    },
    message: {
      type: 'text',
      notNull: true,
    },
    metric_name: {
      type: 'varchar(100)',
    },
    threshold_value: {
      type: 'double precision',
    },
    actual_value: {
      type: 'double precision',
    },
    is_resolved: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    resolved_at: {
      type: 'timestamptz',
    },
    acknowledged_at: {
      type: 'timestamptz',
    },
    acknowledged_by: {
      type: 'varchar(255)',
    },
    metadata: {
      type: 'jsonb',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Create indexes for alerts
  pgm.createIndex('alerts', 'developer_id');
  pgm.createIndex('alerts', 'severity');
  pgm.createIndex('alerts', 'is_resolved');
  pgm.createIndex('alerts', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('alerts');
  pgm.dropTable('metrics');
};
