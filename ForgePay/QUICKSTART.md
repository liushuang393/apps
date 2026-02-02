# ForgePayBridge Quick Start Guide

This guide will help you get ForgePayBridge up and running in minutes.

## Prerequisites

Before you begin, ensure you have:

- ✅ Node.js 18+ installed
- ✅ PostgreSQL 14+ installed and running
- ✅ Redis 6+ installed and running
- ✅ A Stripe account (test mode is fine for development)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Configure Environment

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and set the following required variables:

```bash
# Database (update with your PostgreSQL credentials)
DATABASE_URL=postgresql://user:password@localhost:5432/forgepaybridge

# Redis (update if needed)
REDIS_URL=redis://localhost:6379

# Stripe (get from https://dashboard.stripe.com/test/apikeys)
STRIPE_MODE=test
STRIPE_TEST_SECRET_KEY=sk_test_your_key_here
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_your_key_here
STRIPE_TEST_WEBHOOK_SECRET=whsec_your_secret_here

# JWT Secret (generate a random string)
JWT_SECRET=your-random-secret-key-here
```

### Getting Stripe Keys

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your "Secret key" (starts with `sk_test_`)
3. Copy your "Publishable key" (starts with `pk_test_`)
4. For webhook secret, see Step 4 below

## Step 3: Set Up Database

Run the database migrations:

```bash
npm run migrate:up
```

This will create all necessary tables in your PostgreSQL database.

## Step 4: Configure Stripe Webhooks (Optional for Development)

For local development, you can use the Stripe CLI to forward webhooks:

1. Install Stripe CLI: https://stripe.com/docs/stripe-cli
2. Login to Stripe:
```bash
stripe login
```

3. Forward webhooks to your local server:
```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

4. Copy the webhook signing secret (starts with `whsec_`) and add it to your `.env`:
```bash
STRIPE_TEST_WEBHOOK_SECRET=whsec_...
```

## Step 5: Verify Setup

Run the verification script to ensure everything is configured correctly:

```bash
npm run verify
```

You should see:
```
✅ Environment: All required environment variables are set
✅ Database: PostgreSQL connection successful
✅ Redis: Redis connection successful
✅ Stripe: Stripe API access successful
```

## Step 6: Start the Server

Start the development server:

```bash
npm run dev
```

You should see:
```
ForgePayBridge server started on port 3000
Environment: development
Stripe Mode: test
```

## Step 7: Test the API

Test the health endpoint:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "environment": "development",
  "stripeMode": "test"
}
```

## Alternative: Using Docker

If you prefer to use Docker for PostgreSQL and Redis:

1. Start the services:
```bash
npm run docker:up
```

2. Update your `.env` to use Docker services:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forgepaybridge
REDIS_URL=redis://localhost:6379
```

3. Run migrations:
```bash
npm run migrate:up
```

4. Start the application:
```bash
npm run dev
```

To stop Docker services:
```bash
npm run docker:down
```

## Next Steps

Now that ForgePayBridge is running, you can:

1. **Create Products**: Use the Admin API to create products and prices
2. **Test Checkout**: Create a checkout session and complete a test payment
3. **Verify Entitlements**: Test the entitlement verification API
4. **Process Webhooks**: Trigger test webhooks using Stripe CLI

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Generate coverage report:

```bash
npm run test:coverage
```

## Troubleshooting

### Database Connection Failed

- Ensure PostgreSQL is running: `pg_isready`
- Check your DATABASE_URL in `.env`
- Verify database exists: `psql -l`

### Redis Connection Failed

- Ensure Redis is running: `redis-cli ping`
- Check your REDIS_URL in `.env`

### Stripe API Access Failed

- Verify your Stripe API key is correct
- Ensure you're using the test key (starts with `sk_test_`)
- Check your internet connection

### Port Already in Use

If port 3000 is already in use, change it in `.env`:
```bash
PORT=3001
```

## Getting Help

- Check the main [README.md](README.md) for detailed documentation
- Review the [design document](.kiro/specs/forgepaybridge/design.md)
- Open an issue on GitHub

## What's Next?

Continue with the implementation tasks:
- Task 2: Implement database schema and migrations
- Task 3: Implement data repositories
- Task 4: Implement Stripe client wrapper

Happy coding! 🚀
