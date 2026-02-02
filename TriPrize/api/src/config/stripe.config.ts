import Stripe from 'stripe';
import * as dotenv from 'dotenv';
import logger from '../utils/logger.util';

dotenv.config();

/**
 * Payment mode configuration
 * 目的: 根据环境自动切换支付模式
 * I/O: 读取环境变量，决定使用真实支付还是假支付
 * 注意点: 生产环境强制使用真实支付，不允许假支付
 */
const isProduction = process.env.NODE_ENV === 'production';
const useMockPayment = process.env.USE_MOCK_PAYMENT === 'true';

// 生产环境强制使用真实支付
if (isProduction && useMockPayment) {
  throw new Error('USE_MOCK_PAYMENT cannot be true in production environment');
}

// 验证 Stripe 密钥（除非使用假支付）
if (!useMockPayment && !process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not defined in environment variables');
}

// 验证生产环境必须使用生产密钥
if (isProduction && process.env.STRIPE_SECRET_KEY) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (secretKey.startsWith('sk_test_')) {
    throw new Error('Cannot use test Stripe key (sk_test_) in production environment');
  }
  if (!secretKey.startsWith('sk_live_')) {
    logger.warn('⚠ STRIPE_SECRET_KEY does not start with sk_live_. Please verify it is a production key.');
  }
}

// 初始化 Stripe 客户端（仅在非假支付模式下）
export const stripe: Stripe | null = useMockPayment
  ? null
  : new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
      maxNetworkRetries: 3,
      timeout: 10000,
    });

// Webhook secret validation
// 目的: 确保生产环境中 Webhook 签名验证可用
// 注意点: 开发环境可以为空，但会记录警告
const webhookSecretEnv = process.env.STRIPE_WEBHOOK_SECRET;
if (!webhookSecretEnv && isProduction) {
  throw new Error('STRIPE_WEBHOOK_SECRET is required in production environment');
}
if (!webhookSecretEnv && !useMockPayment) {
  logger.warn('⚠ STRIPE_WEBHOOK_SECRET is not set. Webhook signature verification will be disabled in development.');
}

export const STRIPE_WEBHOOK_SECRET = webhookSecretEnv || '';
export const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';

// 导出支付模式配置
export const PAYMENT_CONFIG = {
  isProduction,
  useMockPayment,
  isTestMode: !isProduction && process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'),
  isLiveMode: isProduction && process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_'),
} as const;

if (useMockPayment) {
  logger.warn('⚠ Mock payment mode enabled. Stripe API calls will be simulated.');
  logger.info('✓ Payment service initialized (MOCK MODE)');
} else if (PAYMENT_CONFIG.isTestMode) {
  logger.info('✓ Stripe initialized (TEST MODE - no real charges)');
} else {
  logger.info('✓ Stripe initialized (LIVE MODE - real charges)');
}

export default stripe;
