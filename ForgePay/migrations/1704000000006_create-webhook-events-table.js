/**
 * Migration: Create webhook_events table with indexes
 * 
 * Webhook events track all incoming Stripe webhook notifications for
 * debugging, idempotency, and retry logic.
 */

exports.up = (pgm) => {
  pgm.createTable('webhook_events', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    stripe_event_id: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    event_type: {
      type: 'varchar(100)',
      notNull: true,
    },
    payload: {
      type: 'jsonb',
      notNull: true,
    },
    signature: {
      type: 'varchar(500)',
      notNull: true,
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      check: "status IN ('pending', 'processed', 'failed', 'dlq')",
    },
    attempts: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    last_attempt_at: {
      type: 'timestamp',
    },
    error_message: {
      type: 'text',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Create indexes for efficient querying
  pgm.createIndex('webhook_events', 'status', {
    name: 'idx_webhook_events_status',
  });

  pgm.createIndex('webhook_events', 'event_type', {
    name: 'idx_webhook_events_type',
  });

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE webhook_events IS 'Stripe webhook events for debugging and retry logic';
    COMMENT ON COLUMN webhook_events.stripe_event_id IS 'Stripe Event ID (unique for idempotency)';
    COMMENT ON COLUMN webhook_events.event_type IS 'Stripe event type (e.g., checkout.session.completed)';
    COMMENT ON COLUMN webhook_events.payload IS 'Full webhook event payload';
    COMMENT ON COLUMN webhook_events.signature IS 'Stripe webhook signature for verification';
    COMMENT ON COLUMN webhook_events.status IS 'Processing status: pending, processed, failed, or dlq (dead letter queue)';
    COMMENT ON COLUMN webhook_events.attempts IS 'Number of processing attempts';
    COMMENT ON COLUMN webhook_events.error_message IS 'Error message from last failed attempt';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('webhook_events');
};
