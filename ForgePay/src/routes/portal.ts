import { Router, Request, Response, NextFunction } from 'express';
import { magicLinkService, PortalSession } from '../services/MagicLinkService';
import { entitlementService } from '../services/EntitlementService';
import { stripeClient } from '../services/StripeClient';
import { customerRepository } from '../repositories/CustomerRepository';
import { config } from '../config';
import { logger } from '../utils/logger';

const router = Router();

// Extend Request type for portal session
declare global {
  namespace Express {
    interface Request {
      portalSession?: PortalSession;
    }
  }
}

/**
 * Portal session authentication middleware
 */
const portalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = req.cookies?.portal_session || req.headers['x-portal-session'];

    if (!sessionId) {
      res.status(401).json({ error: 'No session provided' });
      return;
    }

    const session = await magicLinkService.verifySession(sessionId as string);

    if (!session) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    req.portalSession = session;
    next();
  } catch (error) {
    logger.error('Portal auth error', { error });
    res.status(500).json({ error: 'Authentication error' });
  }
};

/**
 * POST /portal/auth/magic-link
 * Request magic link for portal access
 */
router.post('/auth/magic-link', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const result = await magicLinkService.sendMagicLink(email);

    res.json(result);
  } catch (error) {
    logger.error('Error sending magic link', { error });
    res.status(500).json({ error: 'Failed to send magic link' });
  }
});

/**
 * GET /portal/auth/verify
 * Verify magic link and create session
 */
router.get('/auth/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    const result = await magicLinkService.verifyMagicLink(token);

    if (!result.success || !result.session) {
      res.status(401).json({ error: result.error || 'Invalid magic link' });
      return;
    }

    // Set session cookie
    res.cookie('portal_session', result.session.sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    res.json({
      success: true,
      session: {
        sessionId: result.session.sessionId,
        email: result.session.email,
        expiresAt: result.session.expiresAt,
      },
    });
  } catch (error) {
    logger.error('Error verifying magic link', { error });
    res.status(500).json({ error: 'Failed to verify magic link' });
  }
});

/**
 * POST /portal/auth/logout
 * Logout from portal
 */
router.post('/auth/logout', portalAuth, async (req: Request, res: Response) => {
  try {
    if (req.portalSession) {
      await magicLinkService.destroySession(req.portalSession.sessionId);
    }

    res.clearCookie('portal_session');
    res.json({ success: true });
  } catch (error) {
    logger.error('Error logging out', { error });
    res.status(500).json({ error: 'Failed to logout' });
  }
});

/**
 * GET /portal/me
 * Get current customer info
 */
