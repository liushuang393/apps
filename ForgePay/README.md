# ForgePayBridge (フォージペイ)

A SaaS platform that wraps Stripe to provide a turnkey payment solution for OpenAI ChatGPT Apps monetization.

## Features

- 🔐 **Hosted Checkout Pages** - Stripe-powered payment pages with automatic tax calculation
- 🎫 **Entitlement Management** - Automatic access control for one-time and subscription purchases
- 🔄 **Reliable Webhooks** - Idempotent webhook processing with retry logic and DLQ
- 🤖 **ChatGPT Integration** - Seamless integration with OpenAI's External Checkout flow
- 📊 **Admin Dashboard** - Web interface for product management and analytics
- 🌍 **Multi-Currency** - Support for USD, EUR, GBP, JPY, AUD, and more
- 💰 **Tax Handling** - Automatic VAT, GST, and sales tax calculation
- 🛡️ **Security** - PCI-compliant via Stripe, fraud prevention with Stripe Radar

## Prerequisites

- Node.js 18+ (LTS)
- PostgreSQL 14+
- Redis 6+
- Stripe account (test and/or live mode)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd forgepaybridge
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run database migrations:
```bash
npm run migrate:up
```

5. Start the development server:
```bash
npm run dev
```
6. e2e test
ENABLE_E2E_TESTS=true npm test

## Configuration

### Environment Variables

See `.env.example` for all available configuration options.

Key variables:
- `STRIPE_MODE` - Set to `test` or `live`
- `STRIPE_TEST_SECRET_KEY` - Your Stripe test secret key
- `STRIPE_TEST_WEBHOOK_SECRET` - Your Stripe test webhook secret
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for signing unlock tokens

### Stripe Setup

1. Create a Stripe account at https://stripe.com
2. Get your API keys from the Stripe Dashboard
3. Configure webhook endpoint: `https://yourdomain.com/api/v1/webhooks/stripe`
4. Select webhook events:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`

## Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage report
- `npm run migrate:up` - Run database migrations
- `npm run migrate:down` - Rollback database migrations
- `npm run lint` - Lint code
- `npm run format` - Format code with Prettier

### Project Structure

```
forgepaybridge/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # API controllers
│   ├── services/        # Business logic services
│   ├── repositories/    # Data access layer
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   ├── app.ts           # Express app setup
│   └── index.ts         # Application entry point
├── migrations/          # Database migrations
├── tests/               # Test files
├── logs/                # Application logs
└── dist/                # Compiled JavaScript (generated)
```

## Testing

### Unit Tests

```bash
npm test
```

### Property-Based Tests

Property-based tests use `fast-check` to verify universal properties:

```bash
npm test -- --testPathPattern=property
```

### Integration Tests

```bash
npm test -- --testPathPattern=integration
```

## API Documentation

### Checkout API

**Create Checkout Session**
```
POST /api/v1/checkout/sessions
Content-Type: application/json
Authorization: Bearer <api_key>

{
  "product_id": "prod_123",
  "price_id": "price_456",
  "purchase_intent_id": "pi_openai_789",
  "success_url": "https://chat.openai.com/success",
  "cancel_url": "https://chat.openai.com/cancel"
}
```

**Verify Entitlement**
```
GET /api/v1/entitlements/verify?unlock_token=<token>
Authorization: Bearer <api_key>
```

### Webhook Endpoint

```
POST /api/v1/webhooks/stripe
Stripe-Signature: <signature>

<Stripe event payload>
```

## Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `STRIPE_MODE=live`
- [ ] Configure live Stripe API keys
- [ ] Set strong `JWT_SECRET`
- [ ] Configure production database
- [ ] Configure production Redis
- [ ] Set up SSL/TLS certificates
- [ ] Configure CORS allowed origins
- [ ] Set up monitoring and alerts
- [ ] Configure log aggregation
- [ ] Test webhook delivery
- [ ] Complete Stripe account verification

### Docker Deployment

```bash
docker build -t forgepaybridge .
docker run -p 3000:3000 --env-file .env forgepaybridge
```

## Monitoring

### Health Check

```
GET /health
```

Returns:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "environment": "production",
  "stripeMode": "live"
}
```

### Logs

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only

Logs are structured JSON for easy parsing and aggregation.

## Security

- All card data is handled by Stripe (PCI-compliant)
- Webhook signatures are verified
- API keys are hashed before storage
- Rate limiting on all endpoints
- Customer PII is encrypted at rest
- GDPR-compliant data export and deletion

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
