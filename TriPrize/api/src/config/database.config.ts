import { Pool, PoolConfig } from 'pg';
import * as dotenv from 'dotenv';
import logger from '../utils/logger.util';

dotenv.config();

const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DATABASE_POOL_MIN || '10', 10),
  max: parseInt(process.env.DATABASE_POOL_MAX || '50', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000, // 10 seconds
  query_timeout: 10000,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

export const pool = new Pool(poolConfig);

// Error handler
pool.on('error', (err: Error) => {
  logger.error('Unexpected error on idle client', { error: err.message, stack: err.stack });
  process.exit(-1);
});

// Connection test
export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    logger.info('✓ Database connection established');
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('✗ Database connection failed', { error: errorMessage });
    return false;
  }
}

// Graceful shutdown
let poolClosed = false;

export async function closePool(): Promise<void> {
  if (poolClosed) {
    logger.warn('Pool already closed, skipping');
    return;
  }
  await pool.end();
  poolClosed = true;
  logger.info('Database pool closed');
}

export default pool;