router.get('/me', portalAuth, async (req: Request, res: Response) => {
  try {
    const customer = await customerRepository.findById(req.portalSession!.customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json({
      id: customer.id,
      email: customer.email,
      name: customer.name,
      createdAt: customer.createdAt,
    });
  } catch (error) {
    logger.error('Error getting customer info', { error });
    res.status(500).json({ error: 'Failed to get customer info' });
  }
});

/**
 * GET /portal/subscriptions
 * Get customer's subscriptions
 */
router.get('/subscriptions', portalAuth, async (req: Request, res: Response) => {
  try {
    const customerId = req.portalSession!.customerId;

    // Get entitlements
    const entitlements = await entitlementService.getEntitlementsByCustomerId(customerId);

    // Filter to subscription entitlements (have subscriptionId)
    const subscriptionEntitlements = entitlements.filter(e => e.subscriptionId);

    // Get Stripe subscription details for each
    const subscriptions = await Promise.all(
      subscriptionEntitlements.map(async (entitlement) => {
        try {
          const subscription = await stripeClient.getSubscription(entitlement.subscriptionId!);
          
          return {
            id: entitlement.id,
            productId: entitlement.productId,
            status: entitlement.status,
            expiresAt: entitlement.expiresAt,
            stripeSubscription: {
              id: subscription.id,
              status: subscription.status,
              currentPeriodStart: new Date(subscription.current_period_start * 1000),
              currentPeriodEnd: new Date(subscription.current_period_end * 1000),
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              canceledAt: subscription.canceled_at 
                ? new Date(subscription.canceled_at * 1000) 
                : null,
            },
          };
        } catch (error) {
          logger.error('Error fetching Stripe subscription', { 
            error, 
            subscriptionId: entitlement.subscriptionId 
          });
          return {
            id: entitlement.id,
            productId: entitlement.productId,
            status: entitlement.status,
            expiresAt: entitlement.expiresAt,
            stripeSubscription: null,
          };
        }
      })
    );

    res.json({ subscriptions });
  } catch (error) {
    logger.error('Error getting subscriptions', { error });
    res.status(500).json({ error: 'Failed to get subscriptions' });
  }
});

/**
 * GET /portal/entitlements
 * Get all customer's entitlements (including one-time purchases)
 */
router.get('/entitlements', portalAuth, async (req: Request, res: Response) => {
  try {
    const customerId = req.portalSession!.customerId;
    const entitlements = await entitlementService.getEntitlementsByCustomerId(customerId);

    res.json({
      entitlements: entitlements.map(e => ({
        id: e.id,
        productId: e.productId,
        purchaseIntentId: e.purchaseIntentId,
        status: e.status,
        expiresAt: e.expiresAt,
        createdAt: e.createdAt,
        isSubscription: !!e.subscriptionId,
      })),
    });
  } catch (error) {
    logger.error('Error getting entitlements', { error });
    res.status(500).json({ error: 'Failed to get entitlements' });
  }
});

/**
 * POST /portal/subscriptions/:id/cancel
 * Cancel a subscription
 */
router.post('/subscriptions/:id/cancel', portalAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { immediately = false } = req.body;
    const customerId = req.portalSession!.customerId;

    // Get entitlement and verify ownership
    const entitlement = await entitlementService.getEntitlement(id);

    if (!entitlement) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    if (entitlement.customerId !== customerId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (!entitlement.subscriptionId) {
      res.status(400).json({ error: 'Not a subscription' });
      return;
    }

    // Cancel in Stripe
    const subscription = await stripeClient.cancelSubscription(
      entitlement.subscriptionId,
      immediately
    );

    // Update entitlement
    if (immediately) {
      await entitlementService.revokeEntitlement(id, 'customer_cancelled_immediately');
    } else {
      // Set expiration to end of current period
      const expiresAt = new Date(subscription.current_period_end * 1000);
      await entitlementService.renewEntitlement(id, expiresAt);
    }

    res.json({
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      },
    });
  } catch (error) {
    logger.error('Error cancelling subscription', { error });
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * GET /portal/billing
 * Get Stripe billing portal URL
 */
router.get('/billing', portalAuth, async (req: Request, res: Response) => {
  try {
    const customerId = req.portalSession!.customerId;
    const customer = await customerRepository.findById(customerId);

    if (!customer || !customer.stripeCustomerId) {
      res.status(404).json({ error: 'No Stripe customer found' });
      return;
    }

    const returnUrl = req.query.return_url as string || `${process.env.PORTAL_URL || config.app.baseUrl}/portal`;

    const session = await stripeClient.createBillingPortalSession(
      customer.stripeCustomerId,
      returnUrl
    );

    res.json({ url: session.url });
  } catch (error) {
    logger.error('Error creating billing portal session', { error });
    res.status(500).json({ error: 'Failed to create billing portal session' });
  }
});

/**
 * GET /portal/invoices
 * Get customer's invoices (from Stripe)
 */
router.get('/invoices', portalAuth, async (req: Request, res: Response) => {
  try {
    const customerId = req.portalSession!.customerId;
    const customer = await customerRepository.findById(customerId);

    if (!customer || !customer.stripeCustomerId) {
      res.json({ invoices: [] });
      return;
    }

    // This would need a Stripe API call - we'll add a method to StripeClient
    // For now, redirect to billing portal for invoice management
    res.json({
      message: 'Access invoices through the billing portal',
      billingPortalEndpoint: '/portal/billing',
    });
  } catch (error) {
    logger.error('Error getting invoices', { error });
    res.status(500).json({ error: 'Failed to get invoices' });
  }
});

export default router;

// Also export the auth middleware for use in other routes
export { portalAuth };
