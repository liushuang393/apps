/**
 * Swagger / OpenAPI 設定
 *
 * 目的  : 開発環境専用のインタラクティブ API ドキュメントを提供する
 * 出力  : swaggerSpec (OpenAPI 3.0.0 仕様オブジェクト)、swaggerOptions (UI カスタマイズ)
 * 注意  : 本番環境では app.ts 側の NODE_ENV ガードにより /docs は無効化される
 */
import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './index';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ForgePay API',
      version: '2.0.0',
      description: `
ForgePay は OpenAI ChatGPT Apps 向け Stripe 決済連携 SaaS プラットフォームです。

## 認証

ほとんどのエンドポイントは API キー認証が必要です。\`X-API-Key\` ヘッダーに API キーを含めてください：

\`\`\`
X-API-Key: fpb_test_xxxxxxxxxxxx
\`\`\`

テストモードキーは \`fpb_test_\` で始まり、本番キーは \`fpb_live_\` で始まります。

## レート制限

- 標準 API: 15 分間に 100 リクエスト
- 管理 API: 1 分間に 30 リクエスト
- Webhook API: 1 分間に 100 リクエスト

## エラーフォーマット

\`\`\`json
{
  "error": {
    "code": "error_code",
    "message": "エラーの説明",
    "param": "field_name",
    "type": "invalid_request_error"
  }
}
\`\`\`
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
        description: 'API サーバー',
      },
    ],
    tags: [
      { name: 'Checkout', description: 'Checkout セッション管理' },
      { name: 'Entitlements', description: '購入権限の照会・検証' },
      { name: 'Products', description: '商品管理（管理者）' },
      { name: 'Prices', description: '価格管理（管理者）' },
      { name: 'Customers', description: '顧客管理（管理者）' },
      { name: 'Onboarding', description: '開発者オンボーディング' },
      { name: 'Monitoring', description: 'ヘルスチェック・メトリクス' },
      { name: 'Webhooks', description: 'Stripe Webhook 受信' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API キー認証',
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
                message: { type: 'string', example: 'product_id パラメーターは必須です' },
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
            slug: { type: 'string' },
            payment_methods: { type: 'array', items: { type: 'string' } },
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
            amount: { type: 'integer', description: '最小通貨単位での金額' },
            currency: { type: 'string', example: 'jpy' },
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
        HealthCheck: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'] },
            timestamp: { type: 'string', format: 'date-time' },
            environment: { type: 'string' },
            version: { type: 'string' },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'API キーが不正または未提供',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: { code: 'unauthorized', message: '無効または欠損 API キー', type: 'authentication_error' } },
            },
          },
        },
        NotFoundError: {
          description: 'リソースが見つかりません',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: { code: 'resource_not_found', message: 'リソースが見つかりません', type: 'invalid_request_error' } },
            },
          },
        },
        ValidationError: {
          description: 'バリデーションエラー',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: { code: 'invalid_request', message: 'product_id は必須です', param: 'product_id', type: 'invalid_request_error' } },
            },
          },
        },
        InternalError: {
          description: '内部サーバーエラー',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: { code: 'internal_error', message: '予期しないエラーが発生しました', type: 'api_error' } },
            },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  },
  apis: ['./src/routes/*.ts'],
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
  customSiteTitle: 'ForgePay API ドキュメント',
};

