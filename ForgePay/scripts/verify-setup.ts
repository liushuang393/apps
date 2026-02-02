#!/usr/bin/env ts-node

/**
 * Setup Verification Script
 * 
 * This script verifies that all infrastructure components are properly configured:
 * - Environment variables
 * - Database connection
 * - Redis connection
 * - Stripe API access
 */

import { config } from '../src/config';
import { testDatabaseConnection } from '../src/config/database';
import { connectRedis, testRedisConnection, closeRedis } from '../src/config/redis';
import { logger } from '../src/utils/logger';
import Stripe from 'stripe';

interface VerificationResult {
  component: string;
  status: 'pass' | 'fail';
  message: string;
}

const results: VerificationResult[] = [];

async function verifyEnvironment(): Promise<void> {
  console.log('\n🔍 Verifying Environment Configuration...\n');

  try {
    // Check required environment variables
    const requiredVars = [
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
    ];

    const stripeKeyVar = config.stripe.mode === 'test' 
      ? 'STRIPE_TEST_SECRET_KEY' 
      : 'STRIPE_LIVE_SECRET_KEY';
    requiredVars.push(stripeKeyVar);

    let allPresent = true;
    for (const varName of requiredVars) {
      const value = process.env[varName];
      if (!value) {
        results.push({
          component: 'Environment',
          status: 'fail',
          message: `Missing required variable: ${varName}`,
        });
        allPresent = false;
      }
    }

    if (allPresent) {
      results.push({
        component: 'Environment',
        status: 'pass',
        message: 'All required environment variables are set',
      });
    }

    // Display configuration
    console.log('Configuration:');
    console.log(`  Environment: ${config.app.env}`);
    console.log(`  Port: ${config.app.port}`);
    console.log(`  Stripe Mode: ${config.stripe.mode}`);
    console.log(`  Log Level: ${config.logging.level}`);
  } catch (error) {
    results.push({
      component: 'Environment',
      status: 'fail',
      message: `Configuration error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function verifyDatabase(): Promise<void> {
  console.log('\n🔍 Verifying Database Connection...\n');

  try {
    await testDatabaseConnection();
    results.push({
      component: 'Database',
      status: 'pass',
      message: 'PostgreSQL connection successful',
    });
  } catch (error) {
    results.push({
      component: 'Database',
      status: 'fail',
      message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function verifyRedis(): Promise<void> {
  console.log('\n🔍 Verifying Redis Connection...\n');

  try {
    await connectRedis();
    await testRedisConnection();
    results.push({
      component: 'Redis',
      status: 'pass',
      message: 'Redis connection successful',
    });
  } catch (error) {
    results.push({
      component: 'Redis',
      status: 'fail',
      message: `Redis connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function verifyStripe(): Promise<void> {
  console.log('\n🔍 Verifying Stripe API Access...\n');

  try {
    const stripe = new Stripe(config.stripe.secretKey, {
      apiVersion: '2024-09-30.acacia',
    });

    // Test API access by retrieving account info
    const account = await stripe.accounts.retrieve();
    
    results.push({
      component: 'Stripe',
      status: 'pass',
      message: `Stripe API access successful (Account: ${account.id})`,
    });

    console.log(`  Account ID: ${account.id}`);
    console.log(`  Account Type: ${account.type}`);
    console.log(`  Charges Enabled: ${account.charges_enabled}`);
  } catch (error) {
    results.push({
      component: 'Stripe',
      status: 'fail',
      message: `Stripe API access failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function printResults(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('VERIFICATION RESULTS');
  console.log('='.repeat(60) + '\n');

  let allPassed = true;

  for (const result of results) {
    const icon = result.status === 'pass' ? '✅' : '❌';
    console.log(`${icon} ${result.component}: ${result.message}`);
    if (result.status === 'fail') {
      allPassed = false;
    }
  }

  console.log('\n' + '='.repeat(60));

  if (allPassed) {
    console.log('✅ All verification checks passed!');
    console.log('🚀 ForgePayBridge is ready to run.');
  } else {
    console.log('❌ Some verification checks failed.');
    console.log('Please fix the issues above before running the application.');
  }

  console.log('='.repeat(60) + '\n');
}

async function main(): Promise<void> {
  console.log('ForgePayBridge Setup Verification');
  console.log('='.repeat(60));

  try {
    await verifyEnvironment();
    await verifyDatabase();
    await verifyRedis();
    await verifyStripe();
  } catch (error) {
    logger.error('Verification failed', { error });
  } finally {
    await printResults();
    
    // Cleanup
    try {
      await closeRedis();
    } catch (error) {
      // Ignore cleanup errors
    }

    // Exit with appropriate code
    const allPassed = results.every((r) => r.status === 'pass');
    process.exit(allPassed ? 0 : 1);
  }
}

main();
