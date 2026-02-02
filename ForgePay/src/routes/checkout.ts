import { Router, Response } from 'express';
import { checkoutService, SupportedCurrency } from '../services';
import { AuthenticatedRequest, apiKeyAuth, validate } from '../middleware';
import { createCheckoutSessionSchema, getCheckoutSessionParams } from '../schemas';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @openapi
 * /checkout/sessions:
 *   post:
 *     tags:
 *       - Checkout
 *     summary: Create a checkout session
 *     description: Creates a new Stripe checkout session for payment processing
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - product_id
 *               - price_id
 *               - purchase_intent_id
 *               - success_url
 *               - cancel_url
 *             properties:
 *               product_id:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the product to purchase
 *               price_id:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the price to use
 *               purchase_intent_id:
 *                 type: string
 *                 description: Unique identifier from your system
 *               customer_email:
 *                 type: string
 *                 format: email
 *                 description: Customer's email address
 *               success_url:
 *                 type: string
 *                 format: uri
 *                 description: URL to redirect on successful payment
 *               cancel_url:
 *                 type: string
 *                 format: uri
 *                 description: URL to redirect if payment is cancelled
 *               currency:
 *                 type: string
 *                 enum: [usd, cny, jpy, eur]
 *                 default: usd
 *               coupon_code:
 *                 type: string
 *                 description: Optional coupon code to apply
 *               metadata:
 *                 type: object
 *                 description: Additional metadata
 *     responses:
 *       201:
 *         description: Checkout session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 checkout_url:
 *                   type: string
 *                   format: uri
 *                 session_id:
 *                   type: string
 *                 expires_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  '/sessions',
  apiKeyAuth,
  validate(createCheckoutSessionSchema),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      product_id,
      price_id,
      purchase_intent_id,
      customer_email,
      success_url,
      cancel_url,
      currency,
      metadata,
      coupon_code,
    } = req.body;

    // Currency is already validated and transformed by Zod
    const selectedCurrency: SupportedCurrency = currency || 'usd';

    const result = await checkoutService.createSession({
      developerId: req.developer!.id,
      productId: product_id,
      priceId: price_id,
      purchaseIntentId: purchase_intent_id,
      customerEmail: customer_email,
      successUrl: success_url,
      cancelUrl: cancel_url,
      currency: selectedCurrency,
      metadata,
      couponCode: coupon_code,
    });

    logger.info('Checkout session created via API', {
      sessionId: result.sessionId,
      purchaseIntentId: purchase_intent_id,
      developerId: req.developer!.id,
    });

    res.status(201).json({
      checkout_url: result.checkoutUrl,
      session_id: result.sessionId,
      expires_at: result.expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error creating checkout session', { error });

    if (error instanceof Error) {
      if (error.message === 'Product not found') {
        res.status(404).json({
          error: {
            code: 'resource_not_found',
            message: 'Product not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      if (error.message === 'Price not found') {
        res.status(404).json({
          error: {
            code: 'resource_not_found',
            message: 'Price not found',
            type: 'invalid_request_error',
          },
        });
        return;
      }

      if (error.message.includes('not active')) {
        res.status(400).json({
          error: {
            code: 'invalid_request',
            message: error.message,
            type: 'invalid_request_error',
          },
        });
        return;
      }
    }

    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Failed to create checkout session',
        type: 'api_error',
      },
    });
  }
});

/**
 * @openapi
 * /checkout/sessions/{id}:
 *   get:
 *     tags:
 *       - Checkout
 *     summary: Get checkout session
 *     description: Retrieve details of an existing checkout session
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Checkout session ID
 *     responses:
 *       200:
 *         description: Checkout session details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CheckoutSession'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  '/sessions/:id',
  apiKeyAuth,
  validate(getCheckoutSessionParams, 'params'),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const session = await checkoutService.getSession(req.params.id);

    if (!session) {
      res.status(404).json({
        error: {
          code: 'resource_not_found',
          message: 'Checkout session not found',
          type: 'invalid_request_error',
        },
      });
      return;
    }

    res.json({
      id: session.id,
      stripe_session_id: session.stripeSessionId,
      purchase_intent_id: session.purchaseIntentId,
      product_id: session.productId,
      price_id: session.priceId,
      customer_id: session.customerId,
      status: session.status,
      success_url: session.successUrl,
      cancel_url: session.cancelUrl,
      expires_at: session.expiresAt.toISOString(),
      created_at: session.createdAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error retrieving checkout session', { error });
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Failed to retrieve checkout session',
        type: 'api_error',
      },
    });
  }
});

export default router;
