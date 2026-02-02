/**
 * Migration: Create used_tokens table
 * 
 * Used tokens track consumed unlock tokens to enforce single-use constraint.
 * This prevents replay attacks where the same token is used multiple times.
 * 
 * Note: This could be implemented in Redis instead of PostgreSQL for better
 * performance, but PostgreSQL provides persistence and simpler deployment.
 */

exports.up = (pgm) => {
  pgm.createTable('used_tokens', {
    jti: {
      type: 'varchar(255)',
      primaryKey: true,
    },
    used_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    expires_at: {
      type: 'timestamp',
      notNull: true,
    },
  });

  // Create index on expires_at for efficient cleanup of expired tokens
  pgm.createIndex('used_tokens', 'expires_at', {
    name: 'idx_used_tokens_expires',
  });

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE used_tokens IS 'Consumed unlock tokens for single-use enforcement';
    COMMENT ON COLUMN used_tokens.jti IS 'JWT ID (unique token identifier)';
    COMMENT ON COLUMN used_tokens.used_at IS 'Timestamp when token was used';
    COMMENT ON COLUMN used_tokens.expires_at IS 'Token expiration timestamp (for cleanup)';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('used_tokens');
};
