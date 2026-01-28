import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface Config {
  app: {
    env: string;
    port: number;
    baseUrl: string;
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
  email?: {
    enabled: boolean;
    provider: string;
    fromEmail: string;
    fromName: string;
    // SendGrid
    sendgridApiKey?: string;
    // AWS SES
    awsRegion?: string;
    // SMTP
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
    smtpUser?: string;
    smtpPass?: string;
  };
  tax?: {
    enabled: boolean;
    sellerCountry: string;
    automaticTax: boolean;
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

export const config: Config = {
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  },
  stripe: {
    mode: (process.env.STRIPE_MODE || 'test') as 'test' | 'live',
    secretKey: stripeKeys.secretKey,
    publishableKey: stripeKeys.publishableKey,
    webhookSecret: stripeKeys.webhookSecret,
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
    enabled: process.env.EMAIL_ENABLED !== 'false',
    provider: process.env.EMAIL_PROVIDER || 'console',
    fromEmail: process.env.EMAIL_FROM || 'noreply@forgepaybridge.com',
    fromName: process.env.EMAIL_FROM_NAME || 'ForgePay',
    // SendGrid
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    // AWS SES
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    // SMTP
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
  },
  tax: {
    enabled: process.env.TAX_ENABLED !== 'false',
    sellerCountry: process.env.TAX_SELLER_COUNTRY || 'US',
    automaticTax: process.env.TAX_AUTOMATIC !== 'false',
  },
};

// Validate required configuration
function validateConfig(): void {
  const required = [
    { key: 'STRIPE_SECRET_KEY', value: config.stripe.secretKey },
    { key: 'DATABASE_URL', value: config.database.url },
    { key: 'REDIS_URL', value: config.redis.url },
    { key: 'JWT_SECRET', value: config.jwt.secret },
  ];

  const missing = required.filter((item) => !item.value);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map((item) => item.key).join(', ')}`
    );
  }

  // Warn if using default JWT secret in production
  if (
    config.app.env === 'production' &&
    config.jwt.secret === 'change-this-secret-in-production'
  ) {
    console.warn('WARNING: Using default JWT secret in production!');
  }
}

// Validate on import
if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}

export default config;
