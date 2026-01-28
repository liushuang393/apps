/**
 * Swagger/OpenAPI Configuration
 * 
 * Interactive API documentation
 * Requirements: 15.7 - Interactive API Documentation
 */

// @ts-ignore - swagger-jsdoc will be installed via npm install
import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './index';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ForgePay Bridge API',
      version: '1.0.0',
      description: `
ForgePay Bridge is a SaaS platform that wraps Stripe to provide a turnkey payment solution for OpenAI ChatGPT Apps monetization.

## Authentication

Most endpoints require API key authentication. Include your API key in the \`X-API-Key\` header:

\`\`\`
X-API-Key: fp_live_xxxxxxxxxxxx
\`\`\`

Test mode API keys start with \`fp_test_\`, live mode keys start with \`fp_live_\`.

## Rate Limiting

- Standard API: 100 requests per 15 minutes
- Admin API: 30 requests per minute
- Webhook API: 100 requests per minute

## Error Handling

All errors follow this format:
\`\`\`json
{
  "error": {
    "code": "error_code",
    "message": "Human readable message",
    "param": "field_name",
    "type": "invalid_request_error"
  }
}
\`\`\`

## Multi-Currency Support

Supported currencies: USD, CNY, JPY, EUR
      `,
      contact: {
        name: 'ForgePay Support',
        email: 'support@forgepay.io',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: `${config.app.baseUrl}/api/v1`,
        description: 'API Server',
      },
    ],
    tags: [
      { name: 'Checkout', description: 'Checkout session management' },
      { name: 'Entitlements', description: 'Customer entitlement verification' },
      { name: 'Products', description: 'Product management (Admin)' },
      { name: 'Prices', description: 'Price management (Admin)' },
      { name: 'Customers', description: 'Customer management (Admin)' },
      { name: 'Coupons', description: 'Coupon/Discount management' },
      { name: 'Invoices', description: 'Invoice management' },
      { name: 'Legal', description: 'Legal template management' },
      { name: 'GDPR', description: 'GDPR compliance endpoints' },
      { name: 'Monitoring', description: 'Health checks and metrics' },
      { name: 'Onboarding', description: 'Developer onboarding' },
      { name: 'Portal', description: 'Customer self-service portal' },
      { name: 'Webhooks', description: 'Stripe webhook handling' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key authentication',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'invalid_request' },
                message: { type: 'string', example: 'The product_id parameter is required' },
                param: { type: 'string', example: 'product_id' },
                type: { type: 'string', example: 'invalid_request_error' },
              },
            },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 100 },
            limit: { type: 'integer', example: 20 },
            offset: { type: 'integer', example: 0 },
          },
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            stripe_product_id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['one_time', 'subscription'] },
            active: { type: 'boolean' },
            metadata: { type: 'object' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Price: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            stripe_price_id: { type: 'string' },
            product_id: { type: 'string', format: 'uuid' },
            amount: { type: 'integer', description: 'Amount in smallest currency unit' },
            currency: { type: 'string', example: 'usd' },
            interval: { type: 'string', enum: ['month', 'year'], nullable: true },
            active: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Customer: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            stripe_customer_id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            metadata: { type: 'object' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Entitlement: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            customer_id: { type: 'string', format: 'uuid' },
            product_id: { type: 'string', format: 'uuid' },
            purchase_intent_id: { type: 'string' },
            status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
            expires_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        CheckoutSession: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            stripe_session_id: { type: 'string' },
            purchase_intent_id: { type: 'string' },
            product_id: { type: 'string', format: 'uuid' },
            price_id: { type: 'string', format: 'uuid' },
            customer_id: { type: 'string', format: 'uuid', nullable: true },
            status: { type: 'string', enum: ['pending', 'completed', 'expired'] },
            success_url: { type: 'string', format: 'uri' },
            cancel_url: { type: 'string', format: 'uri' },
            expires_at: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Coupon: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            code: { type: 'string' },
            name: { type: 'string' },
            discount_type: { type: 'string', enum: ['percentage', 'fixed_amount'] },
            discount_value: { type: 'integer' },
            currency: { type: 'string', nullable: true },
            min_purchase_amount: { type: 'integer', nullable: true },
            max_redemptions: { type: 'integer', nullable: true },
            redemption_count: { type: 'integer' },
            applies_to_products: { type: 'array', items: { type: 'string', format: 'uuid' }, nullable: true },
            active: { type: 'boolean' },
            expires_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            invoice_number: { type: 'string' },
            customer_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['draft', 'issued', 'paid', 'void', 'refunded'] },
            currency: { type: 'string' },
            subtotal: { type: 'integer' },
            tax_amount: { type: 'integer' },
            total: { type: 'integer' },
            line_items: { type: 'array', items: { type: 'object' } },
            issued_at: { type: 'string', format: 'date-time', nullable: true },
            paid_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        HealthCheck: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
            timestamp: { type: 'string', format: 'date-time' },
            version: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                database: { type: 'string', enum: ['up', 'down'] },
                redis: { type: 'string', enum: ['up', 'down'] },
                stripe: { type: 'string', enum: ['up', 'down'] },
              },
            },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'API key is missing or invalid',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                error: {
                  code: 'unauthorized',
                  message: 'Invalid or missing API key',
                  type: 'authentication_error',
                },
              },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                error: {
                  code: 'resource_not_found',
                  message: 'The requested resource was not found',
                  type: 'invalid_request_error',
                },
              },
            },
          },
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                error: {
                  code: 'invalid_request',
                  message: 'The product_id parameter is required',
                  param: 'product_id',
                  type: 'invalid_request_error',
                },
              },
            },
          },
        },
        InternalError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                error: {
                  code: 'internal_error',
                  message: 'An unexpected error occurred',
                  type: 'api_error',
                },
              },
            },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  },
  apis: ['./src/routes/*.ts'], // Path to route files for JSDoc comments
};

export const swaggerSpec = swaggerJsdoc(options);

export const swaggerOptions = {
  swaggerOptions: {
    persistAuthorization: true,
  },
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info { margin-bottom: 30px }
    .swagger-ui .info .title { color: #5469d4 }
  `,
  customSiteTitle: 'ForgePay API Documentation',
  customfavIcon: '/favicon.ico',
};
