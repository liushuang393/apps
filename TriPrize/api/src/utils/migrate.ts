import { pool } from '../config/database.config';
import fs from 'fs';
import path from 'path';
import logger from './logger.util';

interface Migration {
  filename: string;
  sql: string;
}

/**
 * Run database migrations
 */
export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, '../../migrations');

  try {
    // Create migrations tracking table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Get list of executed migrations
    const { rows: executedMigrations } = await pool.query<{ filename: string }>(
      'SELECT filename FROM migrations ORDER BY id'
    );
    const executedSet = new Set(executedMigrations.map((m) => m.filename));

    // Read migration files
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const pendingMigrations: Migration[] = files
      .filter((f) => !executedSet.has(f))
      .map((f) => ({
        filename: f,
        sql: fs.readFileSync(path.join(migrationsDir, f), 'utf-8'),
      }));

    if (pendingMigrations.length === 0) {
      logger.info('No pending migrations');
      return;
    }

    logger.info(`Found ${pendingMigrations.length} pending migration(s)`);

    // Execute each migration in a transaction
    for (const migration of pendingMigrations) {
      logger.info(`Executing migration: ${migration.filename}`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Execute migration SQL
        await client.query(migration.sql);

        // Record migration
        await client.query(
          'INSERT INTO migrations (filename) VALUES ($1)',
          [migration.filename]
        );

        await client.query('COMMIT');
        logger.info(`✓ Migration completed: ${migration.filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`✗ Migration failed: ${migration.filename}`, error);
        throw error;
      } finally {
        client.release();
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration process failed', error);
    throw error;
  }
}

/**
 * Rollback last migration (use with caution)
 */
export async function rollbackLastMigration(): Promise<void> {
  try {
    const { rows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM migrations ORDER BY id DESC LIMIT 1'
    );

    if (rows.length === 0) {
      logger.info('No migrations to rollback');
      return;
    }

    const lastMigration = rows[0].filename;
    logger.warn(`Rolling back migration: ${lastMigration}`);
    logger.warn('⚠️  Manual rollback required - check migration file for down script');

    // Delete migration record
    await pool.query('DELETE FROM migrations WHERE filename = $1', [lastMigration]);

    logger.info('Migration record removed. Please manually execute rollback SQL if needed.');
  } catch (error) {
    logger.error('Rollback failed', error);
    throw error;
  }
}

// CLI execution
if (require.main === module) {
  const command = process.argv[2];

  if (command === 'up') {
    runMigrations()
      .then(() => {
        logger.info('Migration command completed');
        process.exit(0);
      })
      .catch((error) => {
        logger.error('Migration command failed', error);
        process.exit(1);
      });
  } else if (command === 'rollback') {
    rollbackLastMigration()
      .then(() => {
        logger.info('Rollback command completed');
        process.exit(0);
      })
      .catch((error) => {
        logger.error('Rollback command failed', error);
        process.exit(1);
      });
  } else {
    logger.error('Usage: ts-node migrate.ts [up|rollback]');
    process.exit(1);
  }
}

export default {
  runMigrations,
  rollbackLastMigration,
};
