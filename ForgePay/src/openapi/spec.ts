import swaggerJsdoc from 'swagger-jsdoc';
import { config } from '../config';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'ForgePay API',
      version: '1.0.0',
      description: `
## ForgePay — OpenAI External Checkout Flow 決済連携レイヤー

ForgePay は ChatGPT App（OpenAI Apps SDK）向けの薄い決済連携レイヤーです。
Stripe の強力な決済機能を最小限の設定でアプリに組み込めます。

### クイックスタート

1. **開発者登録**: \`POST /api/v1/onboarding/register\`
2. **Stripe キー登録**: \`POST /api/v1/onboarding/stripe/keys\`
3. **決済リンク生成（簡易）**: \`POST /api/v1/quickpay\` ← 商品登録不要
4. **権限確認**: \`GET /api/v1/entitlements/verify\`

詳細なドキュメントは [/docs/api](/docs/api) を参照してください。
      `,
      contact: {
        name: 'ForgePay Support',
        url: 'https://github.com/forgepay',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: config.app.baseUrl,
        description: '現在のサーバー',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: '開発者登録後に取得した API キー',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                type: { type: 'string' },
              },
            },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    tags: [
      { name: 'QuickPay', description: '商品登録不要の簡易決済' },
      { name: 'Checkout', description: 'チェックアウトセッション管理' },
      { name: 'Entitlements', description: 'Entitlement（購入権）ライフサイクル管理' },
      { name: 'Webhooks', description: 'Stripe Webhook 受信' },
      { name: 'Admin', description: '商品・価格・顧客管理' },
      { name: 'Onboarding', description: '開発者登録・API キー管理' },
    ],
  },
  // JSDoc コメントからルート定義を収集
  apis: ['./src/routes/**/*.ts', './src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
