import { Router } from 'express';
import { z } from 'zod';
import express from 'express';
import paymentController from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth.middleware';
import { loadUser } from '../middleware/role.middleware';
import { validateBody, validateParams, validateQuery, commonSchemas } from '../middleware/validation.middleware';
import { rateLimits } from '../middleware/rate-limit.middleware';
import { idempotencyMiddleware } from '../services/idempotency.service';

const router = Router();

/**
 * Validation schemas
 */

// Create payment intent schema
const createPaymentIntentSchema = z.object({
  purchase_id: commonSchemas.uuid,
  payment_method: z.enum(['card', 'konbini']),
  return_url: z.string().url().optional(),
});

// Confirm payment schema
const confirmPaymentSchema = z.object({
  payment_intent_id: z.string().min(1),
  payment_method_id: z.string().min(1),
});

// Confirm payment with card schema (for Web platform)
// 目的: Web プラットフォーム用に直接カード情報を受け取る
// 注意点: flutter_stripe は Web で動作しないため、このスキーマを使用
const confirmPaymentWithCardSchema = z.object({
  payment_intent_id: z.string().min(1),
  card: z.object({
    number: z.string().min(13).max(19).regex(/^\d+$/),
    exp_month: z.number().int().min(1).max(12),
    exp_year: z.number().int().min(2000).max(2100),
    cvc: z.string().min(3).max(4).regex(/^\d+$/),
  }),
});

// Transaction ID param schema
const transactionIdSchema = z.object({
  transactionId: commonSchemas.uuid,
});

// Payment intent ID param schema
const paymentIntentIdSchema = z.object({
  paymentIntentId: z.string().min(1),
});

// List transactions query schema
const listTransactionsSchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 50)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
});

// Initiate refund schema (Admin only)
// 目的: 验证退款请求参数
// 注意点: amount 可选（默认全额退款），reason 可选
const initiateRefundSchema = z.object({
  transaction_id: commonSchemas.uuid,
  amount: z.number().positive().int().optional(),
  reason: z.string().max(500).optional(),
});

/**
 * Routes
 */

// Stripe webhook (no authentication, raw body needed)
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  paymentController.handleWebhook
);

// All other routes require authentication
router.use(authenticate);
router.use(loadUser);

// Create payment intent (with rate limiting and idempotency)
// 目的: 防止重复请求和滥用
// 注意点: 24小时幂等性窗口，每分钟最多5次请求
router.post(
  '/create-intent',
  rateLimits.purchase,
  idempotencyMiddleware(24 * 60 * 60), // 24小时幂等性窗口
  validateBody(createPaymentIntentSchema),
  paymentController.createPaymentIntent
);

// Confirm payment
router.post(
  '/confirm',
  validateBody(confirmPaymentSchema),
  paymentController.confirmPayment
);

// Confirm payment with card (Web platform)
// 目的: flutter_stripe が Web で動作しないため、直接カード情報を受け取って支払いを確認
// I/O: payment_intent_id + card{number, exp_month, exp_year, cvc} → PaymentIntent
// 注意点: カード情報は Stripe API に直接送信される
router.post(
  '/confirm-with-card',
  validateBody(confirmPaymentWithCardSchema),
  paymentController.confirmPaymentWithCard
);

// Get konbini payment details
router.get(
  '/konbini/:paymentIntentId',
  validateParams(paymentIntentIdSchema),
  paymentController.getKonbiniDetails
);

// Get user's transactions
router.get(
  '/transactions/me',
  validateQuery(listTransactionsSchema),
  paymentController.getMyTransactions
);

// Get transaction by ID
router.get(
  '/transactions/:transactionId',
  validateParams(transactionIdSchema),
  paymentController.getTransaction
);

// Initiate refund (Admin only)
// 目的: 管理员主动发起退款
// 注意点: 需要 ADMIN 角色，支持全额和部分退款
router.post(
  '/refund',
  validateBody(initiateRefundSchema),
  paymentController.initiateRefund
);

// Mock: Simulate konbini payment completion (DEVELOPMENT ONLY)
// 目的: 开发环境下模拟便利店支付完成（无 Webhook）
// 注意点: 仅在 USE_MOCK_PAYMENT=true 时可用，生产环境禁止
router.post(
  '/mock/complete-konbini',
  validateBody(z.object({ payment_intent_id: z.string().min(1) })),
  paymentController.mockCompleteKonbini
);

export default router;
