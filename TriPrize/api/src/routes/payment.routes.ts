import { Router } from 'express';
import { z } from 'zod';
import express from 'express';
import paymentController from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth.middleware';
import { loadUser } from '../middleware/role.middleware';
import { validateBody, validateParams, validateQuery, commonSchemas } from '../middleware/validation.middleware';

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

// Create payment intent
router.post(
  '/create-intent',
  validateBody(createPaymentIntentSchema),
  paymentController.createPaymentIntent
);

// Confirm payment
router.post(
  '/confirm',
  validateBody(confirmPaymentSchema),
  paymentController.confirmPayment
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

export default router;
