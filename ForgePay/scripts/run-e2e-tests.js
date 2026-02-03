#!/usr/bin/env node
/**
 * E2E Test Runner Script
 * 
 * This script sets up the environment and runs E2E tests.
 * It reads the TEST_API_KEY from .env file and runs Jest with proper configuration.
 * 
 * Usage: node scripts/run-e2e-tests.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read .env file
const envPath = path.join(__dirname, '..', '.env');
let testApiKey = process.env.TEST_API_KEY;

if (!testApiKey && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/^TEST_API_KEY=(.+)$/m);
  if (match) {
    testApiKey = match[1].trim();
  }
}

if (!testApiKey) {
  console.error('❌ TEST_API_KEY is not set!');
  console.error('');
  console.error('Please run:');
  console.error('  1. node scripts/setup-test-developer.js');
  console.error('  2. Add the API key to .env: TEST_API_KEY=fpb_test_xxx...');
  console.error('');
  process.exit(1);
}

console.log('🧪 Running E2E Tests...');
console.log(`   API Key: ${testApiKey.substring(0, 15)}...`);
console.log('');

// Set environment variables
process.env.ENABLE_E2E_TESTS = 'true';
process.env.TEST_API_KEY = testApiKey;

// Run Jest
try {
  execSync('npx jest --testPathPattern=payment-flow.e2e --testTimeout=60000 --forceExit', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  console.log('');
  console.log('✅ E2E Tests completed successfully!');
} catch (error) {
  console.log('');
  console.log(`❌ E2E Tests failed`);
  process.exit(1);
}
