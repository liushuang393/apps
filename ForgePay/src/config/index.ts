import dotenv from 'dotenv';

dotenv.config();

/**
 * 決済方式の選択
 * - checkout        : 方案1 — Stripe Checkout（Stripe ホスト画面）
 * - elements        : 方案2 — Stripe Elements（自前 UI + Stripe カードコンポーネント）
 * - payment-intent  : 方案3 — PaymentIntent API（完全制御 + サブスクリプション管理）
 */
export type PaymentMode = 'checkout' | 'elements' | 'payment-intent';

export interface AppConfig {
  app: {
    env: string;
    port: number;
    baseUrl: string;
    /** 有効な決済方式（PAYMENT_MODE 環境変数で切り替え） */
    paymentMode: PaymentMode;
  };
  encryption: {
    /** AES-256-GCM 暗号化キー（32バイトの hex または平文）*/
    key: string;
  };
  stripe: {
    mode: 'test' | 'live';
    secretKey: string;
    publishableKey: string;
    webhookSecret: string;
  };
  database: {
    url: string;
    poolMin: number;
    poolMax: number;
  };
  redis: {
    url: string;
    password?: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  logging: {
    level: string;
    format: 'json' | 'simple';
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  email: {
    from: string;
    smtpHost?: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser?: string;
    smtpPass?: string;
  };
}

function getStripeKeys(): { secretKey: string; publishableKey: string; webhookSecret: string } {
  const mode = (process.env.STRIPE_MODE || 'test') as 'test' | 'live';
  if (mode === 'live') {
    return {
      secretKey: process.env.STRIPE_LIVE_SECRET_KEY || '',
      publishableKey: process.env.STRIPE_LIVE_PUBLISHABLE_KEY || '',
      webhookSecret: process.env.STRIPE_LIVE_WEBHOOK_SECRET || '',
    };
  }
  return {
    secretKey: process.env.STRIPE_TEST_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_TEST_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_TEST_WEBHOOK_SECRET || '',
  };
}

const stripeKeys = getStripeKeys();

export const config: AppConfig = {
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
    paymentMode: (process.env.PAYMENT_MODE || 'checkout') as PaymentMode,
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || 'change-this-encryption-key-in-production',
  },
  stripe: {
    mode: (process.env.STRIPE_MODE || 'test') as 'test' | 'live',
    ...stripeKeys,
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/forgepaybridge',
    poolMin: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-this-secret-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '5m',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: (process.env.LOG_FORMAT || 'json') as 'json' | 'simple',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
  email: {
    from: process.env.EMAIL_FROM || 'noreply@forgepay.io',
    smtpHost: process.env.EMAIL_SMTP_HOST,
    smtpPort: parseInt(process.env.EMAIL_SMTP_PORT || '587', 10),
    smtpSecure: process.env.EMAIL_SMTP_SECURE === 'true',
    smtpUser: process.env.EMAIL_SMTP_USER,
    smtpPass: process.env.EMAIL_SMTP_PASS,
  },
};

function validateConfig(): void {
  const missing = [
    { key: 'DATABASE_URL', value: config.database.url },
    { key: 'REDIS_URL', value: config.redis.url },
    { key: 'JWT_SECRET', value: config.jwt.secret },
  ].filter((item) => !item.value);

  if (missing.length > 0) {
    throw new Error(
      `必須環境変数が未設定です: ${missing.map((item) => item.key).join(', ')}`
    );
  }

  if (
    config.app.env === 'production' &&
    config.jwt.secret === 'change-this-secret-in-production'
  ) {
    console.warn('⚠️  WARNING: 本番環境でデフォルトの JWT シークレットが使用されています。変更してください。');
  }

  if (
    config.app.env === 'production' &&
    config.encryption.key === 'change-this-encryption-key-in-production'
  ) {
    console.warn('⚠️  WARNING: 本番環境でデフォルトの ENCRYPTION_KEY が使用されています。変更してください。');
  }
}

if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}

export default config;
