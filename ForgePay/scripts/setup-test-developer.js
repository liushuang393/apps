/**
 * Setup Test Developer for E2E Tests
 * 
 * This script creates a test developer via the public API (not direct DB insertion)
 * to ensure the E2E tests are realistic.
 * 
 * Prerequisites:
 * - Backend server running on http://localhost:3000
 * - PostgreSQL and Redis running
 * 
 * Usage: node scripts/setup-test-developer.js
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'e2e-test@forgepay.io';

async function setupTestDeveloper() {
  console.log('🚀 Setting up test developer via API...\n');

  try {
    // Step 1: Register a new developer via the public API
    console.log('📝 Registering test developer...');
    
    const registerResponse = await fetch(`${API_BASE_URL}/api/v1/onboarding/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: TEST_EMAIL,
        testMode: true,
      }),
    });

    if (registerResponse.status === 409) {
      console.log('⚠️  Developer already exists. Attempting to retrieve or regenerate...');
      
      // Try to delete and re-register (for clean state)
      console.log('   This is expected if you ran this script before.');
      console.log('   Use the existing API key from your .env file, or:');
      console.log('   1. Manually delete the developer from the database');
      console.log('   2. Run this script again\n');
      
      console.log('📋 To delete existing test developer:');
      console.log(`   docker exec forgepaybridge-postgres psql -U postgres -d forgepaybridge -c "DELETE FROM developers WHERE email = '${TEST_EMAIL}';"`);
      console.log('');
      
      return null;
    }

    if (!registerResponse.ok) {
      const error = await registerResponse.json();
      throw new Error(`Registration failed: ${JSON.stringify(error)}`);
    }

    const registerData = await registerResponse.json();
    console.log('✅ Developer registered successfully!\n');

    // Step 2: Display the API key (use .key not .full)
    const apiKey = registerData.apiKey.key;
    
    console.log('='.repeat(60));
    console.log('🔑 TEST API KEY (Save this - it will not be shown again!)');
    console.log('='.repeat(60));
    console.log(`\n   ${apiKey}\n`);
    console.log('='.repeat(60));

    // Step 3: Provide instructions
    console.log('\n📋 Next Steps:\n');
    console.log('1. Add this API key to your .env file:');
    console.log(`   TEST_API_KEY=${apiKey}\n`);
    
    console.log('2. Update dashboard .env (if separate):');
    console.log(`   VITE_TEST_API_KEY=${apiKey}\n`);

    console.log('3. Run E2E tests:');
    console.log('   npm run test:e2e\n');

    // Step 4: Verify the API key works by making a test request
    console.log('🔍 Verifying API key...');
    
    const verifyResponse = await fetch(`${API_BASE_URL}/api/v1/onboarding/me`, {
      headers: {
        'X-API-Key': apiKey,
      },
    });

    if (verifyResponse.ok) {
      const meData = await verifyResponse.json();
      // Handle nested developer object
      const dev = meData.developer || meData;
      console.log('✅ API key verified successfully!');
      console.log(`   Developer ID: ${dev.id}`);
      console.log(`   Email: ${dev.email}`);
      console.log(`   Test Mode: ${dev.testMode ?? dev.test_mode}`);
    } else {
      console.log('❌ API key verification failed!');
      const errorData = await verifyResponse.json().catch(() => ({}));
      console.log(`   Error: ${errorData.error?.message || verifyResponse.status}`);
    }

    return apiKey;

  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Error: Cannot connect to the server.');
      console.error('   Make sure the backend is running: npm run dev');
      console.error(`   Server URL: ${API_BASE_URL}`);
    } else {
      console.error('❌ Error:', error.message);
    }
    process.exit(1);
  }
}

// Run the setup
setupTestDeveloper().then(apiKey => {
  if (apiKey) {
    console.log('\n✨ Setup complete!\n');
  }
});
